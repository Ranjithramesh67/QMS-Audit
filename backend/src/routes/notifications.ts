import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, getPagination, paginated } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { notify } from '../services/notifications.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = getPagination(req.query as Record<string, unknown>);
    const where = { userId: req.user!.id, ...(req.query.unread === 'true' ? { read: false } : {}) };
    const [items, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      prisma.notification.count({ where }),
    ]);
    res.json(paginated(items, total, params));
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, read: false } });
    res.json({ count });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { read: true },
    });
    res.json(notification);
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true },
    });
    res.json(result);
  }),
);

/**
 * Deadline scanner. Invoked on demand (or by an external scheduler) to raise
 * alerts for audits starting soon, findings nearing their due date, and CAPAs
 * that have passed their target date.
 */
notificationsRouter.post(
  '/scan-deadlines',
  authorize('notifications.broadcast'),
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const in7Days = new Date();
    in7Days.setDate(in7Days.getDate() + 7);

    const upcomingAudits = await prisma.audit.findMany({
      where: { plannedStart: { gte: now, lte: in7Days }, status: { in: ['APPROVED', 'PLANNED'] } },
    });
    const dueFindings = await prisma.finding.findMany({
      where: { type: 'NC', status: { not: 'CLOSED' }, dueDate: { gte: now, lte: in7Days } },
    });
    const overdueCapas = await prisma.capa.findMany({
      where: { targetDate: { lt: now }, status: { notIn: ['CLOSED', 'VERIFIED'] } },
      include: { finding: { select: { code: true } } },
    });

    const admins = await prisma.user.findMany({
      where: { active: true, role: { code: { in: ['ADMIN', 'QMR', 'LEAD_AUDITOR'] } } },
      select: { id: true },
    });

    let created = 0;
    for (const audit of upcomingAudits) {
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          type: 'AUDIT_SCHEDULED',
          title: `Audit ${audit.code} starts soon`,
          message: `${audit.title} is scheduled to start on ${audit.plannedStart?.toDateString()}.`,
          entityType: 'Audit',
          entityId: audit.id,
        });
        created += 1;
      }
    }
    for (const finding of dueFindings) {
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          type: 'DEADLINE_UPCOMING',
          title: `NC ${finding.code} due soon`,
          message: `Corrective action for ${finding.code} is due on ${finding.dueDate?.toDateString()}.`,
          entityType: 'Finding',
          entityId: finding.id,
        });
        created += 1;
      }
    }
    for (const capa of overdueCapas) {
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          type: 'CAPA_OVERDUE',
          title: `CAPA overdue for ${capa.finding.code}`,
          message: `The corrective action plan has passed its target date of ${capa.targetDate?.toDateString()}.`,
          entityType: 'Capa',
          entityId: capa.id,
        });
        created += 1;
      }
    }

    res.json({ upcomingAudits: upcomingAudits.length, dueFindings: dueFindings.length, overdueCapas: overdueCapas.length, notificationsCreated: created });
  }),
);
