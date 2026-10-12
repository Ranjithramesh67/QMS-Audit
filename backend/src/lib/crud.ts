import { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { asyncHandler, ApiError, getPagination, paginated, searchFilter } from './http.js';
import { recordAuditLog } from '../middleware/auditLog.js';

/* Minimal structural Prisma delegate so the factory stays decoupled from codegen types. */
interface Delegate {
  findMany: (args?: any) => Promise<any[]>;
  count: (args?: any) => Promise<number>;
  findUnique: (args: any) => Promise<any | null>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
}

export interface CrudOptions {
  delegate: Delegate;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  name: string;
  searchFields?: string[];
  include?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  /** When set, deletes flip this boolean field instead of removing the row. */
  softDeleteField?: string;
  /** Optional hook to scope/inject filters per request (e.g. tenant or plant scoping). */
  scope?: (req: any) => Record<string, unknown> | undefined;
}

/**
 * Builds a standard REST resource: list (pagination + search), read, create,
 * update and delete. Auth/role guards are supplied by the caller when mounting.
 */
export function createCrudRouter(options: CrudOptions): Router {
  const {
    delegate,
    createSchema,
    updateSchema,
    name,
    searchFields = [],
    include,
    orderBy = { createdAt: 'desc' },
    softDeleteField,
    scope,
  } = options;

  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const params = getPagination(req.query as Record<string, unknown>);
      const search = String((req.query.search as string) ?? '').trim();
      const where = { ...(scope?.(req) ?? {}), ...(searchFilter(search, searchFields) ?? {}) };
      const [items, total] = await Promise.all([
        delegate.findMany({ where, include, orderBy, skip: params.skip, take: params.take }),
        delegate.count({ where }),
      ]);
      res.json(paginated(items, total, params));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const item = await delegate.findUnique({ where: { id: req.params.id }, include });
      if (!item) throw ApiError.notFound(`${name} not found`);
      res.json(item);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const data = createSchema.parse(req.body);
      const created = await delegate.create({ data, include });
      recordAuditLog(req, 'CREATE', name, created.id, { data });
      res.status(201).json(created);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const data = updateSchema.parse(req.body);
      const updated = await delegate.update({ where: { id: req.params.id }, data, include });
      recordAuditLog(req, 'UPDATE', name, updated.id, { data });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      if (softDeleteField) {
        await delegate.update({ where: { id: req.params.id }, data: { [softDeleteField]: false } });
      } else {
        await delegate.delete({ where: { id: req.params.id } });
      }
      recordAuditLog(req, 'DELETE', name, req.params.id);
      res.status(204).send();
    }),
  );

  return router;
}
