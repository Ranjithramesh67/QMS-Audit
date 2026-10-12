import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/http.js';
import { hasPermission } from '../lib/permissions.js';

/**
 * Guards a route to holders of at least one of the supplied permission keys.
 * Use after `authenticate`. A role carrying the `*` wildcard always passes.
 *
 * Note: the name is kept as `authorize` so route definitions read naturally;
 * arguments are permission keys (e.g. `authorize('audits.plan')`).
 */
export function authorize(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(ApiError.unauthorized());
    if (hasPermission(user.permissions, permissions)) return next();
    return next(
      ApiError.forbidden(`Role ${user.role} is not permitted to perform this action`),
    );
  };
}
