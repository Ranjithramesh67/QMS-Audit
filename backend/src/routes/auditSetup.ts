import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { createCrudRouter, type CrudOptions } from '../lib/crud.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const asDelegate = (value: unknown) => value as CrudOptions['delegate'];

const auditTypeSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  category: z.enum(['SYSTEM', 'PRODUCT', 'PROCESS']),
  description: z.string().max(1000).optional().nullable(),
  active: z.boolean().optional(),
});

const standardSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  version: z.string().max(32).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  active: z.boolean().optional(),
});

const checklistSchema = z.object({
  standardId: z.string().min(1),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  version: z.string().max(32).optional().nullable(),
  active: z.boolean().optional(),
});

const clauseSchema = z.object({
  checklistId: z.string().min(1),
  parentId: z.string().optional().nullable(),
  number: z.string().min(1).max(32),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  requirement: z.string().max(3000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

const programSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  year: z.coerce.number().int().min(2000).max(2100),
  standardId: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']).optional(),
  description: z.string().max(2000).optional().nullable(),
});

export const auditSetupRouter = Router();
auditSetupRouter.use(authenticate);

const cruds: Array<[string, CrudOptions]> = [
  [
    '/audit-types',
    {
      delegate: asDelegate(prisma.auditType),
      createSchema: auditTypeSchema,
      updateSchema: auditTypeSchema.partial(),
      name: 'AuditType',
      searchFields: ['code', 'name'],
      orderBy: { name: 'asc' },
      softDeleteField: 'active',
    },
  ],
  [
    '/standards',
    {
      delegate: asDelegate(prisma.standard),
      createSchema: standardSchema,
      updateSchema: standardSchema.partial(),
      name: 'Standard',
      searchFields: ['code', 'name', 'version'],
      orderBy: { name: 'asc' },
      softDeleteField: 'active',
      include: { _count: { select: { checklists: true, audits: true } } },
    },
  ],
  [
    '/checklists',
    {
      delegate: asDelegate(prisma.checklist),
      createSchema: checklistSchema,
      updateSchema: checklistSchema.partial(),
      name: 'Checklist',
      searchFields: ['code', 'name'],
      orderBy: { name: 'asc' },
      softDeleteField: 'active',
      include: { standard: { select: { id: true, name: true } }, _count: { select: { clauses: true } } },
    },
  ],
  [
    '/clauses',
    {
      delegate: asDelegate(prisma.clause),
      createSchema: clauseSchema,
      updateSchema: clauseSchema.partial(),
      name: 'Clause',
      searchFields: ['number', 'title'],
      orderBy: { sortOrder: 'asc' },
      softDeleteField: 'active',
      include: { checklist: { select: { id: true, name: true } } },
    },
  ],
  [
    '/programs',
    {
      delegate: asDelegate(prisma.auditProgram),
      createSchema: programSchema,
      updateSchema: programSchema.partial(),
      name: 'AuditProgram',
      searchFields: ['code', 'name'],
      orderBy: { year: 'desc' },
      include: { standard: { select: { id: true, name: true } }, _count: { select: { audits: true } } },
    },
  ],
];

// Checklists and clauses are maintained by auditors too, so they use a separate
// permission from audit types/standards/programmes.
const CHECKLIST_PATHS = new Set(['/checklists', '/clauses']);
for (const [path, options] of cruds) {
  const permission = CHECKLIST_PATHS.has(path) ? 'masters.checklists' : 'masters.setup';
  auditSetupRouter.use(path, authorize(permission), createCrudRouter(options));
}

// Full nested clause tree for a checklist.
auditSetupRouter.get('/checklists/:id/tree', authorize('masters.checklists'), async (req, res, next) => {
  try {
    const clauses = await prisma.clause.findMany({
      where: { checklistId: req.params.id },
      orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
    });
    const byId = new Map<string, any>();
    const roots: any[] = [];
    for (const clause of clauses) byId.set(clause.id, { ...clause, children: [] });
    for (const clause of clauses) {
      const node = byId.get(clause.id)!;
      if (clause.parentId && byId.has(clause.parentId)) byId.get(clause.parentId)!.children.push(node);
      else roots.push(node);
    }
    res.json(roots);
  } catch (error) {
    next(error);
  }
});
