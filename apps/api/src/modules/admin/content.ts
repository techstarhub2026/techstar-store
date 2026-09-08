import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../../lib/http.js';
import { validate, requirePermission, audit } from '../../middleware/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { toMediaDto } from '../../lib/storage.js';
import { cleanName, sanitizeHtml, stripHtml } from '../../lib/util.js';
import { uniqueSlug } from '../../lib/catalogueOps.js';

export const adminContentRouter = Router();

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0E7C5A');

// ════════════════════════════════════════════════════════════ BANNERS ══

const bannerBody = z.object({
  title: z.string().min(2, 'Banner title is required').max(120),
  titleColor: hex.default('#FFFFFF'),
  subtitle: z.string().max(300).optional().or(z.literal('')),
  subtitleColor: hex.default('#FFFFFF'),
  backgroundColor: hex.default('#0A5C43'),
  imageId: z.number().int({ message: 'An image is required' }),
  linkUrl: z.string().max(512).optional().or(z.literal('')),
  buttonText: z.string().max(40).optional().or(z.literal('')),
  buttonBackground: hex.default('#0E7C5A'),
  buttonTextColor: hex.default('#FFFFFF'),
  placement: z.string().max(20).default('home'),
  position: z.number().int().default(0),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/banners',
  requirePermission('banner.read'),
  handler(async (_req, res) => {
    const rows = await prisma.banner.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'desc' }],
      include: { image: true },
    });
    return ok(res, rows.map((b) => ({ ...b, image: b.image ? toMediaDto(b.image) : null })));
  }),
);

adminContentRouter.post(
  '/banners',
  requirePermission('banner.create'),
  validate({ body: bannerBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof bannerBody>;
    const row = await prisma.banner.create({
      data: { ...b, subtitle: b.subtitle || null, linkUrl: b.linkUrl || null, buttonText: b.buttonText || null },
    });
    await prisma.mediaFile.update({ where: { id: b.imageId }, data: { referenceCount: { increment: 1 } } });
    await audit(req, { action: 'banner.create', entityType: 'banner', entityId: row.id, entityLabel: row.title });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/banners/:id',
  requirePermission('banner.update'),
  validate({ body: bannerBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.banner.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Banner');
    const b = req.body as Partial<z.infer<typeof bannerBody>>;

    if (b.imageId && b.imageId !== before.imageId) {
      if (before.imageId) {
        await prisma.mediaFile.update({
          where: { id: before.imageId },
          data: { referenceCount: { decrement: 1 } },
        }).catch(() => undefined);
      }
      await prisma.mediaFile.update({
        where: { id: b.imageId },
        data: { referenceCount: { increment: 1 } },
      });
    }

    const row = await prisma.banner.update({ where: { id }, data: b as object });
    await audit(req, { action: 'banner.update', entityType: 'banner', entityId: id, entityLabel: row.title, before, after: row });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/banners/:id',
  requirePermission('banner.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await prisma.banner.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundError('Banner');
    await prisma.banner.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    if (row.imageId) {
      await prisma.mediaFile.update({
        where: { id: row.imageId },
        data: { referenceCount: { decrement: 1 } },
      }).catch(() => undefined);
    }
    await audit(req, { action: 'banner.delete', entityType: 'banner', entityId: id, entityLabel: row.title });
    return ok(res, { deleted: true });
  }),
);

// ═══════════════════════════════════════════════════════════ SERVICES ══

const serviceBody = z.object({
  heading: z
    .string()
    .min(3, 'Service heading is required')
    .max(160)
    .transform(cleanName)
    .refine((v) => v.split(/\s+/).length <= 15, 'Heading should not exceed 15 words'),
  excerpt: z.string().max(500).optional().or(z.literal('')),
  contentHtml: z.string().min(1, 'Service content is required'),
  imageId: z.number().int().nullable().optional(),
  icon: z.string().max(60).optional().or(z.literal('')),
  linkUrl: z.string().max(512).optional().or(z.literal('')),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/services',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.service.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'desc' }],
      include: { image: true },
    });
    return ok(res, rows.map((s) => ({ ...s, image: s.image ? toMediaDto(s.image) : null })));
  }),
);

