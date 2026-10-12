import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, getPagination, paginated, searchFilter } from '../lib/http.js';
import { createCrudRouter, type CrudOptions } from '../lib/crud.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { recordAuditLog } from '../middleware/auditLog.js';

const asDelegate = (value: unknown) => value as CrudOptions['delegate'];

const CATEGORIES = ['SYSTEM', 'PRODUCT', 'PROCESS'] as const;

const auditorSchema = z.object({
  userId: z.string().optional().nullable(),
  type: z.enum(['INTERNAL', 'EXTERNAL']).optional(),
  name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  organisation: z.string().max(200).optional().nullable(),
  competencyLevel: z.enum(['TRAINEE', 'QUALIFIED', 'SENIOR', 'LEAD']).optional(),
  qualifications: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  competencyExpiry: z.coerce.date().optional().nullable(),
  competentForCategories: z.array(z.enum(CATEGORIES)).optional(),
  active: z.boolean().optional(),
});

const auditeeSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  designation: z.string().max(200).optional().nullable(),
  departmentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200),
  roleId: z.string().min(1),
  phone: z.string().max(50).optional().nullable(),
  designation: z.string().max(200).optional().nullable(),
  plantId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export const peopleRouter = Router();
peopleRouter.use(authenticate);

// Auditors whose competency certificate is expiring within 60 days (or already expired).
// Declared before the CRUD router so it is not shadowed by "/:id".
peopleRouter.get(
  '/auditors/competency-alerts',
  authorize('masters.auditors'),
  asyncHandler(async (_req, res) => {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 60);
    const auditors = await prisma.auditor.findMany({
      where: { active: true, competencyExpiry: { lte: threshold } },
      orderBy: { competencyExpiry: 'asc' },
    });
    const now = new Date();
    res.json(auditors.map((a) => ({ ...a, expired: !!a.competencyExpiry && a.competencyExpiry < now })));
  }),
);

peopleRouter.use(
  '/auditors',
  authorize('masters.auditors'),
  createCrudRouter({
    delegate: asDelegate(prisma.auditor),
    createSchema: auditorSchema,
    updateSchema: auditorSchema.partial(),
    name: 'Auditor',
    searchFields: ['name', 'email', 'organisation'],
    orderBy: { name: 'asc' },
    softDeleteField: 'active',
    include: { user: { select: { id: true, email: true, role: { select: { code: true } } } } },
  }),
);

peopleRouter.use(
  '/auditees',
  authorize('masters.auditees'),
  createCrudRouter({
    delegate: asDelegate(prisma.auditee),
    createSchema: auditeeSchema,
    updateSchema: auditeeSchema.partial(),
    name: 'Auditee',
    searchFields: ['name', 'email', 'designation'],
    orderBy: { name: 'asc' },
    softDeleteField: 'active',
    include: { department: { select: { id: true, name: true } } },
  }),
);

peopleRouter.get(
  '/users',
  authorize('users.view'),
  asyncHandler(async (req, res) => {
    const params = getPagination(req.query as Record<string, unknown>);
    const search = String((req.query.search as string) ?? '').trim();
    const roleCode = typeof req.query.role === 'string' && req.query.role ? req.query.role : undefined;
    const where = {
      ...(roleCode ? { role: { code: roleCode } } : {}),
      ...(searchFilter(search, ['name', 'email', 'designation']) ?? {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          roleId: true,
          role: { select: { code: true, name: true } },
          phone: true,
          designation: true,
          active: true,
          plantId: true,
          departmentId: true,
          plant: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.user.count({ where }),
    ]);
    // Flatten the role relation into code/name fields for the client.
    const items = rows.map(({ role, ...rest }) => ({ ...rest, role: role.code, roleName: role.name }));
    res.json(paginated(items, total, params));
  }),
);

peopleRouter.post(
  '/users',
  authorize('users.manage'),
  asyncHandler(async (req, res) => {
    const data = userCreateSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw ApiError.conflict('A user with this email already exists');
    const { password, ...rest } = data;
    const user = await prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 10) } });
    recordAuditLog(req, 'CREATE', 'User', user.id);
    res.status(201).json({ ...user, passwordHash: undefined });
  }),
);

peopleRouter.put(
  '/users/:id',
  authorize('users.manage'),
  asyncHandler(async (req, res) => {
    const data = userCreateSchema.partial().parse(req.body);
    const { password, ...rest } = data;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
    });
    recordAuditLog(req, 'UPDATE', 'User', user.id);
    res.json({ ...user, passwordHash: undefined });
  }),
);

peopleRouter.delete(
  '/users/:id',
  authorize('users.manage'),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) throw ApiError.badRequest('You cannot deactivate your own account');
    await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
    recordAuditLog(req, 'DELETE', 'User', req.params.id);
    res.status(204).send();
  }),
);
