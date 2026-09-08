import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { handler, ok, created } from '../../lib/http.js';
import { validate, requirePermission, audit } from '../../middleware/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { toMediaDto } from '../../lib/storage.js';
import { cleanName, sanitizeHtml, stripHtml } from '../../lib/util.js';
import { uniqueSlug } from '../../lib/catalogueOps.js';

/**
 * techstarhub.or.tz homepage building blocks.
 *
 * The marketing site used to hard-code its carousel, highlight cards, impact
 * counters and programme pages directly into index.html. Each is a record here
 * so staff can edit them from the same console as the shop, without touching
 * markup. Gated on the existing `service.*` permissions so no role changes are
 * needed for people who already manage site content.
 */
export const adminSiteRouter = Router();

/** Turns '' into NULL for a named set of optional string columns. */
function blankToNull<T extends Record<string, unknown>>(obj: T, keys: string[]) {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) if (out[k] === '') out[k] = null;
  return out;
}

// ══════════════════════════════════════════════════════ HERO SLIDES ══

const heroSlideBody = z.object({
  title: z.string().min(3, 'Slide title is required').max(200),
  subtitle: z.string().max(600).optional().or(z.literal('')),
  tabLabel: z.string().min(1, 'Tab label is required').max(60),
  imageId: z.number().int().nullable().optional(),
  artworkImageId: z.number().int().nullable().optional(),
  buttonText: z.string().max(40).optional().or(z.literal('')),
  buttonUrl: z.string().max(512).optional().or(z.literal('')),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminSiteRouter.get(
  '/hero-slides',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.heroSlide.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true, artwork: true },
    });
    return ok(res, rows.map((r) => ({
      ...r,
      image: r.image ? toMediaDto(r.image) : null,
      artwork: r.artwork ? toMediaDto(r.artwork) : null,
    })));
  }),
);

adminSiteRouter.post(
  '/hero-slides',
  requirePermission('service.create'),
  validate({ body: heroSlideBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof heroSlideBody>;
    const row = await prisma.heroSlide.create({
      data: {
        ...(blankToNull(b, ['subtitle', 'buttonText', 'buttonUrl']) as z.infer<typeof heroSlideBody>),
        imageId: b.imageId ?? null,
        artworkImageId: b.artworkImageId ?? null,
      },
    });
    await audit(req, { action: 'hero_slide.create', entityType: 'hero_slide', entityId: row.id, entityLabel: row.title });
    return created(res, row);
  }),
);

