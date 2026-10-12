import type { Request } from 'express';
import { prisma } from '../lib/prisma.js';

/** Fire-and-forget audit trail write; never blocks the response. */
export function recordAuditLog(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string,
  meta?: Record<string, unknown>,
) {
  prisma.auditLog
    .create({
      data: {
        userId: req.user?.id ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        meta: (meta as never) ?? undefined,
        ip: req.ip,
      },
    })
    .catch((error) => console.warn('[audit-log] failed', error));
}