adminContentRouter.post(
  '/services',
  requirePermission('service.create'),
  validate({ body: serviceBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof serviceBody>;
    const html = sanitizeHtml(b.contentHtml);
    const row = await prisma.$transaction(async (tx) =>
      tx.service.create({
        data: {
          heading: b.heading,
          slug: await uniqueSlug(tx, 'service', b.heading),
          excerpt: b.excerpt || null,
          contentHtml: html,
          contentText: stripHtml(html),
          imageId: b.imageId ?? null,
          icon: b.icon || null,
          linkUrl: b.linkUrl || null,
          position: b.position,
          isActive: b.isActive,
          publishedAt: new Date(),
        },
      }),
    );
    await audit(req, { action: 'service.create', entityType: 'service', entityId: row.id, entityLabel: row.heading });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/services/:id',
  requirePermission('service.update'),
  validate({ body: serviceBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.service.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Service');
    const b = req.body as Partial<z.infer<typeof serviceBody>>;
    const html = b.contentHtml ? sanitizeHtml(b.contentHtml) : undefined;
    const row = await prisma.service.update({
      where: { id },
      data: {
        ...(b.heading ? { heading: b.heading } : {}),
        ...(b.excerpt !== undefined ? { excerpt: b.excerpt || null } : {}),
        ...(html !== undefined ? { contentHtml: html, contentText: stripHtml(html) } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.icon !== undefined ? { icon: b.icon || null } : {}),
        ...(b.linkUrl !== undefined ? { linkUrl: b.linkUrl || null } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'service.update', entityType: 'service', entityId: id, entityLabel: row.heading });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/services/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.service.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'service.delete', entityType: 'service', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ═══════════════════════════════════════════════════════════ PARTNERS ══

const partnerBody = z.object({
  name: z.string().min(2, 'Partner name is required').max(120).transform(cleanName),
  websiteUrl: z.string().max(512).optional().or(z.literal('')),
  logoId: z.number().int().nullable().optional(),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/partners',
  requirePermission('partner.read'),
  handler(async (_req, res) => {
    const rows = await prisma.partner.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { logo: true },
    });
    return ok(res, rows.map((p) => ({ ...p, logo: p.logo ? toMediaDto(p.logo) : null })));
  }),
);

adminContentRouter.post(
  '/partners',
  requirePermission('partner.create'),
  validate({ body: partnerBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof partnerBody>;
    const row = await prisma.partner.create({
      data: { ...b, websiteUrl: b.websiteUrl || null, logoId: b.logoId ?? null },
    });
    await audit(req, { action: 'partner.create', entityType: 'partner', entityId: row.id, entityLabel: row.name });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/partners/:id',
  requirePermission('partner.update'),
  validate({ body: partnerBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await prisma.partner.update({ where: { id }, data: req.body as object });
    await audit(req, { action: 'partner.update', entityType: 'partner', entityId: id, entityLabel: row.name });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/partners/:id',
  requirePermission('partner.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.partner.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'partner.delete', entityType: 'partner', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ═══════════════════════════════════════════════════════════ ARTICLES ══

const articleBody = z.object({
  title: z.string().min(3, 'Article heading is required').max(200).transform(cleanName),
  excerpt: z.string().min(10, 'Article description is required').max(500),
  contentHtml: z.string().min(1, 'Article content is required'),
  coverImageId: z.number().int().nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  metaTitle: z.string().max(70).optional().or(z.literal('')),
  metaDescription: z.string().max(160).optional().or(z.literal('')),
});

adminContentRouter.get(
  '/articles',
  requirePermission('article.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 20);
    const where = { deletedAt: null };
    const [total, rows] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take,
        include: { coverImage: true, author: { select: { username: true } } },
      }),
    ]);
    return collection(
      res,
      rows.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        excerpt: a.excerpt,
        status: a.status,
        coverImage: a.coverImage ? toMediaDto(a.coverImage) : null,
        author: a.author?.username ?? null,
        commentCount: a.commentCount,
        viewCount: a.viewCount,
        publishedAt: a.publishedAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminContentRouter.get(
  '/articles/:id',
  requirePermission('article.read'),
  handler(async (req, res) => {
    const a = await prisma.article.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
      include: { coverImage: true },
    });
    if (!a) throw new NotFoundError('Article');
    return ok(res, { ...a, coverImage: a.coverImage ? toMediaDto(a.coverImage) : null });
  }),
);

adminContentRouter.post(
  '/articles',
  requirePermission('article.create'),
  validate({ body: articleBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof articleBody>;
    const html = sanitizeHtml(b.contentHtml);
    const row = await prisma.$transaction(async (tx) =>
      tx.article.create({
        data: {
          title: b.title,
          slug: await uniqueSlug(tx, 'article', b.title),
          excerpt: b.excerpt,
          contentHtml: html,
          contentText: stripHtml(html),
          coverImageId: b.coverImageId ?? null,
          authorId: req.auth?.uid ?? null,
          status: b.status,
          publishedAt: b.status === 'published' ? new Date() : null,
          metaTitle: b.metaTitle || null,
          metaDescription: b.metaDescription || null,
        },
      }),
    );
    await audit(req, { action: 'article.create', entityType: 'article', entityId: row.id, entityLabel: row.title });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/articles/:id',
  requirePermission('article.update'),
  validate({ body: articleBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.article.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Article');
    const b = req.body as Partial<z.infer<typeof articleBody>>;
    const html = b.contentHtml ? sanitizeHtml(b.contentHtml) : undefined;
    const row = await prisma.article.update({
      where: { id },
      data: {
        ...(b.title ? { title: b.title } : {}),
        ...(b.excerpt !== undefined ? { excerpt: b.excerpt } : {}),
        ...(html !== undefined ? { contentHtml: html, contentText: stripHtml(html) } : {}),
        ...(b.coverImageId !== undefined ? { coverImageId: b.coverImageId } : {}),
        ...(b.status
          ? {
              status: b.status,
              publishedAt:
                b.status === 'published' && !before.publishedAt ? new Date() : before.publishedAt,
            }
          : {}),
        ...(b.metaTitle !== undefined ? { metaTitle: b.metaTitle || null } : {}),
        ...(b.metaDescription !== undefined ? { metaDescription: b.metaDescription || null } : {}),
      },
    });
    await audit(req, { action: 'article.update', entityType: 'article', entityId: id, entityLabel: row.title });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/articles/:id',
  requirePermission('article.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.article.update({ where: { id }, data: { deletedAt: new Date(), status: 'archived' } });
    await audit(req, { action: 'article.delete', entityType: 'article', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ═════════════════════════════════════════════ COMMENTS & REVIEWS ══

adminContentRouter.get(
  '/comments',
  requirePermission('comment.moderate'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const where = { deletedAt: null, ...(status !== 'all' ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.comment.count({ where }),
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { article: { select: { title: true, slug: true } } },
      }),
    ]);
    return collection(
      res,
      rows.map((c) => ({
        id: c.id,
        author: c.authorName,
        body: c.body,
        status: c.status,
        article: c.article,
        createdAt: c.createdAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminContentRouter.post(
  '/comments/:id/moderate',
  requirePermission('comment.moderate'),
  validate({ body: z.object({ status: z.enum(['approved', 'rejected', 'spam']) }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const comment = await prisma.comment.findFirst({ where: { id, deletedAt: null } });
    if (!comment) throw new NotFoundError('Comment');

    await prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id }, data: { status } });
      const approved = await tx.comment.count({
        where: { articleId: comment.articleId, status: 'approved', deletedAt: null },
      });
      await tx.article.update({
        where: { id: comment.articleId },
        data: { commentCount: approved },
      });
    });
    await audit(req, { action: 'comment.moderate', entityType: 'comment', entityId: id, after: { status } });
    return ok(res, { status });
  }),
);

adminContentRouter.delete(
  '/comments/:id',
  requirePermission('comment.moderate'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'comment.delete', entityType: 'comment', entityId: id });
    return ok(res, { deleted: true });
  }),
);

adminContentRouter.get(
  '/reviews',
  requirePermission('review.moderate'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const where = { deletedAt: null, ...(status !== 'all' ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { product: { select: { name: true, slug: true } } },
      }),
    ]);
    return collection(
      res,
      rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author: r.authorName,
        verifiedPurchase: Boolean(r.orderItemId),
        status: r.status,
        product: r.product,
        createdAt: r.createdAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminContentRouter.post(
  '/reviews/:id/moderate',
  requirePermission('review.moderate'),
  validate({ body: z.object({ status: z.enum(['approved', 'rejected', 'spam']) }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const review = await prisma.review.findFirst({ where: { id, deletedAt: null } });
    if (!review) throw new NotFoundError('Review');

    await prisma.$transaction(async (tx) => {
      await tx.review.update({ where: { id }, data: { status } });
      const agg = await tx.review.aggregate({
        where: { productId: review.productId, status: 'approved', deletedAt: null },
        _count: { rating: true },
        _avg: { rating: true },
      });
      await tx.product.update({
        where: { id: review.productId },
        data: {
          reviewCount: agg._count.rating,
          averageRating: agg._avg.rating ?? 0,
        },
      });
    });
    await audit(req, { action: 'review.moderate', entityType: 'review', entityId: id, after: { status } });
    return ok(res, { status });
  }),
);

// ═══════════════════════════════════════════════════════════════ FAQS ══

const faqBody = z.object({
  question: z.string().min(5).max(300),
  answerHtml: z.string().min(2),
  group: z.string().max(60).default('General'),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/faqs',
  requirePermission('faq.read', 'article.read'),
  handler(async (_req, res) => {
    const rows = await prisma.faq.findMany({
      where: { deletedAt: null },
      orderBy: [{ group: 'asc' }, { position: 'asc' }],
    });
    return ok(res, rows);
  }),
);

adminContentRouter.post(
  '/faqs',
  requirePermission('faq.create', 'article.create'),
  validate({ body: faqBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof faqBody>;
    const row = await prisma.faq.create({
      data: { ...b, answerHtml: sanitizeHtml(b.answerHtml) },
    });
    await audit(req, { action: 'faq.create', entityType: 'faq', entityId: row.id, entityLabel: row.question });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/faqs/:id',
  requirePermission('faq.update', 'article.update'),
  validate({ body: faqBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body as Partial<z.infer<typeof faqBody>>;
    const row = await prisma.faq.update({
      where: { id },
      data: { ...b, ...(b.answerHtml ? { answerHtml: sanitizeHtml(b.answerHtml) } : {}) },
    });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/faqs/:id',
  requirePermission('faq.delete', 'article.delete'),
  handler(async (req, res) => {
    await prisma.faq.update({
      where: { id: Number(req.params.id) },
      data: { deletedAt: new Date(), isActive: false },
    });
    return ok(res, { deleted: true });
  }),
);

// ═══════════════════════════════════════════════════ CONTACT MESSAGES ══

adminContentRouter.get(
  '/contact-messages',
  requirePermission('customer.read', 'campaign.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where = { deletedAt: null, ...(status && status !== 'all' ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({ where, orderBy: { id: 'desc' }, skip, take }),
    ]);
    return collection(res, rows, pageMeta(page, pageSize, total));
  }),
);

adminContentRouter.patch(
  '/contact-messages/:id',
  requirePermission('customer.read', 'campaign.read'),
  validate({ body: z.object({ status: z.enum(['new', 'read', 'replied', 'archived', 'spam']) }) }),
  handler(async (req, res) => {
    const row = await prisma.contactMessage.update({
      where: { id: Number(req.params.id) },
      data: req.body as object,
    });
    return ok(res, row);
  }),
);

// ═════════════════════════════════════════ WEBSITE — TEAM MEMBERS ══
// techstarhub.or.tz content, managed from the same admin as the store
// (spec: one admin, full CRUD, everything the site shows). Gated by the
// existing "service" permissions rather than new ones so no seed/role
// change is needed for staff who can already manage site content.

const teamMemberBody = z.object({
  name: z.string().min(2, 'Name is required').max(120).transform(cleanName),
  role: z.string().min(2, 'Role / title is required').max(160),
  bio: z.string().max(500).optional().or(z.literal('')),
  imageId: z.number().int().nullable().optional(),
  facebookUrl: z.string().max(512).optional().or(z.literal('')),
  xUrl: z.string().max(512).optional().or(z.literal('')),
  instagramUrl: z.string().max(512).optional().or(z.literal('')),
  linkedinUrl: z.string().max(512).optional().or(z.literal('')),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/team-members',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.teamMember.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(res, rows.map((m) => ({ ...m, image: m.image ? toMediaDto(m.image) : null })));
  }),
);

adminContentRouter.post(
  '/team-members',
  requirePermission('service.create'),
  validate({ body: teamMemberBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof teamMemberBody>;
    const row = await prisma.teamMember.create({
      data: {
        ...b,
        bio: b.bio || null,
        imageId: b.imageId ?? null,
        facebookUrl: b.facebookUrl || null,
        xUrl: b.xUrl || null,
        instagramUrl: b.instagramUrl || null,
        linkedinUrl: b.linkedinUrl || null,
      },
    });
    await audit(req, { action: 'team_member.create', entityType: 'team_member', entityId: row.id, entityLabel: row.name });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/team-members/:id',
  requirePermission('service.update'),
  validate({ body: teamMemberBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.teamMember.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Team member');
    const b = req.body as Partial<z.infer<typeof teamMemberBody>>;
    const row = await prisma.teamMember.update({
      where: { id },
      data: {
        ...(b.name ? { name: b.name } : {}),
        ...(b.role ? { role: b.role } : {}),
        ...(b.bio !== undefined ? { bio: b.bio || null } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.facebookUrl !== undefined ? { facebookUrl: b.facebookUrl || null } : {}),
        ...(b.xUrl !== undefined ? { xUrl: b.xUrl || null } : {}),
        ...(b.instagramUrl !== undefined ? { instagramUrl: b.instagramUrl || null } : {}),
        ...(b.linkedinUrl !== undefined ? { linkedinUrl: b.linkedinUrl || null } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'team_member.update', entityType: 'team_member', entityId: id, entityLabel: row.name });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/team-members/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.teamMember.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'team_member.delete', entityType: 'team_member', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ══════════════════════════════════════════════════ WEBSITE — EVENTS ══

const eventBody = z.object({
  title: z.string().min(3, 'Title is required').max(200).transform(cleanName),
  excerpt: z.string().max(500).optional().or(z.literal('')),
  contentHtml: z.string().min(1, 'Event details are required'),
  imageId: z.number().int().nullable().optional(),
  location: z.string().max(255).optional().or(z.literal('')),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  registerUrl: z.string().max(512).optional().or(z.literal('')),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/events',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.event.findMany({
      where: { deletedAt: null },
      orderBy: [{ startsAt: 'asc' }, { id: 'desc' }],
      include: { image: true },
    });
    return ok(res, rows.map((e) => ({ ...e, image: e.image ? toMediaDto(e.image) : null })));
  }),
);

adminContentRouter.post(
  '/events',
  requirePermission('service.create'),
  validate({ body: eventBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof eventBody>;
    const html = sanitizeHtml(b.contentHtml);
    const row = await prisma.$transaction(async (tx) =>
      tx.event.create({
        data: {
          title: b.title,
          slug: await uniqueSlug(tx, 'event', b.title),
          excerpt: b.excerpt || null,
          contentHtml: html,
          contentText: stripHtml(html),
          imageId: b.imageId ?? null,
          location: b.location || null,
          startsAt: b.startsAt ?? null,
          endsAt: b.endsAt ?? null,
          registerUrl: b.registerUrl || null,
          position: b.position,
          isActive: b.isActive,
        },
      }),
    );
    await audit(req, { action: 'event.create', entityType: 'event', entityId: row.id, entityLabel: row.title });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/events/:id',
  requirePermission('service.update'),
  validate({ body: eventBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Event');
    const b = req.body as Partial<z.infer<typeof eventBody>>;
    const html = b.contentHtml ? sanitizeHtml(b.contentHtml) : undefined;
    const row = await prisma.event.update({
      where: { id },
      data: {
        ...(b.title ? { title: b.title } : {}),
        ...(b.excerpt !== undefined ? { excerpt: b.excerpt || null } : {}),
        ...(html !== undefined ? { contentHtml: html, contentText: stripHtml(html) } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.location !== undefined ? { location: b.location || null } : {}),
        ...(b.startsAt !== undefined ? { startsAt: b.startsAt } : {}),
        ...(b.endsAt !== undefined ? { endsAt: b.endsAt } : {}),
        ...(b.registerUrl !== undefined ? { registerUrl: b.registerUrl || null } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'event.update', entityType: 'event', entityId: id, entityLabel: row.title });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/events/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.event.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'event.delete', entityType: 'event', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ═════════════════════════════════════════════════ WEBSITE — COURSES ══

const courseBody = z.object({
  name: z.string().min(3, 'Course name is required').max(200).transform(cleanName),
  category: z.enum(['school-kids', 'everyone']).default('everyone'),
  priceAmount: z.number().int().min(0).default(0),
  excerpt: z.string().max(500).optional().or(z.literal('')),
  contentHtml: z.string().min(1, 'Course details are required'),
  imageId: z.number().int().nullable().optional(),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminContentRouter.get(
  '/courses',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.course.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'desc' }],
      include: { image: true },
    });
    return ok(res, rows.map((c) => ({ ...c, image: c.image ? toMediaDto(c.image) : null })));
  }),
);

adminContentRouter.post(
  '/courses',
  requirePermission('service.create'),
  validate({ body: courseBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof courseBody>;
    const html = sanitizeHtml(b.contentHtml);
    const row = await prisma.$transaction(async (tx) =>
      tx.course.create({
        data: {
          name: b.name,
          slug: await uniqueSlug(tx, 'course', b.name),
          category: b.category,
          priceAmount: b.priceAmount,
          excerpt: b.excerpt || null,
          contentHtml: html,
          contentText: stripHtml(html),
          imageId: b.imageId ?? null,
          position: b.position,
          isActive: b.isActive,
        },
      }),
    );
    await audit(req, { action: 'course.create', entityType: 'course', entityId: row.id, entityLabel: row.name });
    return created(res, row);
  }),
);

adminContentRouter.patch(
  '/courses/:id',
  requirePermission('service.update'),
  validate({ body: courseBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Course');
    const b = req.body as Partial<z.infer<typeof courseBody>>;
    const html = b.contentHtml ? sanitizeHtml(b.contentHtml) : undefined;
    const row = await prisma.course.update({
      where: { id },
      data: {
        ...(b.name ? { name: b.name } : {}),
        ...(b.category ? { category: b.category } : {}),
        ...(b.priceAmount !== undefined ? { priceAmount: b.priceAmount } : {}),
        ...(b.excerpt !== undefined ? { excerpt: b.excerpt || null } : {}),
        ...(html !== undefined ? { contentHtml: html, contentText: stripHtml(html) } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'course.update', entityType: 'course', entityId: id, entityLabel: row.name });
    return ok(res, row);
  }),
);

adminContentRouter.delete(
  '/courses/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.course.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'course.delete', entityType: 'course', entityId: id });
    return ok(res, { deleted: true });
  }),
);