adminSiteRouter.patch(
  '/hero-slides/:id',
  requirePermission('service.update'),
  validate({ body: heroSlideBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.heroSlide.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Hero slide');
    const b = req.body as Partial<z.infer<typeof heroSlideBody>>;
    const row = await prisma.heroSlide.update({
      where: { id },
      data: {
        ...(b.title ? { title: b.title } : {}),
        ...(b.tabLabel ? { tabLabel: b.tabLabel } : {}),
        ...(b.subtitle !== undefined ? { subtitle: b.subtitle || null } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.artworkImageId !== undefined ? { artworkImageId: b.artworkImageId } : {}),
        ...(b.buttonText !== undefined ? { buttonText: b.buttonText || null } : {}),
        ...(b.buttonUrl !== undefined ? { buttonUrl: b.buttonUrl || null } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'hero_slide.update', entityType: 'hero_slide', entityId: id, entityLabel: row.title });
    return ok(res, row);
  }),
);

adminSiteRouter.delete(
  '/hero-slides/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.heroSlide.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'hero_slide.delete', entityType: 'hero_slide', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ═══════════════════════════════════════════════════ HIGHLIGHT CARDS ══

const highlightBody = z.object({
  pill: z.string().min(1, 'Label is required').max(60),
  title: z.string().min(3, 'Title is required').max(200),
  imageId: z.number().int().nullable().optional(),
  linkUrl: z.string().max(512).optional().or(z.literal('')),
  variant: z.enum(['navy', 'orange']).default('navy'),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminSiteRouter.get(
  '/highlight-cards',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.highlightCard.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(res, rows.map((r) => ({ ...r, image: r.image ? toMediaDto(r.image) : null })));
  }),
);

adminSiteRouter.post(
  '/highlight-cards',
  requirePermission('service.create'),
  validate({ body: highlightBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof highlightBody>;
    const row = await prisma.highlightCard.create({
      data: {
        ...(blankToNull(b, ['linkUrl']) as z.infer<typeof highlightBody>),
        imageId: b.imageId ?? null,
      },
    });
    await audit(req, { action: 'highlight.create', entityType: 'highlight_card', entityId: row.id, entityLabel: row.title });
    return created(res, row);
  }),
);

adminSiteRouter.patch(
  '/highlight-cards/:id',
  requirePermission('service.update'),
  validate({ body: highlightBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.highlightCard.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Highlight card');
    const b = req.body as Partial<z.infer<typeof highlightBody>>;
    const row = await prisma.highlightCard.update({
      where: { id },
      data: {
        ...(b.pill ? { pill: b.pill } : {}),
        ...(b.title ? { title: b.title } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.linkUrl !== undefined ? { linkUrl: b.linkUrl || null } : {}),
        ...(b.variant ? { variant: b.variant } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'highlight.update', entityType: 'highlight_card', entityId: id, entityLabel: row.title });
    return ok(res, row);
  }),
);

adminSiteRouter.delete(
  '/highlight-cards/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.highlightCard.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'highlight.delete', entityType: 'highlight_card', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ═════════════════════════════════════════════════════ IMPACT NUMBERS ══

const statBody = z.object({
  label: z.string().min(1, 'Label is required').max(120),
  value: z.number().int().min(0),
  suffix: z.string().max(10).optional().or(z.literal('')),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminSiteRouter.get(
  '/site-stats',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const rows = await prisma.siteStat.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return ok(res, rows);
  }),
);

adminSiteRouter.post(
  '/site-stats',
  requirePermission('service.create'),
  validate({ body: statBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof statBody>;
    const row = await prisma.siteStat.create({ data: { ...b, suffix: b.suffix || null } });
    await audit(req, { action: 'site_stat.create', entityType: 'site_stat', entityId: row.id, entityLabel: row.label });
    return created(res, row);
  }),
);

adminSiteRouter.patch(
  '/site-stats/:id',
  requirePermission('service.update'),
  validate({ body: statBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.siteStat.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Statistic');
    const b = req.body as Partial<z.infer<typeof statBody>>;
    const row = await prisma.siteStat.update({
      where: { id },
      data: {
        ...(b.label ? { label: b.label } : {}),
        ...(b.value !== undefined ? { value: b.value } : {}),
        ...(b.suffix !== undefined ? { suffix: b.suffix || null } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'site_stat.update', entityType: 'site_stat', entityId: id, entityLabel: row.label });
    return ok(res, row);
  }),
);

adminSiteRouter.delete(
  '/site-stats/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.siteStat.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'site_stat.delete', entityType: 'site_stat', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ══════════════════════════════════════════════ PROGRAMMES / PROJECTS ══

const projectBody = z.object({
  title: z.string().min(3, 'Title is required').max(200).transform(cleanName),
  excerpt: z.string().max(500).optional().or(z.literal('')),
  contentHtml: z.string().min(1, 'Content is required'),
  imageId: z.number().int().nullable().optional(),
  kind: z.enum(['program', 'project']).default('project'),
  status: z.enum(['ongoing', 'completed']).default('ongoing'),
  linkUrl: z.string().trim().url('Enter a full URL, e.g. https://…').max(512).optional().or(z.literal('')),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminSiteRouter.get(
  '/projects',
  requirePermission('service.read'),
  handler(async (req, res) => {
    // `?kind=program` / `?kind=project` scopes the admin's Programs and
    // Projects screens to their own rows — both edit this same table, but an
    // admin managing bootcamp pages should never see (or accidentally
    // reorder into) genuine project entries and vice versa.
    const kind = req.query.kind === 'program' || req.query.kind === 'project' ? req.query.kind : undefined;
    const rows = await prisma.project.findMany({
      where: { deletedAt: null, ...(kind ? { kind } : {}) },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(res, rows.map((r) => ({ ...r, image: r.image ? toMediaDto(r.image) : null })));
  }),
);

adminSiteRouter.post(
  '/projects',
  requirePermission('service.create'),
  validate({ body: projectBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof projectBody>;
    const html = sanitizeHtml(b.contentHtml);
    const row = await prisma.$transaction(async (tx) =>
      tx.project.create({
        data: {
          title: b.title,
          slug: await uniqueSlug(tx, 'project', b.title),
          excerpt: b.excerpt || null,
          contentHtml: html,
          contentText: stripHtml(html),
          imageId: b.imageId ?? null,
          kind: b.kind,
          status: b.status,
          linkUrl: b.linkUrl || null,
          position: b.position,
          isActive: b.isActive,
        },
      }),
    );
    await audit(req, { action: 'project.create', entityType: 'project', entityId: row.id, entityLabel: row.title });
    return created(res, row);
  }),
);

adminSiteRouter.patch(
  '/projects/:id',
  requirePermission('service.update'),
  validate({ body: projectBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Programme');
    const b = req.body as Partial<z.infer<typeof projectBody>>;
    const html = b.contentHtml ? sanitizeHtml(b.contentHtml) : undefined;
    const row = await prisma.project.update({
      where: { id },
      data: {
        ...(b.title ? { title: b.title } : {}),
        ...(b.excerpt !== undefined ? { excerpt: b.excerpt || null } : {}),
        ...(html !== undefined ? { contentHtml: html, contentText: stripHtml(html) } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.kind !== undefined ? { kind: b.kind } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(b.linkUrl !== undefined ? { linkUrl: b.linkUrl || null } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'project.update', entityType: 'project', entityId: id, entityLabel: row.title });
    return ok(res, row);
  }),
);

adminSiteRouter.delete(
  '/projects/:id',
  requirePermission('service.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'project.delete', entityType: 'project', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ══════════════════════════════════════════ HOME — "WHAT WE OFFER" ══
// A single block rather than a list, so it is fetched and saved whole
// instead of being created and deleted.

const offerBody = z.object({
  title: z.string().min(2, 'Title is required').max(160),
  lead: z.string().max(600).optional().or(z.literal('')),
  bullets: z.array(z.string().max(400)).max(8).default([]),
  imageId: z.number().int().nullable().optional(),
  linkText: z.string().max(40).optional().or(z.literal('')),
  linkUrl: z.string().max(512).optional().or(z.literal('')),
});

adminSiteRouter.get(
  '/home-offer',
  requirePermission('service.read'),
  handler(async (_req, res) => {
    const row = await prisma.homeOffer.findFirst({ include: { image: true } });
    if (!row) return ok(res, null);
    return ok(res, {
      ...row,
      bullets: Array.isArray(row.bullets) ? row.bullets : [],
      image: row.image ? toMediaDto(row.image) : null,
    });
  }),
);

adminSiteRouter.put(
  '/home-offer',
  requirePermission('service.update'),
  validate({ body: offerBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof offerBody>;
    const existing = await prisma.homeOffer.findFirst();

    const data = {
      title: b.title,
      lead: b.lead || null,
      bullets: b.bullets.filter((t) => t.trim().length > 0),
      imageId: b.imageId ?? null,
      linkText: b.linkText || null,
      linkUrl: b.linkUrl || null,
    };

    const row = existing
      ? await prisma.homeOffer.update({ where: { id: existing.id }, data })
      : await prisma.homeOffer.create({ data });

    await audit(req, {
      action: 'home_offer.update',
      entityType: 'home_offer',
      entityId: row.id,
      entityLabel: row.title,
    });
    return ok(res, row);
  }),
);
