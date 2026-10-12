import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, getPagination, paginated, searchFilter } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { recordAuditLog } from '../middleware/auditLog.js';
import { notify, notifyRoles } from '../services/notifications.js';

const CATEGORIES = ['SYSTEM', 'PRODUCT', 'PROCESS'] as const;

const basicSchema = z.object({
  title: z.string().min(3).max(300),
  programId: z.string().optional().nullable(),
  standardId: z.string().optional().nullable(),
  auditTypeId: z.string().optional().nullable(),
  category: z.enum(CATEGORIES).optional(),
});

const scopeSchema = z.object({
  plantId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  scope: z.string().max(3000).optional().nullable(),
  objectives: z.string().max(3000).optional().nullable(),
  criteria: z.string().max(3000).optional().nullable(),
});

const teamSchema = z.object({
  auditors: z
    .array(z.object({ auditorId: z.string().min(1), isLead: z.boolean().optional() }))
    .min(1, 'At least one auditor is required'),
  force: z.boolean().optional(),
});

const clausesSchema = z.object({ clauseIds: z.array(z.string().min(1)) });

const scheduleSchema = z.object({
  items: z.array(
    z.object({
      clauseId: z.string().optional().nullable(),
      auditorId: z.string().optional().nullable(),
      departmentId: z.string().optional().nullable(),
      date: z.coerce.date(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      notes: z.string().max(500).optional().nullable(),
    }),
  ),
  plannedStart: z.coerce.date().optional().nullable(),
  plannedEnd: z.coerce.date().optional().nullable(),
});

export const auditsRouter = Router();
auditsRouter.use(authenticate);

const auditInclude = {
  standard: { select: { id: true, name: true, code: true, version: true } },
  auditType: true,
  program: { select: { id: true, name: true, code: true, year: true } },
  plant: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
  team: { include: { auditor: true } },
  clauses: { include: { clause: true } },
  scheduleItems: { include: { clause: { select: { id: true, number: true, title: true } }, auditor: true } },
  _count: { select: { findings: true, responses: true } },
} satisfies Prisma.AuditInclude;

const openStatuses = ['DRAFT', 'PLANNED', 'PENDING_APPROVAL'] as const;

function assertEditable(status: string, locked: boolean) {
  if (locked || !openStatuses.includes(status as (typeof openStatuses)[number])) {
    throw ApiError.conflict(`Audit is ${status} and can no longer be modified`);
  }
}

async function generateAuditCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.audit.count({ where: { code: { startsWith: `AUD-${year}-` } } });
  return `AUD-${year}-${String(count + 1).padStart(4, '0')}`;
}

// --- List & read ------------------------------------------------------------
auditsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = getPagination(req.query as Record<string, unknown>);
    const { status, category, plantId, standardId } = req.query as Record<string, string | undefined>;
    const search = String((req.query.search as string) ?? '').trim();
    const where: Prisma.AuditWhereInput = {
      ...(status ? { status: status as never } : {}),
      ...(category ? { category: category as never } : {}),
      ...(plantId ? { plantId } : {}),
      ...(standardId ? { standardId } : {}),
      ...(searchFilter(search, ['code', 'title', 'scope']) ?? {}),
    };
    const [items, total] = await Promise.all([
      prisma.audit.findMany({ where, include: auditInclude, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      prisma.audit.count({ where }),
    ]);
    res.json(paginated(items, total, params));
  }),
);

auditsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id }, include: auditInclude });
    if (!audit) throw ApiError.notFound('Audit not found');
    res.json(audit);
  }),
);

// --- Step 1: create draft (basic info) --------------------------------------
auditsRouter.post(
  '/',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const data = basicSchema.parse(req.body);
    const audit = await prisma.audit.create({
      data: {
        code: await generateAuditCode(),
        title: data.title,
        category: data.category ?? 'SYSTEM',
        programId: data.programId ?? null,
        standardId: data.standardId ?? null,
        auditTypeId: data.auditTypeId ?? null,
        status: 'DRAFT',
        createdById: req.user!.id,
      },
      include: auditInclude,
    });
    recordAuditLog(req, 'CREATE', 'Audit', audit.id);
    res.status(201).json(audit);
  }),
);

