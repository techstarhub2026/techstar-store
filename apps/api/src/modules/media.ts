import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../lib/http.js';
import { validate, requirePermission, audit } from '../middleware/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { storeUpload, toMediaDto } from '../lib/storage.js';
import { config } from '../config/index.js';

export const mediaRouter = Router();

/**
 * Admin media library. Files are uploaded straight from the administrator's own
 * device — drag-and-drop or a file picker — validated by magic bytes, stored
 * under a generated id, and returned immediately so a form can reference them.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 20 },
});

mediaRouter.get(
  '/',
  requirePermission('media.read', 'media.upload'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 40);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where = {
      deletedAt: null,
      ...(q ? { originalFilename: { contains: q } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.mediaFile.count({ where }),
      prisma.mediaFile.findMany({ where, orderBy: { id: 'desc' }, skip, take }),
    ]);
    return collection(
      res,
      rows.map((m) => ({
        ...toMediaDto(m),
        originalFilename: m.originalFilename,
        byteSize: m.byteSize,
        mimeType: m.mimeType,
        referenceCount: m.referenceCount,
        createdAt: m.createdAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

/** Single or multiple upload. Accepts field name `files` or `file`. */
mediaRouter.post(
  '/',
  requirePermission('media.upload'),
  upload.fields([
    { name: 'files', maxCount: 20 },
    { name: 'file', maxCount: 1 },
  ]),
  handler(async (req, res) => {
    const grouped = (req as unknown as { files?: Record<string, Express.Multer.File[]> }).files;
    const list = [...(grouped?.files ?? []), ...(grouped?.file ?? [])];
    if (!list.length) {
      throw new ValidationError([
        { field: 'files', code: 'required', message: 'Choose at least one image to upload' },
      ]);
    }

    const altText = typeof req.body?.altText === 'string' ? req.body.altText : undefined;
    const stored = [];
    for (const f of list) {
      const media = await storeUpload(f.buffer, {
        originalFilename: f.originalname,
        altText,
        uploadedById: req.auth?.uid ?? null,
      });
      stored.push(toMediaDto(media));
    }

    await audit(req, {
      action: 'media.upload',
      entityType: 'media',
      entityId: stored[0]?.id ?? null,
      entityLabel: `${stored.length} file(s)`,
    });

    return created(res, stored);
  }),
);

mediaRouter.patch(
  '/:id',
  requirePermission('media.upload'),
  validate({ body: z.object({ altText: z.string().max(255).nullable().optional() }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const media = await prisma.mediaFile.findFirst({ where: { id, deletedAt: null } });
    if (!media) throw new NotFoundError('Image');
    const updated = await prisma.mediaFile.update({
      where: { id },
      data: { altText: (req.body as { altText?: string | null }).altText ?? null },
    });
    return ok(res, toMediaDto(updated));
  }),
);

mediaRouter.delete(
  '/:id',
  requirePermission('media.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const media = await prisma.mediaFile.findFirst({ where: { id, deletedAt: null } });
    if (!media) throw new NotFoundError('Image');

    // A referenced file cannot be removed — the reference count stops it before
    // the foreign key has to (spec §9.5).
    if (media.referenceCount > 0) {
      throw new ConflictError(
        `This image is used by ${media.referenceCount} item(s). Remove it from them first.`,
      );
    }
    await prisma.mediaFile.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req, {
      action: 'media.delete',
      entityType: 'media',
      entityId: id,
      entityLabel: media.originalFilename,
    });
    return ok(res, { deleted: true });
  }),
);
