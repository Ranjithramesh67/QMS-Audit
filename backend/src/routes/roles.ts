import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { recordAuditLog } from '../middleware/auditLog.js';
import { PERMISSIONS, WILDCARD, isKnownPermission } from '../lib/permissions.js';

const permissionArray = z
  .array(z.string())
  .refine((keys) => keys.every((k) => isKnownPermission(k)), {
    message: 'Unknown permission key',
  });

const roleCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Code must be uppercase letters, digits or underscores'),
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional().nullable(),
  permissions: permissionArray.optional().default([]),
  active: z.boolean().optional(),
});

const roleUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(400).optional().nullable(),
  permissions: permissionArray.optional(),
  active: z.boolean().optional(),
});

const userCount = { _count: { select: { users: true } } } as const;

export const rolesRouter = Router();
rolesRouter.use(authenticate);

// Permission catalog for the role editor. Readable by anyone who can view users
// or manage roles.
rolesRouter.get(
  '/permissions',
  authorize('users.view', 'roles.manage'),
  asyncHandler(async (_req, res) => {
    const groups = new Map<string, { group: string; permissions: typeof PERMISSIONS }>();
    for (const permission of PERMISSIONS) {
      const bucket = groups.get(permission.group) ?? { group: permission.group, permissions: [] };
      bucket.permissions.push(permission);
      groups.set(permission.group, bucket);
    }
    res.json({
      wildcard: WILDCARD,
      groups: Array.from(groups.values()),
      permissions: PERMISSIONS,
    });
  }),
);

rolesRouter.get(
  '/',
  authorize('users.view', 'roles.manage'),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: userCount });
    res.json(roles);
  }),
);

rolesRouter.post(
  '/',
  authorize('roles.manage'),
  asyncHandler(async (req, res) => {
    const data = roleCreateSchema.parse(req.body);
    const existing = await prisma.role.findUnique({ where: { code: data.code } });
    if (existing) throw ApiError.conflict('A role with this code already exists');
    const role = await prisma.role.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        permissions: data.permissions,
        active: data.active ?? true,
      },
      include: userCount,
    });
    recordAuditLog(req, 'CREATE', 'Role', role.id, { data });
    res.status(201).json(role);
  }),
);

rolesRouter.put(
  '/:id',
  authorize('roles.manage'),
  asyncHandler(async (req, res) => {
    const data = roleUpdateSchema.parse(req.body);
    const current = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!current) throw ApiError.notFound('Role not found');

    // Guard against locking everyone out: never strip the wildcard from the last
    // role that still grants full access.
    if (
      data.permissions &&
      current.permissions.includes(WILDCARD) &&
      !data.permissions.includes(WILDCARD)
    ) {
      const otherFull = await prisma.role.count({
        where: { id: { not: current.id }, active: true, permissions: { has: WILDCARD } },
      });
      if (otherFull === 0) {
        throw ApiError.badRequest('At least one active role must keep full access');
      }
    }

    const role = await prisma.role.update({
      where: { id: current.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.permissions !== undefined ? { permissions: data.permissions } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      include: userCount,
    });
    recordAuditLog(req, 'UPDATE', 'Role', role.id, { data });
    res.json(role);
  }),
);

rolesRouter.delete(
  '/:id',
  authorize('roles.manage'),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: userCount });
    if (!role) throw ApiError.notFound('Role not found');
    if (role.isSystem) throw ApiError.badRequest('Built-in roles cannot be deleted');
    if (role._count.users > 0) {
      throw ApiError.badRequest('Reassign the users on this role before deleting it');
    }
    await prisma.role.delete({ where: { id: role.id } });
    recordAuditLog(req, 'DELETE', 'Role', role.id);
    res.status(204).send();
  }),
);