auditsRouter.put(
  '/:id/basic',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Audit not found');
    assertEditable(existing.status, existing.locked);
    const data = basicSchema.partial().parse(req.body);
    const audit = await prisma.audit.update({ where: { id: req.params.id }, data, include: auditInclude });
    res.json(audit);
  }),
);

// --- Step 2-4: plant, category / scope --------------------------------------
auditsRouter.put(
  '/:id/scope',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Audit not found');
    assertEditable(existing.status, existing.locked);
    const data = scopeSchema.parse(req.body);
    const audit = await prisma.audit.update({ where: { id: req.params.id }, data, include: auditInclude });
    recordAuditLog(req, 'UPDATE_SCOPE', 'Audit', audit.id);
    res.json(audit);
  }),
);

// --- Step 5-6: checklist clauses selection ----------------------------------
auditsRouter.put(
  '/:id/clauses',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Audit not found');
    assertEditable(existing.status, existing.locked);
    const { clauseIds } = clausesSchema.parse(req.body);
    await prisma.$transaction([
      prisma.auditClause.deleteMany({ where: { auditId: req.params.id } }),
      prisma.auditClause.createMany({
        data: clauseIds.map((clauseId) => ({ auditId: req.params.id, clauseId })),
        skipDuplicates: true,
      }),
    ]);
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id }, include: auditInclude });
    res.json(audit);
  }),
);

// --- Step 7: auditor assignment with independence & capacity checks ---------
auditsRouter.put(
  '/:id/team',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Audit not found');
    assertEditable(existing.status, existing.locked);
    const { auditors, force } = teamSchema.parse(req.body);

    const auditorRecords = await prisma.auditor.findMany({
      where: { id: { in: auditors.map((a) => a.auditorId) } },
      include: { user: { select: { id: true, departmentId: true } } },
    });

    // Rule: an internal auditor must not audit their own department.
    if (existing.departmentId && !force) {
      const conflict = auditorRecords.find(
        (a) => a.type === 'INTERNAL' && a.user?.departmentId && a.user.departmentId === existing.departmentId,
      );
      if (conflict) {
        throw ApiError.badRequest(
          `${conflict.name} belongs to the audited department and cannot audit it. Choose a different auditor.`,
        );
      }
    }

    const leads = auditors.filter((a) => a.isLead);
    if (leads.length !== 1) throw ApiError.badRequest('Exactly one lead auditor must be assigned');

    await prisma.$transaction([
      prisma.auditAuditor.deleteMany({ where: { auditId: req.params.id } }),
      prisma.auditAuditor.createMany({
        data: auditors.map((a) => ({ auditId: req.params.id, auditorId: a.auditorId, isLead: !!a.isLead })),
        skipDuplicates: true,
      }),
    ]);
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id }, include: auditInclude });
    res.json(audit);
  }),
);

// --- Step 8: scheduling with conflict detection -----------------------------
function timesOverlap(aStart?: string | null, aEnd?: string | null, bStart?: string | null, bEnd?: string | null) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart < bEnd && bStart < aEnd;
}

auditsRouter.put(
  '/:id/schedule',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw ApiError.notFound('Audit not found');
    assertEditable(existing.status, existing.locked);
    const { items, plannedStart, plannedEnd } = scheduleSchema.parse(req.body);

    // Detect double-booking for the same auditor within this plan.
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (!a.auditorId || a.auditorId !== b.auditorId) continue;
        const sameDay = a.date.toDateString() === b.date.toDateString();
        if (sameDay && timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
          throw ApiError.badRequest('The same auditor is scheduled for overlapping slots');
        }
      }
    }

    await prisma.$transaction([
      prisma.auditScheduleItem.deleteMany({ where: { auditId: req.params.id } }),
      prisma.auditScheduleItem.createMany({
        data: items.map((item) => ({
          auditId: req.params.id,
          clauseId: item.clauseId ?? null,
          auditorId: item.auditorId ?? null,
          departmentId: item.departmentId ?? existing.departmentId ?? null,
          date: item.date,
          startTime: item.startTime ?? null,
          endTime: item.endTime ?? null,
          notes: item.notes ?? null,
        })),
      }),
      prisma.audit.update({
        where: { id: req.params.id },
        data: { plannedStart: plannedStart ?? null, plannedEnd: plannedEnd ?? null },
      }),
    ]);

    const audit = await prisma.audit.findUnique({ where: { id: req.params.id }, include: auditInclude });
    res.json(audit);
  }),
);

