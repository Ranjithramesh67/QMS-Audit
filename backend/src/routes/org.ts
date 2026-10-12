import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { createCrudRouter, type CrudOptions } from '../lib/crud.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const asDelegate = (value: unknown) => value as CrudOptions['delegate'];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const companySchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  website: z.string().max(200).optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

const plantSchema = z.object({
  companyId: z.string().min(1),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  active: z.boolean().optional(),
});

const departmentSchema = z.object({
  plantId: z.string().min(1),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  headName: z.string().max(200).optional().nullable(),
  active: z.boolean().optional(),
});

const processSchema = z.object({
  departmentId: z.string().min(1),
  parentId: z.string().optional().nullable(),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  owner: z.string().max(200).optional().nullable(),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const orgRouter = Router();
orgRouter.use(authenticate);

const cruds: Array<[string, CrudOptions]> = [
  [
    '/companies',
    {
      delegate: asDelegate(prisma.company),
      createSchema: companySchema,
      updateSchema: companySchema.partial(),
      name: 'Company',
      searchFields: ['code', 'name', 'city'],
      orderBy: { name: 'asc' },
      softDeleteField: 'active',
      include: { _count: { select: { plants: true } } },
    },
  ],
  [
    '/plants',
    {
      delegate: asDelegate(prisma.plant),
      createSchema: plantSchema,
      updateSchema: plantSchema.partial(),
      name: 'Plant',
      searchFields: ['code', 'name', 'city'],
      orderBy: { name: 'asc' },
      softDeleteField: 'active',
      include: { company: { select: { id: true, name: true } }, _count: { select: { departments: true } } },
    },
  ],
  [
    '/departments',
    {
      delegate: asDelegate(prisma.department),
      createSchema: departmentSchema,
      updateSchema: departmentSchema.partial(),
      name: 'Department',
      searchFields: ['code', 'name', 'headName'],
      orderBy: { name: 'asc' },
      softDeleteField: 'active',
      include: {
        plant: { select: { id: true, name: true, companyId: true } },
        _count: { select: { processes: true } },
      },
    },
  ],
  [
    '/processes',
    {
      delegate: asDelegate(prisma.process),
      createSchema: processSchema,
      updateSchema: processSchema.partial(),
      name: 'Process',
      searchFields: ['code', 'name', 'owner'],
      orderBy: { code: 'asc' },
      softDeleteField: 'active',
      include: { department: { select: { id: true, name: true } } },
    },
  ],
];

for (const [path, options] of cruds) {
  orgRouter.use(path, authorize('masters.org'), createCrudRouter(options));
}

// Nested process tree for a department (used by planning scope selection).
orgRouter.get('/departments/:id/tree', async (req, res, next) => {
  try {
    const departments = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { processes: { orderBy: { code: 'asc' } } },
    });
    if (!departments) return res.status(404).json({ error: { message: 'Department not found' } });
    res.json(departments);
  } catch (error) {
    next(error);
  }
});
