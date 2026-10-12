import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';

export interface AccessTokenPayload {
  sub: string;
  /** Role code (e.g. ADMIN, QMR) kept for display. Authorisation reads live permissions. */
  role: string;
  email: string;
  name: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Verifies the JWT and loads the current user onto req.user. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized('Missing access token');

    const decoded = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    const user = await prisma.user.findUnique({ where: { id: decoded.sub }, include: { role: true } });
    if (!user || !user.active) throw ApiError.unauthorized('Account is inactive or not found');

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role.code,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.active ? user.role.permissions : [],
      name: user.name,
      plantId: user.plantId,
      departmentId: user.departmentId,
    };
    next();
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    return next(ApiError.unauthorized('Invalid or expired access token'));
  }
}

/** Attaches the user when a valid token is present, otherwise continues anonymously. */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  if (!extractToken(req)) return next();
  return authenticate(req, _res, next);
}
