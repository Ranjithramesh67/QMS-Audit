import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Error carrying an HTTP status code, surfaced by the global error handler. */
export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }
  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }
}

/** Wraps async route handlers so rejected promises reach the error middleware. */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };

export function parseZod<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw ApiError.badRequest('Validation failed', error.flatten());
    }
    throw error;
  }
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function getPagination(query: Record<string, unknown>): PaginationParams {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(items: T[], total: number, params: PaginationParams) {
  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize) || 1,
  };
}

/** Builds a Prisma `contains` filter clause (case-insensitive) for a search string. */
export function searchFilter(search: string | undefined, fields: string[]) {
  if (!search) return undefined;
  return {
    OR: fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' as const } })),
  };
}
