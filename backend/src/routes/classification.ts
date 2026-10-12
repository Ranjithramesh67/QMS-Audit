import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { createCrudRouter, type CrudOptions } from '../lib/crud.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const asDelegate = (value: unknown) => value as CrudOptions['delegate'];

const findingTypeSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  requiresCapa: z.boolean().optional(),
  active: z.boolean().optional(),
});

const severitySchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  weight: z.coerce.number().int().min(0).max(100).optional(),
  color: z.string().max(32).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

export const classificationRouter = Router();
classificationRouter.use(authenticate);

classificationRouter.use(
  '/finding-types',
  authorize('masters.classification'),
  createCrudRouter({
    delegate: asDelegate(prisma.findingTypeConfig),
    createSchema: findingTypeSchema,
    updateSchema: findingTypeSchema.partial(),
    name: 'FindingTypeConfig',
    searchFields: ['code', 'name'],
    orderBy: { code: 'asc' },
    softDeleteField: 'active',
  }),
);

classificationRouter.use(
  '/severities',
  authorize('masters.classification'),
  createCrudRouter({
    delegate: asDelegate(prisma.severityConfig),
    createSchema: severitySchema,
    updateSchema: severitySchema.partial(),
    name: 'SeverityConfig',
    searchFields: ['code', 'name'],
    orderBy: { weight: 'desc' },
    softDeleteField: 'active',
  }),
);
