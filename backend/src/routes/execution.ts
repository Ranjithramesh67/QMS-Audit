import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { recordAuditLog } from '../middleware/auditLog.js';
import { notify } from '../services/notifications.js';
import { deriveFinding, FINDING_MATRIX } from '../services/findingMatrix.js';

const answerSchema = z.object({
  documented: z.enum(['YES', 'NO', 'NA']),
  implemented: z.enum(['YES', 'NO', 'NA']),
  applicable: z.boolean().optional(),
  comments: z.string().max(4000).optional().nullable(),
  evidence: z.string().max(4000).optional().nullable(),
});

export const executionRouter = Router();
executionRouter.use(authenticate);

// Reference matrix used by the UI to preview the derived classification.
executionRouter.get('/matrix', (_req, res) => res.json(FINDING_MATRIX));

// Returns every selected clause already joined with the saved response and the
// derived (suggested) finding classification.
executionRouter.get(
  '/audits/:id/execution',
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({
      where: { id: req.params.id },
      include: {
        standard: { select: { name: true, code: true, version: true } },
        department: { select: { id: true, name: true } },
        clauses: { include: { clause: true }, orderBy: { clause: { sortOrder: 'asc' } } },
        responses: true,
      },
    });
    if (!audit) throw ApiError.notFound('Audit not found');

    const responseMap = new Map(audit.responses.map((r) => [r.clauseId, r]));
    const clauses = audit.clauses
      .map((ac) => ac.clause)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.number.localeCompare(b.number))
      .map((clause) => {
        const response = responseMap.get(clause.id);
        const documented = response?.documented ?? 'NA';
        const implemented = response?.implemented ?? 'NA';
        return {
          clause,
          response: response ?? null,
          answered: !!response,
          derived: response ? deriveFinding(documented, implemented) : null,
        };
      });

    res.json({
      audit: {
        id: audit.id,
        code: audit.code,
        title: audit.title,
        status: audit.status,
        standard: audit.standard,
        department: audit.department,
        locked: audit.locked,
      },
      clauses,
      progress: {
        total: clauses.length,
        answered: clauses.filter((c) => c.answered).length,
      },
    });
  }),
);

executionRouter.put(
  '/audits/:id/execution/:clauseId',
  authorize('audits.execute'),
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({ where: { id: req.params.id } });
    if (!audit) throw ApiError.notFound('Audit not found');
    if (audit.status !== 'IN_PROGRESS' && audit.status !== 'APPROVED') {
      throw ApiError.conflict('Audit is not open for execution');
    }
    const data = answerSchema.parse(req.body);
    const derived = deriveFinding(data.documented, data.implemented);
    const response = await prisma.auditResponse.upsert({
      where: { auditId_clauseId: { auditId: req.params.id, clauseId: req.params.clauseId } },
      update: { ...data, applicable: data.applicable ?? derived.applicable, answeredById: req.user!.id, answeredAt: new Date() },
      create: {
        auditId: req.params.id,
        clauseId: req.params.clauseId,
        documented: data.documented,
        implemented: data.implemented,
        applicable: data.applicable ?? derived.applicable,
        comments: data.comments ?? null,
        evidence: data.evidence ?? null,
        answeredById: req.user!.id,
        answeredAt: new Date(),
      },
    });
    res.json({ response, derived });
  }),
);

executionRouter.post(
  '/audits/:id/execution/complete',
  authorize('audits.execute'),
  asyncHandler(async (req, res) => {
    const audit = await prisma.audit.findUnique({
      where: { id: req.params.id },
      include: { clauses: true, responses: true, findings: true, createdBy: true },
    });
    if (!audit) throw ApiError.notFound('Audit not found');
    if (audit.responses.length < audit.clauses.length) {
      throw ApiError.badRequest(
        `${audit.clauses.length - audit.responses.length} clause(s) still require an answer before completion`,
      );
    }
    const updated = await prisma.audit.update({
      where: { id: audit.id },
      data: { status: 'FINDINGS_RECORDED', actualEnd: new Date() },
      include: { _count: { select: { findings: true } } },
    });
    await notify({
      userId: audit.createdById,
      type: 'SYSTEM',
      title: `Audit ${audit.code} execution completed`,
      message: `All clauses answered. ${audit.findings.length} finding(s) recorded so far.`,
      entityType: 'Audit',
      entityId: audit.id,
    });
    recordAuditLog(req, 'COMPLETE_EXECUTION', 'Audit', audit.id);
    res.json(updated);
  }),
);
