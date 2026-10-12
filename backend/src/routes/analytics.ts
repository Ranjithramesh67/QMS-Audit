import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);
analyticsRouter.use(authorize('analytics.view'));

interface MonthRow {
  month: Date;
  count: bigint;
}

// KPI summary tiles for the dashboard.
analyticsRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const [
      totalAudits,
      completedAudits,
      activeAudits,
      totalFindings,
      majorNc,
      minorNc,
      ofi,
      openNc,
      overdueNc,
      totalCapas,
      closedCapas,
    ] = await Promise.all([
      prisma.audit.count(),
      prisma.audit.count({ where: { status: 'CLOSED' } }),
      prisma.audit.count({ where: { status: { in: ['APPROVED', 'IN_PROGRESS', 'FINDINGS_RECORDED', 'CAPA_IN_PROGRESS', 'VERIFICATION'] } } }),
      prisma.finding.count(),
      prisma.finding.count({ where: { type: 'NC', severity: 'MAJOR' } }),
      prisma.finding.count({ where: { type: 'NC', severity: 'MINOR' } }),
      prisma.finding.count({ where: { type: 'OFI' } }),
      prisma.finding.count({ where: { type: 'NC', status: { not: 'CLOSED' } } }),
      prisma.finding.count({ where: { type: 'NC', status: { not: 'CLOSED' }, dueDate: { lt: now } } }),
      prisma.capa.count(),
      prisma.capa.count({ where: { status: 'CLOSED' } }),
    ]);

    res.json({
      audits: {
        total: totalAudits,
        completed: completedAudits,
        active: activeAudits,
        plannedVsCompletedRate: totalAudits ? Math.round((completedAudits / totalAudits) * 100) : 0,
      },
      findings: { total: totalFindings, majorNc, minorNc, ofi, openNc, overdueNc },
      capa: {
        total: totalCapas,
        closed: closedCapas,
        effectivenessRate: totalCapas ? Math.round((closedCapas / totalCapas) * 100) : 0,
      },
    });
  }),
);

// Audits planned vs completed, bucketed by month (SQL date_trunc aggregation).
analyticsRouter.get(
  '/audits-by-month',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.$queryRaw<Array<{ month: Date; planned: bigint; completed: bigint }>>`
      SELECT date_trunc('month', "createdAt") AS month,
             COUNT(*) AS planned,
             COUNT(*) FILTER (WHERE status = 'CLOSED') AS completed
      FROM "Audit"
      WHERE "createdAt" >= now() - interval '12 months'
      GROUP BY 1
      ORDER BY 1
    `;
    res.json(
      rows.map((r) => ({
        month: r.month.toISOString().slice(0, 7),
        planned: Number(r.planned),
        completed: Number(r.completed),
      })),
    );
  }),
);

// Major vs minor NC trend by month.
analyticsRouter.get(
  '/nc-trends',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.$queryRaw<Array<{ month: Date; major: bigint; minor: bigint; ofi: bigint }>>`
      SELECT date_trunc('month', "createdAt") AS month,
             COUNT(*) FILTER (WHERE type = 'NC' AND severity = 'MAJOR') AS major,
             COUNT(*) FILTER (WHERE type = 'NC' AND severity = 'MINOR') AS minor,
             COUNT(*) FILTER (WHERE type = 'OFI') AS ofi
      FROM "Finding"
      WHERE "createdAt" >= now() - interval '12 months'
      GROUP BY 1
      ORDER BY 1
    `;
    res.json(
      rows.map((r) => ({
        month: r.month.toISOString().slice(0, 7),
        major: Number(r.major),
        minor: Number(r.minor),
        ofi: Number(r.ofi),
      })),
    );
  }),
);

// Department-wise distribution of findings.
analyticsRouter.get(
  '/department-findings',
  asyncHandler(async (_req, res) => {
    const grouped = await prisma.finding.groupBy({ by: ['departmentId'], _count: { _all: true } });
    const departments = await prisma.department.findMany({ select: { id: true, name: true } });
    const nameById = new Map(departments.map((d) => [d.id, d.name]));
    const byType = await prisma.finding.groupBy({ by: ['departmentId', 'type'], _count: { _all: true } });
    res.json(
      grouped.map((g) => {
        const id = g.departmentId ?? 'unassigned';
        const types = byType.filter((t) => t.departmentId === g.departmentId);
        return {
          departmentId: id,
          department: id === 'unassigned' ? 'Unassigned' : nameById.get(id) ?? 'Unknown',
          total: g._count._all,
          nc: types.filter((t) => t.type === 'NC').reduce((s, t) => s + t._count._all, 0),
          ofi: types.filter((t) => t.type === 'OFI').reduce((s, t) => s + t._count._all, 0),
        };
      }),
    );
  }),
);

// Clause-wise distribution of findings (top clauses).
analyticsRouter.get(
  '/clause-findings',
  asyncHandler(async (_req, res) => {
    const grouped = await prisma.finding.groupBy({ by: ['clauseId'], _count: { _all: true }, orderBy: { _count: { clauseId: 'desc' } } });
    const clauses = await prisma.clause.findMany({
      where: { id: { in: grouped.map((g) => g.clauseId).filter((v): v is string => !!v) } },
      select: { id: true, number: true, title: true },
    });
    const map = new Map(clauses.map((c) => [c.id, c]));
    res.json(
      grouped
        .filter((g) => g.clauseId)
        .slice(0, 15)
        .map((g) => ({
          clauseId: g.clauseId,
          clause: map.get(g.clauseId!) ? `${map.get(g.clauseId!)!.number} ${map.get(g.clauseId!)!.title}` : 'Unknown',
          count: g._count._all,
        })),
    );
  }),
);

// CAPA effectiveness breakdown.
analyticsRouter.get(
  '/capa-status',
  asyncHandler(async (_req, res) => {
    const grouped = await prisma.capa.groupBy({ by: ['status'], _count: { _all: true } });
    res.json(grouped.map((g) => ({ status: g.status, count: g._count._all })));
  }),
);

// Overdue CAPAs / findings list for dashboards and follow-up.
analyticsRouter.get(
  '/overdue',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const [overdueFindings, overdueCapas] = await Promise.all([
      prisma.finding.findMany({
        where: { type: 'NC', status: { not: 'CLOSED' }, dueDate: { lt: now } },
        include: { audit: { select: { code: true } }, department: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      prisma.capa.findMany({
        where: { targetDate: { lt: now }, status: { notIn: ['CLOSED', 'VERIFIED'] } },
        include: { finding: { select: { code: true, title: true } } },
        orderBy: { targetDate: 'asc' },
        take: 50,
      }),
    ]);
    res.json({ overdueFindings, overdueCapas });
  }),
);
