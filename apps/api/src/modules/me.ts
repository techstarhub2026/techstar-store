import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { handler, ok, created, noContent } from '../lib/http.js';
import { validate, requireAuth } from '../middleware/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { loadPrincipal, publicUser } from '../lib/auth.js';
import { canonicalisePhone, cleanName } from '../lib/util.js';
import { storeImage } from '../lib/storage.js';
import { config } from '../config/index.js';

export const meRouter = Router();
meRouter.use(requireAuth);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

meRouter.get(
  '/',
  handler(async (req, res) => {
    const principal = await loadPrincipal(req.auth!.uid);
    if (!principal) throw new NotFoundError('Account');
    return ok(res, publicUser(principal.user, principal.roles, principal.perms));
  }),
);

meRouter.patch(
  '/',
  validate({
    body: z.object({
      username: z.string().min(2, 'Username is required').max(80).transform(cleanName).optional(),
      email: z.string().email('Enter a valid email').max(255).toLowerCase().optional(),
      phone: z.string().max(20).optional(),
      marketingOptIn: z.boolean().optional(),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as {
      username?: string; email?: string; phone?: string; marketingOptIn?: boolean;
    };
    const data: Record<string, unknown> = {};

    if (b.username) data.username = b.username;
    if (b.marketingOptIn !== undefined) data.marketingOptIn = b.marketingOptIn;

    if (b.phone !== undefined) {
      const phone = canonicalisePhone(b.phone);
      if (!phone) {
        throw new ValidationError([
          { field: 'phone', code: 'invalid', message: 'Phone number must be 12 characters long' },
        ]);
      }
      const clash = await prisma.user.findFirst({
        where: { phone, id: { not: req.auth!.uid }, deletedAt: null },
      });
      if (clash) throw new ConflictError('That phone number is already in use.');
      data.phone = phone;
    }

    if (b.email !== undefined) {
      const clash = await prisma.user.findFirst({
        where: { email: b.email, id: { not: req.auth!.uid }, deletedAt: null },
      });
      if (clash) throw new ConflictError('That email address is already in use.');
      const current = await prisma.user.findUnique({ where: { id: req.auth!.uid } });
      if (current?.email !== b.email) {
        data.email = b.email;
        data.emailVerifiedAt = null; // changing the address re-triggers verification
      }
    }

    await prisma.user.update({ where: { id: req.auth!.uid }, data });
    const principal = await loadPrincipal(req.auth!.uid);
    return ok(res, publicUser(principal!.user, principal!.roles, principal!.perms));
  }),
);

/** Profile photo, uploaded from the customer's own device. */
meRouter.post(
  '/avatar',
  avatarUpload.single('file'),
  handler(async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      throw new ValidationError([
        { field: 'file', code: 'required', message: 'Choose an image to upload' },
      ]);
    }
    const media = await storeImage(file.buffer, {
      originalFilename: file.originalname,
      uploadedById: req.auth!.uid,
    });
    await prisma.user.update({
      where: { id: req.auth!.uid },
      data: { profileImageId: media.id },
    });
    await prisma.mediaFile.update({
      where: { id: media.id },
      data: { referenceCount: { increment: 1 } },
    });
    const principal = await loadPrincipal(req.auth!.uid);
    return ok(res, publicUser(principal!.user, principal!.roles, principal!.perms));
  }),
);

// ───────────────────────────────────────────────────────── addresses ──

const addressBody = z.object({
  label: z.string().max(40).optional(),
  receiverName: z.string().min(2, "Receiver's name is required").max(120).transform(cleanName),
  email: z.string().email('Enter a valid email').max(255).optional().or(z.literal('')),
  phone: z.string().min(1, 'Phone is required'),
  country: z.string().max(64).default('Tanzania'),
  region: z.string().min(1, 'Region is required').max(64),
  district: z.string().min(1, 'District is required').max(64),
  streetAddress: z.string().min(5, 'Street address is required').max(255),
  postalCode: z.string().max(20).optional().or(z.literal('')),
  isDefault: z.boolean().default(true),
});

meRouter.get(
  '/addresses',
  handler(async (req, res) => {
    const rows = await prisma.userAddress.findMany({
      where: { userId: req.auth!.uid, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
    });
    return ok(res, rows);
  }),
);

meRouter.post(
  '/addresses',
  validate({ body: addressBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof addressBody>;
    const phone = canonicalisePhone(b.phone);
    if (!phone) {
      throw new ValidationError([
        { field: 'phone', code: 'invalid', message: 'Phone number must be 12 characters long' },
      ]);
    }
    if (b.isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId: req.auth!.uid },
        data: { isDefault: false },
      });
    }
    const row = await prisma.userAddress.create({
      data: {
        userId: req.auth!.uid,
        label: b.label || null,
        receiverName: b.receiverName,
        email: b.email || null,
        phone,
        country: b.country || 'Tanzania',
        region: b.region,
        district: b.district,
        streetAddress: b.streetAddress,
        postalCode: b.postalCode || null,
        isDefault: b.isDefault,
      },
    });
    return created(res, row);
  }),
);

meRouter.patch(
  '/addresses/:id',
  validate({ body: addressBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.userAddress.findFirst({
      where: { id, userId: req.auth!.uid, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Address');

    const b = req.body as Partial<z.infer<typeof addressBody>>;
    const data: Record<string, unknown> = { ...b };
    if (b.phone) {
      const phone = canonicalisePhone(b.phone);
      if (!phone) {
        throw new ValidationError([
          { field: 'phone', code: 'invalid', message: 'Phone number must be 12 characters long' },
        ]);
      }
      data.phone = phone;
    }
    if (b.isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId: req.auth!.uid },
        data: { isDefault: false },
      });
    }
    const row = await prisma.userAddress.update({ where: { id }, data });
    return ok(res, row);
  }),
);

meRouter.delete(
  '/addresses/:id',
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.userAddress.updateMany({
      where: { id, userId: req.auth!.uid },
      data: { deletedAt: new Date() },
    });
    return noContent(res);
  }),
);
