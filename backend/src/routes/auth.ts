import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../lib/http.js';
import { authenticate, signAccessToken } from '../middleware/auth.js';
import { recordAuditLog } from '../middleware/auditLog.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: true,
        plant: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
    if (!user || !user.active) throw ApiError.unauthorized('Invalid credentials');
    if (!user.role.active) throw ApiError.unauthorized('Your role has been disabled');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw ApiError.unauthorized('Invalid credentials');

    const token = signAccessToken({ sub: user.id, role: user.role.code, email: user.email, name: user.name });
    recordAuditLog(req, 'LOGIN', 'User', user.id);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.code,
        roleId: user.roleId,
        roleName: user.role.name,
        permissions: user.role.permissions,
        designation: user.designation,
        plant: user.plant,
        department: user.department,
      },
    });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        roleId: true,
        designation: true,
        phone: true,
        plantId: true,
        departmentId: true,
        role: { select: { code: true, name: true, permissions: true, active: true } },
        plant: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
    if (!user) throw ApiError.unauthorized();
    const { role, ...rest } = user;
    res.json({
      ...rest,
      role: role.code,
      roleName: role.name,
      permissions: role.active ? role.permissions : [],
    });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw ApiError.notFound('User not found');
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw ApiError.badRequest('Current password is incorrect');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    recordAuditLog(req, 'CHANGE_PASSWORD', 'User', user.id);
    res.json({ message: 'Password updated' });
  }),
);
