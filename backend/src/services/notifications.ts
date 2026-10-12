import nodemailer from 'nodemailer';
import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function sendEmail(to: string, subject: string, text: string) {
  const mailer = getTransporter();
  if (!mailer) return false;
  try {
    await mailer.sendMail({ from: env.smtp.from, to, subject, text });
    return true;
  } catch (error) {
    console.warn('[notifications] email failed', error);
    return false;
  }
}

interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

/** Creates an in-app notification and attempts an email delivery. */
export async function notify(input: NotifyInput) {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (user?.email) {
    const sent = await sendEmail(user.email, input.title, input.message);
    if (sent) {
      await prisma.notification.update({ where: { id: notification.id }, data: { emailedAt: new Date() } });
    }
  }
  return notification;
}

/** Broadcasts a notification to every active user holding one of the given role codes. */
export async function notifyRoles(roleCodes: string[], payload: Omit<NotifyInput, 'userId'>) {
  const users = await prisma.user.findMany({
    where: { active: true, role: { code: { in: roleCodes } } },
    select: { id: true },
  });
  await Promise.all(users.map((u) => notify({ ...payload, userId: u.id })));
}

type Db = PrismaClient | Prisma.TransactionClient;
export const __db = prisma as Db;
