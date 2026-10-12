import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { env } from '../config/env.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      message = `Duplicate value for ${(err.meta?.target as string[] | undefined)?.join(', ') ?? 'unique field'}`;
    } else if (err.code === 'P2025') {
      status = 404;
      message = 'Record not found';
    } else {
      status = 400;
      message = `Database error (${err.code})`;
    }
  } else if (err instanceof Error) {
    message = err.message;
  }

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: {
      message,
      status,
      ...(details ? { details } : {}),
      ...(env.isProd ? {} : { stack: err instanceof Error ? err.stack : undefined }),
    },
  });
}
