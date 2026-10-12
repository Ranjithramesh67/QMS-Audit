import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, getPagination, paginated } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { recordAuditLog } from '../middleware/auditLog.js';
import { notify } from '../services/notifications.js';

const whySchema = z.object({ level: z.number().int().min(1).max(10), question: z.string().min(1), answer: z.string().min(1) });
const actionSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(2),
  responsible: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).optional(),
});

const responseSchema = z.object({
  immediateCorrection: z.string().max(4000).optional().nullable(),
  correctionDate: z.coerce.date().optional().nullable(),
  rootCauseMethod: z.enum(['FIVE_WHY', 'FISHBONE']).optional(),
  rootCause: z.string().max(4000).optional().nullable(),
  fishboneJson: z.any().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
  responsibleId: z.string().optional().nullable(),
  whys: z.array(whySchema).optional(),
  actions: z.array(actionSchema).optional(),
  capaType: z.string().max(64).optional().nullable(),
});

const verifySchema = z.object({
  verificationMethod: z.string().max(4000).optional().nullable(),
  verificationNotes: z.string().max(4000).optional().nullable(),
  effectivenessResult: z.string().max(2000).optional().nullable(),
  pass: z.boolean(),
});

export const capaRouter = Router();
capaRouter.use(authenticate);

const capaInclude = {
  finding: {
    include: {
      clause: { select: { id: true, number: true, title: true } },
      department: { select: { id: true, name: true } },
      audit: { select: { id: true, code: true, title: true, createdById: true } },
      raisedBy: { select: { id: true, name: true } },
    },
  },
  responsible: { select: { id: true, name: true, role: true } },
  verifiedBy: { select: { id: true, name: true } },
  actions: { orderBy: { createdAt: 'asc' } },
  whys: { orderBy: { level: 'asc' } },
  attachments: true,
} satisfies Prisma.CapaInclude;

/** Recomputes the parent audit status from the state of its CAPAs. */
async function recomputeAuditStatus(auditId: string) {
  const capas = await prisma.capa.findMany({ where: { finding: { auditId } }, select: { status: true } });
  if (capas.length === 0) return;
  const all = capas.map((c) => c.status);
  let status: 'CAPA_IN_PROGRESS' | 'VERIFICATION' | 'CLOSED' = 'CAPA_IN_PROGRESS';
  if (all.every((s) => s === 'CLOSED')) status = 'CLOSED';
  else if (all.every((s) => ['VERIFIED', 'CLOSED', 'ACCEPTED'].includes(s))) status = 'VERIFICATION';
  await prisma.audit.update({ where: { id: auditId }, data: { status } });
}

capaRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = getPagination(req.query as Record<string, unknown>);
    const { status, auditId } = req.query as Record<string, string | undefined>;
    const where: Prisma.CapaWhereInput = {
      ...(status ? { status: status as never } : {}),
      ...(auditId ? { finding: { auditId } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.capa.findMany({ where, include: capaInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      prisma.capa.count({ where }),
    ]);
    res.json(paginated(items, total, params));
  }),
);

capaRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: capaInclude });
    if (!capa) throw ApiError.notFound('CAPA not found');
    res.json(capa);
  }),
);

// Ensure a CAPA exists for a finding (auditee view entry point).
capaRouter.post(
  '/findings/:findingId',
  authorize('capa.open'),
  asyncHandler(async (req, res) => {
    const finding = await prisma.finding.findUnique({ where: { id: req.params.findingId } });
    if (!finding) throw ApiError.notFound('Finding not found');
    const existing = await prisma.capa.findUnique({ where: { findingId: finding.id } });
    const capa =
      existing ??
      (await prisma.capa.create({
        data: { findingId: finding.id, status: 'PENDING', rootCauseMethod: 'FIVE_WHY', targetDate: finding.dueDate },
      }));
    const full = await prisma.capa.findUnique({ where: { id: capa.id }, include: capaInclude });
    res.status(existing ? 200 : 201).json(full);
  }),
);

// Step 1: auditee acknowledges the NC.
capaRouter.post(
  '/:id/acknowledge',
  authorize('capa.respond'),
  asyncHandler(async (req, res) => {
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    const updated = await prisma.capa.update({
      where: { id: capa.id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: req.user!.name },
      include: capaInclude,
    });
    await recomputeAuditStatus(capa.finding.auditId);
    recordAuditLog(req, 'CAPA_ACKNOWLEDGE', 'Capa', capa.id);
    res.json(updated);
  }),
);

// Step 2-3: auditee records correction, root cause (5-Why/Fishbone) and actions.
capaRouter.put(
  '/:id/response',
  authorize('capa.respond'),
  asyncHandler(async (req, res) => {
    const data = responseSchema.parse(req.body);
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    if (['VERIFIED', 'CLOSED'].includes(capa.status)) throw ApiError.conflict('CAPA is already closed');

    await prisma.$transaction(async (tx) => {
      await tx.capa.update({
        where: { id: capa.id },
        data: {
          immediateCorrection: data.immediateCorrection ?? capa.immediateCorrection,
          correctionDate: data.correctionDate ?? capa.correctionDate,
          rootCauseMethod: data.rootCauseMethod ?? capa.rootCauseMethod,
          rootCause: data.rootCause ?? capa.rootCause,
          fishboneJson: (data.fishboneJson as Prisma.InputJsonValue) ?? (capa.fishboneJson as Prisma.InputJsonValue) ?? undefined,
          targetDate: data.targetDate ?? capa.targetDate,
          responsibleId: data.responsibleId ?? capa.responsibleId,
          status: capa.status === 'PENDING' ? 'ACKNOWLEDGED' : capa.status,
        },
      });
      if (data.whys) {
        await tx.capaWhy.deleteMany({ where: { capaId: capa.id } });
        if (data.whys.length) await tx.capaWhy.createMany({ data: data.whys.map((w) => ({ ...w, capaId: capa.id })) });
      }
      if (data.actions) {
        await tx.capaAction.deleteMany({ where: { capaId: capa.id } });
        if (data.actions.length) {
          await tx.capaAction.createMany({
            data: data.actions.map((a) => ({
              capaId: capa.id,
              description: a.description,
              responsible: a.responsible ?? null,
              dueDate: a.dueDate ?? null,
              status: a.status ?? 'OPEN',
            })),
          });
        }
      }
    });

    const full = await prisma.capa.findUnique({ where: { id: capa.id }, include: capaInclude });
    res.json(full);
  }),
);

