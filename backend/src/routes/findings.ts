import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, getPagination, paginated, searchFilter } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { recordAuditLog } from '../middleware/auditLog.js';
import { notify } from '../services/notifications.js';

const findingSchema = z.object({
  auditId: z.string().min(1),
  clauseId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  type: z.enum(['C', 'NC', 'OFI', 'NA']),
  severity: z.enum(['MAJOR', 'MINOR', 'OBSERVATION']).optional().nullable(),
  title: z.string().min(3).max(300),
  requirement: z.string().max(3000).optional().nullable(),
  observation: z.string().min(3).max(5000),
  objectiveEvidence: z.string().max(5000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

export const findingsRouter = Router();
findingsRouter.use(authenticate);

const findingInclude = {
  clause: { select: { id: true, number: true, title: true } },
  department: { select: { id: true, name: true } },
  raisedBy: { select: { id: true, name: true } },
  audit: { select: { id: true, code: true, title: true } },
  capa: { select: { id: true, status: true } },
} satisfies Prisma.FindingInclude;

async function generateFindingCode(type: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${type}-${year}-`;
  const count = await prisma.finding.count({ where: { code: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

findingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = getPagination(req.query as Record<string, unknown>);
    const { type, severity, status, auditId, departmentId } = req.query as Record<string, string | undefined>;
    const search = String((req.query.search as string) ?? '').trim();
    const where: Prisma.FindingWhereInput = {
      ...(type ? { type: type as never } : {}),
      ...(severity ? { severity: severity as never } : {}),
      ...(status ? { status } : {}),
      ...(auditId ? { auditId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(searchFilter(search, ['code', 'title', 'observation']) ?? {}),
    };
    const [items, total] = await Promise.all([
      prisma.finding.findMany({ where, include: findingInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      prisma.finding.count({ where }),
    ]);
    res.json(paginated(items, total, params));
  }),
);

// NC register export-friendly list (no pagination).
findingsRouter.get(
  '/nc-register',
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const findings = await prisma.finding.findMany({
      where: {
        type: 'NC',
        ...(from || to
          ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
      include: { capa: { include: { actions: true } }, audit: { select: { code: true } }, department: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    res.json(
      findings.map((f) => ({
        ...f,
        overdue: !!f.dueDate && f.dueDate < now && f.status !== 'CLOSED',
      })),
    );
  }),
);

findingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const finding = await prisma.finding.findUnique({
      where: { id: req.params.id },
      include: { ...findingInclude, capa: { include: { actions: true, whys: true } }, attachments: true },
    });
    if (!finding) throw ApiError.notFound('Finding not found');
    res.json(finding);
  }),
);

findingsRouter.get(
  '/audit/:auditId',
  asyncHandler(async (req, res) => {
    const findings = await prisma.finding.findMany({
      where: { auditId: req.params.auditId },
      include: findingInclude,
      orderBy: { createdAt: 'asc' },
    });
    res.json(findings);
  }),
);

findingsRouter.post(
  '/',
  authorize('findings.manage'),
  asyncHandler(async (req, res) => {
    const data = findingSchema.parse(req.body);
    const audit = await prisma.audit.findUnique({ where: { id: data.auditId } });
    if (!audit) throw ApiError.notFound('Audit not found');

    const finding = await prisma.finding.create({
      data: {
        code: await generateFindingCode(data.type),
        auditId: data.auditId,
        clauseId: data.clauseId ?? null,
        departmentId: data.departmentId ?? audit.departmentId ?? null,
        type: data.type,
        severity: data.severity ?? (data.type === 'NC' ? 'MINOR' : undefined),
        title: data.title,
        requirement: data.requirement ?? null,
        observation: data.observation,
        objectiveEvidence: data.objectiveEvidence ?? null,
        raisedById: req.user!.id,
        dueDate: data.dueDate ?? null,
      },
      include: findingInclude,
    });

    // NCs and OFIs with follow-up automatically open a CAPA workflow.
    if (data.type === 'NC') {
      const capa = await prisma.capa.create({
        data: {
          findingId: finding.id,
          status: 'PENDING',
          rootCauseMethod: 'FIVE_WHY',
          targetDate: finding.dueDate,
        },
      });
      // Alert department heads and auditors that a CAPA is now assigned.
      const deptHeads = await prisma.user.findMany({
        where: { active: true, role: { code: { in: ['DEPT_HEAD', 'AUDITEE'] } } },
        select: { id: true },
      });
      await Promise.all(
        deptHeads.map((u) =>
          notify({
            userId: u.id,
            type: 'NC_ASSIGNED',
            title: `Nonconformity ${finding.code} raised`,
            message: `${finding.title} requires a corrective action response.`,
            entityType: 'Finding',
            entityId: finding.id,
          }),
        ),
      );
      recordAuditLog(req, 'CREATE', 'Finding', finding.id, { capaId: capa.id });
    } else {
      recordAuditLog(req, 'CREATE', 'Finding', finding.id);
    }

    const created = await prisma.finding.findUnique({ where: { id: finding.id }, include: findingInclude });
    res.status(201).json(created);
  }),
);

findingsRouter.put(
  '/:id',
  authorize('findings.manage'),
  asyncHandler(async (req, res) => {
    const data = findingSchema.partial().omit({ auditId: true }).parse(req.body);
    const finding = await prisma.finding.update({
      where: { id: req.params.id },
      data: data as Prisma.FindingUncheckedUpdateInput,
      include: findingInclude,
    });
    recordAuditLog(req, 'UPDATE', 'Finding', finding.id);
    res.json(finding);
  }),
);

findingsRouter.delete(
  '/:id',
  authorize('findings.delete'),
  asyncHandler(async (req, res) => {
    await prisma.capa.deleteMany({ where: { findingId: req.params.id } });
    await prisma.finding.delete({ where: { id: req.params.id } });
    recordAuditLog(req, 'DELETE', 'Finding', req.params.id);
    res.status(204).send();
  }),
);
