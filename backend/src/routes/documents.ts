import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, getPagination, paginated, searchFilter } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { upload } from '../middleware/upload.js';
import { recordAuditLog } from '../middleware/auditLog.js';

const documentSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  type: z.enum(['SOP', 'WORK_INSTRUCTION', 'EVIDENCE', 'STANDARD', 'RECORD', 'OTHER']).optional(),
  standardId: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'OBSOLETE']).optional(),
  description: z.string().max(2000).optional().nullable(),
  currentVersion: z.string().max(32).optional(),
});

export const documentsRouter = Router();
documentsRouter.use(authenticate);

documentsRouter.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const params = getPagination(req.query as Record<string, unknown>);
    const { type, status } = req.query as Record<string, string | undefined>;
    const search = String((req.query.search as string) ?? '').trim();
    const where = {
      ...(type ? { type: type as never } : {}),
      ...(status ? { status: status as never } : {}),
      ...(searchFilter(search, ['code', 'name', 'description']) ?? {}),
    };
    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: { uploadedBy: { select: { id: true, name: true } }, _count: { select: { versions: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.document.count({ where }),
    ]);
    res.json(paginated(items, total, params));
  }),
);

documentsRouter.get(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { versions: { orderBy: { createdAt: 'desc' } }, uploadedBy: { select: { id: true, name: true } } },
    });
    if (!document) throw ApiError.notFound('Document not found');
    res.json(document);
  }),
);

// Create document with an optional first-version file upload.
documentsRouter.post(
  '/documents',
  authorize('documents.manage'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const data = documentSchema.parse(req.body);
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const document = await prisma.document.create({
      data: {
        ...data,
        fileUrl,
        fileSize: req.file?.size ?? null,
        mimeType: req.file?.mimetype ?? null,
        uploadedById: req.user!.id,
      },
    });
    if (req.file) {
      await prisma.documentVersion.create({
        data: {
          documentId: document.id,
          version: document.currentVersion,
          fileUrl: fileUrl!,
          fileSize: req.file.size,
          note: 'Initial version',
          createdById: req.user!.id,
        },
      });
    }
    recordAuditLog(req, 'CREATE', 'Document', document.id);
    res.status(201).json(document);
  }),
);

documentsRouter.put(
  '/documents/:id',
  authorize('documents.manage'),
  asyncHandler(async (req, res) => {
    const data = documentSchema.partial().parse(req.body);
    const document = await prisma.document.update({ where: { id: req.params.id }, data });
    recordAuditLog(req, 'UPDATE', 'Document', document.id);
    res.json(document);
  }),
);

// Upload a new version, bump the document's current version pointer.
documentsRouter.post(
  '/documents/:id/versions',
  authorize('documents.manage'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('A file is required');
    const version = z.string().min(1).parse(req.body?.version ?? '');
    const note = (req.body?.note as string) || null;
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) throw ApiError.notFound('Document not found');
    const fileUrl = `/uploads/${req.file.filename}`;
    const [, updated] = await prisma.$transaction([
      prisma.documentVersion.create({
        data: { documentId: document.id, version, fileUrl, fileSize: req.file.size, note, createdById: req.user!.id },
      }),
      prisma.document.update({
        where: { id: document.id },
        data: { currentVersion: version, fileUrl, fileSize: req.file.size, mimeType: req.file.mimetype },
      }),
    ]);
    recordAuditLog(req, 'NEW_VERSION', 'Document', document.id, { version });
    res.status(201).json(updated);
  }),
);

documentsRouter.delete(
  '/documents/:id',
  authorize('documents.delete'),
  asyncHandler(async (req, res) => {
    await prisma.document.update({ where: { id: req.params.id }, data: { status: 'OBSOLETE' } });
    recordAuditLog(req, 'OBSOLETE', 'Document', req.params.id);
    res.status(204).send();
  }),
);

// --- Generic polymorphic attachments (evidence for audits, findings, CAPA) --
documentsRouter.post(
  '/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('A file is required');
    const { entityType, entityId } = z
      .object({ entityType: z.enum(['AUDIT', 'FINDING', 'CAPA', 'RESPONSE']), entityId: z.string().min(1) })
      .parse(req.body);
    const attachment = await prisma.attachment.create({
      data: {
        entityType,
        entityId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileUrl: `/uploads/${req.file.filename}`,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedById: req.user!.id,
        ...(entityType === 'AUDIT' ? { auditId: entityId } : {}),
        ...(entityType === 'FINDING' ? { findingId: entityId } : {}),
        ...(entityType === 'CAPA' ? { capaId: entityId } : {}),
      },
    });
    res.status(201).json(attachment);
  }),
);

documentsRouter.get(
  '/attachments',
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.query as Record<string, string | undefined>;
    const attachments = await prisma.attachment.findMany({
      where: { ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    res.json(attachments);
  }),
);

documentsRouter.delete(
  '/attachments/:id',
  asyncHandler(async (req, res) => {
    await prisma.attachment.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);