// Step 4: auditee submits for auditor review.
capaRouter.post(
  '/:id/submit',
  authorize('capa.respond'),
  asyncHandler(async (req, res) => {
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true, actions: true, whys: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    if (!capa.rootCause) throw ApiError.badRequest('Root cause analysis is required before submission');
    if (capa.actions.length === 0) throw ApiError.badRequest('At least one corrective action is required');
    const updated = await prisma.capa.update({
      where: { id: capa.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: capaInclude,
    });
    await recomputeAuditStatus(capa.finding.auditId);
    await notify({
      userId: capa.finding.raisedById,
      type: 'APPROVAL_REQUIRED',
      title: `CAPA for ${capa.finding.code} submitted`,
      message: `An action plan was submitted and awaits your review.`,
      entityType: 'Capa',
      entityId: capa.id,
    });
    recordAuditLog(req, 'CAPA_SUBMIT', 'Capa', capa.id);
    res.json(updated);
  }),
);

// Step 5: auditor accepts the plan.
capaRouter.post(
  '/:id/accept',
  authorize('capa.review'),
  asyncHandler(async (req, res) => {
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    const updated = await prisma.capa.update({
      where: { id: capa.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedBy: req.user!.name, rejectionReason: null },
      include: capaInclude,
    });
    await recomputeAuditStatus(capa.finding.auditId);
    if (capa.responsibleId) {
      await notify({
        userId: capa.responsibleId,
        type: 'SYSTEM',
        title: `CAPA for ${capa.finding.code} accepted`,
        message: `The corrective action plan was accepted. Proceed with implementation.`,
        entityType: 'Capa',
        entityId: capa.id,
      });
    }
    res.json(updated);
  }),
);

capaRouter.post(
  '/:id/reject',
  authorize('capa.review'),
  asyncHandler(async (req, res) => {
    const reason = z.string().min(3).parse(req.body?.reason ?? '');
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    const updated = await prisma.capa.update({
      where: { id: capa.id },
      data: { status: 'REJECTED', rejectionReason: reason },
      include: capaInclude,
    });
    if (capa.responsibleId) {
      await notify({
        userId: capa.responsibleId,
        type: 'SYSTEM',
        title: `CAPA for ${capa.finding.code} rejected`,
        message: reason,
        entityType: 'Capa',
        entityId: capa.id,
      });
    }
    res.json(updated);
  }),
);

// Step 6: effectiveness verification.
capaRouter.post(
  '/:id/verify',
  authorize('capa.review'),
  asyncHandler(async (req, res) => {
    const data = verifySchema.parse(req.body);
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    if (!['ACCEPTED', 'SUBMITTED', 'VERIFIED'].includes(capa.status)) {
      throw ApiError.badRequest('Accept the action plan before verifying effectiveness');
    }
    const updated = await prisma.capa.update({
      where: { id: capa.id },
      data: {
        status: data.pass ? 'VERIFIED' : 'REJECTED',
        verificationMethod: data.verificationMethod ?? null,
        verificationNotes: data.verificationNotes ?? null,
        effectivenessResult: data.effectivenessResult ?? null,
        verifiedAt: new Date(),
        verifiedById: req.user!.id,
        rejectionReason: data.pass ? null : 'Effectiveness verification failed',
      },
      include: capaInclude,
    });
    if (!data.pass) {
      await prisma.capa.update({ where: { id: capa.id }, data: { status: 'SUBMITTED' } });
    }
    if (data.pass) {
      // Passing verification closes the NC and the finding.
      await prisma.finding.update({ where: { id: capa.findingId }, data: { status: 'CLOSED' } });
    }
    await recomputeAuditStatus(capa.finding.auditId);
    recordAuditLog(req, 'CAPA_VERIFY', 'Capa', capa.id, { pass: data.pass });
    const refreshed = await prisma.capa.findUnique({ where: { id: capa.id }, include: capaInclude });
    res.json(refreshed ?? updated);
  }),
);

// Step 7: formal closure.
capaRouter.post(
  '/:id/close',
  authorize('capa.close'),
  asyncHandler(async (req, res) => {
    const capa = await prisma.capa.findUnique({ where: { id: req.params.id }, include: { finding: true } });
    if (!capa) throw ApiError.notFound('CAPA not found');
    if (capa.status !== 'VERIFIED') throw ApiError.badRequest('Effectiveness must be verified before closure');
    const updated = await prisma.capa.update({
      where: { id: capa.id },
      data: { status: 'CLOSED', closedAt: new Date() },
      include: capaInclude,
    });
    await prisma.finding.update({ where: { id: capa.findingId }, data: { status: 'CLOSED' } });
    await recomputeAuditStatus(capa.finding.auditId);
    recordAuditLog(req, 'CAPA_CLOSE', 'Capa', capa.id);
    res.json(updated);
  }),
);