// --- Step 9: submit for QMR approval, approve (locks), reject, start --------
auditsRouter.post(
  '/:id/submit',
  authorize('audits.plan'),
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({
      where: { id: req.params.id },
      include: { team: true, clauses: true, scheduleItems: true },
    });
    if (!audit) throw ApiError.notFound('Audit not found');
    if (!openStatuses.includes(audit.status as (typeof openStatuses)[number])) {
      throw ApiError.conflict('Audit already submitted');
    }
    if (audit.team.length === 0) throw ApiError.badRequest('Assign an audit team before submitting');
    if (audit.clauses.length === 0) throw ApiError.badRequest('Select checklist clauses before submitting');
    if (!audit.plannedStart || !audit.plannedEnd) throw ApiError.badRequest('Schedule the audit before submitting');

    const updated = await prisma.audit.update({
      where: { id: audit.id },
      data: { status: 'PENDING_APPROVAL' },
      include: auditInclude,
    });
    await notifyRoles(['QMR'], {
      type: 'APPROVAL_REQUIRED',
      title: `Audit ${audit.code} awaiting approval`,
      message: `${audit.title} has been submitted for QMR approval.`,
      entityType: 'Audit',
      entityId: audit.id,
    });
    recordAuditLog(req, 'SUBMIT', 'Audit', audit.id);
    res.json(updated);
  }),
);

auditsRouter.post(
  '/:id/approve',
  authorize('audits.approve'),
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!audit) throw ApiError.notFound('Audit not found');
    if (audit.status !== 'PENDING_APPROVAL') throw ApiError.conflict('Audit is not awaiting approval');
    const updated = await prisma.audit.update({
      where: { id: audit.id },
      data: {
        status: 'APPROVED',
        locked: true,
        approvedById: req.user!.id,
        approvedAt: new Date(),
        approvalNotes: (req.body?.notes as string) ?? null,
      },
      include: auditInclude,
    });
    await notify({
      userId: audit.createdById,
      type: 'APPROVAL_DECISION',
      title: `Audit ${audit.code} approved`,
      message: `Your audit plan ${audit.code} has been approved and locked.`,
      entityType: 'Audit',
      entityId: audit.id,
    });
    recordAuditLog(req, 'APPROVE', 'Audit', audit.id);
    res.json(updated);
  }),
);

auditsRouter.post(
  '/:id/reject',
  authorize('audits.approve'),
  asyncHandler(async (req, res) => {
    const notes = z.string().min(3).parse(req.body?.notes ?? '');
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!audit) throw ApiError.notFound('Audit not found');
    const updated = await prisma.audit.update({
      where: { id: audit.id },
      data: { status: 'DRAFT', approvalNotes: notes },
      include: auditInclude,
    });
    await notify({
      userId: audit.createdById,
      type: 'APPROVAL_DECISION',
      title: `Audit ${audit.code} returned for revision`,
      message: notes,
      entityType: 'Audit',
      entityId: audit.id,
    });
    res.json(updated);
  }),
);

auditsRouter.post(
  '/:id/start',
  authorize('audits.execute'),
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!audit) throw ApiError.notFound('Audit not found');
    if (audit.status !== 'APPROVED' && audit.status !== 'PLANNED') {
      throw ApiError.conflict('Audit must be approved before execution starts');
    }
    const updated = await prisma.audit.update({
      where: { id: audit.id },
      data: { status: 'IN_PROGRESS', actualStart: new Date() },
      include: auditInclude,
    });
    recordAuditLog(req, 'START_EXECUTION', 'Audit', audit.id);
    res.json(updated);
  }),
);

export { auditInclude };
