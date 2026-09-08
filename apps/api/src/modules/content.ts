import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../lib/http.js';
import { validate, requireAuth } from '../middleware/index.js';
import { NotFoundError } from '../lib/errors.js';
import { toMediaDto } from '../lib/storage.js';
import { money, cleanName } from '../lib/util.js';
import { getSettings } from '../lib/settings.js';

export const contentRouter = Router();

// ─────────────────────────────────────────────────────────── banners ──

contentRouter.get(
  '/banners',
  handler(async (req, res) => {
    const placement = typeof req.query.placement === 'string' ? req.query.placement : 'home';
    const now = new Date();
    const rows = await prisma.banner.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        placement,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(
      res,
      rows.map((b) => ({
        id: b.id,
        title: b.title,
        titleColor: b.titleColor,
        subtitle: b.subtitle,
        subtitleColor: b.subtitleColor,
        backgroundColor: b.backgroundColor,
        image: b.image ? toMediaDto(b.image) : null,
        linkUrl: b.linkUrl,
        buttonText: b.buttonText,
        buttonBackground: b.buttonBackground,
        buttonTextColor: b.buttonTextColor,
      })),
    );
  }),
);

// ────────────────────────────────────────────────────────── partners ──

contentRouter.get(
  '/partners',
  handler(async (_req, res) => {
    const rows = await prisma.partner.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { logo: true },
    });
    return ok(
      res,
      rows.map((p) => ({
        name: p.name,
        websiteUrl: p.websiteUrl,
        logo: p.logo ? toMediaDto(p.logo) : null,
      })),
    );
  }),
);

// ────────────────────────────────────────────────────────── services ──

contentRouter.get(
  '/services',
  handler(async (_req, res) => {
    const rows = await prisma.service.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { id: 'desc' }],
      include: { image: true },
    });
    return ok(
      res,
      rows.map((s) => ({
        slug: s.slug,
        heading: s.heading,
        excerpt: s.excerpt,
        image: s.image ? toMediaDto(s.image) : null,
      })),
    );
  }),
);

contentRouter.get(
  '/services/:slug',
  handler(async (req, res) => {
    const s = await prisma.service.findFirst({
      where: { slug: req.params.slug, deletedAt: null, isActive: true },
      include: { image: true },
    });
    if (!s) throw new NotFoundError('Service');
    const others = await prisma.service.findMany({
      where: { deletedAt: null, isActive: true, id: { not: s.id } },
      take: 5,
      include: { image: true },
    });
    return ok(res, {
      slug: s.slug,
      heading: s.heading,
      excerpt: s.excerpt,
      contentHtml: s.contentHtml,
      image: s.image ? toMediaDto(s.image) : null,
      publishedAt: s.publishedAt,
      others: others.map((o) => ({
        slug: o.slug,
        heading: o.heading,
        image: o.image ? toMediaDto(o.image) : null,
      })),
    });
  }),
);

// ────────────────────────────────────────────────────────── articles ──

contentRouter.get(
  '/articles',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 9);
    const where = { deletedAt: null, status: 'published' };
    const [total, rows] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
        include: { coverImage: true, author: { select: { username: true } } },
      }),
    ]);
    return collection(
      res,
      rows.map((a) => ({
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        coverImage: a.coverImage ? toMediaDto(a.coverImage) : null,
        author: a.author?.username ?? 'TechStar Store',
        commentCount: a.commentCount,
        publishedAt: a.publishedAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

contentRouter.get(
  '/articles/:slug',
  handler(async (req, res) => {
    const a = await prisma.article.findFirst({
      where: { slug: req.params.slug, deletedAt: null, status: 'published' },
      include: { coverImage: true, author: { select: { username: true } } },
    });
    if (!a) throw new NotFoundError('Article');

    await prisma.article
      .update({ where: { id: a.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    const [comments, latest] = await Promise.all([
      prisma.comment.findMany({
        where: { articleId: a.id, status: 'approved', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.article.findMany({
        where: { deletedAt: null, status: 'published', id: { not: a.id } },
        orderBy: { publishedAt: 'desc' },
        take: 5,
        include: { coverImage: true },
      }),
    ]);

    return ok(res, {
      slug: a.slug,
      title: a.title,
      excerpt: a.excerpt,
      contentHtml: a.contentHtml,
      coverImage: a.coverImage ? toMediaDto(a.coverImage) : null,
      author: a.author?.username ?? 'TechStar Store',
      publishedAt: a.publishedAt,
      comments: comments.map((c) => ({
        id: c.id,
        author: c.authorName,
        body: c.body,
        createdAt: c.createdAt,
      })),
      latest: latest.map((l) => ({
        slug: l.slug,
        title: l.title,
        coverImage: l.coverImage ? toMediaDto(l.coverImage) : null,
        publishedAt: l.publishedAt,
      })),
    });
  }),
);

contentRouter.post(
  '/articles/:slug/comments',
  requireAuth,
  validate({ body: z.object({ body: z.string().min(2, 'Comment body is required').max(3000) }) }),
  handler(async (req, res) => {
    const article = await prisma.article.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
    });
    if (!article) throw new NotFoundError('Article');
    const user = await prisma.user.findUnique({ where: { id: req.auth!.uid } });

    await prisma.comment.create({
      data: {
        articleId: article.id,
        userId: req.auth!.uid,
        authorName: user?.username ?? 'Customer',
        body: (req.body as { body: string }).body,
        status: 'pending',
      },
    });
    return created(res, {
      message: 'Thank you for your comment — it will appear once approved.',
    });
  }),
);

// ──────────────────────────────────────────── website home page blocks ──

/**
 * Everything the techstarhub.or.tz homepage needs in one call — its carousel,
 * highlight cards and impact counters. One request keeps the static page's
 * hydration simple and avoids three round trips before the hero can render.
 */
contentRouter.get(
  '/site/home',
  handler(async (_req, res) => {
    const [slides, highlights, stats, services, offer] = await Promise.all([
      prisma.heroSlide.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { image: true, artwork: true },
      }),
      prisma.highlightCard.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { image: true },
      }),
      prisma.siteStat.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      prisma.service.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { image: true },
      }),
      prisma.homeOffer.findFirst({ include: { image: true } }),
    ]);

    return ok(res, {
      heroSlides: slides.map((s) => ({
        title: s.title,
        subtitle: s.subtitle,
        tabLabel: s.tabLabel,
        image: s.image ? toMediaDto(s.image).lg : null,
        artwork: s.artwork ? toMediaDto(s.artwork).lg : null,
        buttonText: s.buttonText,
        buttonUrl: s.buttonUrl,
      })),
      highlights: highlights.map((h) => ({
        pill: h.pill,
        title: h.title,
        image: h.image ? toMediaDto(h.image).md : null,
        linkUrl: h.linkUrl,
        variant: h.variant,
      })),
      stats: stats.map((s) => ({ label: s.label, value: s.value, suffix: s.suffix })),
      services: services.map((v) => ({
        slug: v.slug,
        heading: v.heading,
        excerpt: v.excerpt,
        image: v.image ? toMediaDto(v.image).md : null,
        icon: v.icon,
        linkUrl: v.linkUrl,
      })),
      offer: offer
        ? {
            title: offer.title,
            lead: offer.lead,
            bullets: Array.isArray(offer.bullets) ? offer.bullets : [],
            image: offer.image ? toMediaDto(offer.image).lg : null,
            linkText: offer.linkText,
            linkUrl: offer.linkUrl,
          }
        : null,
    });
  }),
);

contentRouter.get(
  '/site/projects',
  handler(async (_req, res) => {
    const rows = await prisma.project.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(
      res,
      rows.map((p) => ({
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        contentHtml: p.contentHtml,
        image: p.image ? toMediaDto(p.image) : null,
      })),
    );
  }),
);

// ─────────────────────────────────────────────────────── website team ──

contentRouter.get(
  '/team',
  handler(async (_req, res) => {
    const rows = await prisma.teamMember.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(
      res,
      rows.map((m) => ({
        name: m.name,
        role: m.role,
        bio: m.bio,
        image: m.image ? toMediaDto(m.image) : null,
        socials: {
          facebook: m.facebookUrl,
          x: m.xUrl,
          instagram: m.instagramUrl,
          linkedin: m.linkedinUrl,
        },
      })),
    );
  }),
);

// ───────────────────────────────────────────────────── website events ──

contentRouter.get(
  '/events',
  handler(async (_req, res) => {
    const now = new Date();
    const rows = await prisma.event.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      include: { image: true },
    });
    return ok(
      res,
      rows.map((e) => ({
        slug: e.slug,
        title: e.title,
        excerpt: e.excerpt,
        image: e.image ? toMediaDto(e.image) : null,
        location: e.location,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        registerUrl: e.registerUrl,
      })),
    );
  }),
);

// ──────────────────────────────────────── website courses (techstarhub) ──

/**
 * Field names deliberately mirror the shape techstarhub's courses.html
 * already renders (courseName/courseCategory/coursePrice/briefDescription/
 * imgUrl/_id) — this replaces the page's old fetch to the standalone
 * techstar-admin.onrender.com service without touching its render code.
 */
contentRouter.get(
  '/courses',
  handler(async (_req, res) => {
    const rows = await prisma.course.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { id: 'desc' }],
      include: { image: true },
    });
    return ok(
      res,
      rows.map((c) => ({
        _id: c.slug,
        courseName: c.name,
        courseCategory: c.category,
        coursePrice: c.priceAmount,
        briefDescription: c.excerpt ?? '',
        imgUrl: c.image ? toMediaDto(c.image).md : '',
      })),
    );
  }),
);

// ─────────────────────────────────────────────────────────────── FAQs ──

contentRouter.get(
  '/faqs',
  handler(async (_req, res) => {
    const rows = await prisma.faq.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ group: 'asc' }, { position: 'asc' }],
    });
    const groups: Record<string, { question: string; answerHtml: string }[]> = {};
    for (const f of rows) {
      (groups[f.group] ??= []).push({ question: f.question, answerHtml: f.answerHtml });
    }
    return ok(
      res,
      Object.entries(groups).map(([group, items]) => ({ group, items })),
    );
  }),
);

// ────────────────────────────────────────────── shipping & locations ──

contentRouter.get(
  '/shipping-methods',
  handler(async (req, res) => {
    const region = typeof req.query.region === 'string' ? req.query.region : undefined;
    const rows = await prisma.shippingMethod.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { costAmount: 'asc' }],
    });
    return ok(
      res,
      rows.map((m) => ({
        slug: m.slug,
        name: m.name,
        description: m.description,
        cost: money(m.costAmount),
        requiresShippingAddress: m.requiresShippingAddress,
        acceptsMobilePayment: m.acceptsMobilePayment,
        isCashOnDelivery: m.isCashOnDelivery,
        freeOver: m.freeOverAmount ? money(m.freeOverAmount) : null,
        estimatedDays:
          m.estimatedDaysMin && m.estimatedDaysMax
            ? { min: m.estimatedDaysMin, max: m.estimatedDaysMax }
            : null,
      })),
    );
  }),
);

contentRouter.get(
  '/locations/regions',
  handler(async (_req, res) => {
    const rows = await prisma.region.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    return ok(res, rows.map((r) => r.name));
  }),
);

contentRouter.get(
  '/locations/regions/:region/districts',
  handler(async (req, res) => {
    const region = await prisma.region.findFirst({
      where: { name: req.params.region },
      include: { districts: { orderBy: [{ position: 'asc' }, { name: 'asc' }] } },
    });
    if (!region) return ok(res, []);
    return ok(res, region.districts.map((d) => d.name));
  }),
);

// ────────────────────────────────────────────────────────── settings ──

contentRouter.get(
  '/settings/public',
  handler(async (_req, res) => {
    const s = await getSettings();
    return ok(res, {
      store: {
        name: s['store.name'] ?? 'TechStar Store',
        legalName: s['store.legalName'] ?? 'TechStar Store Limited',
        tagline: s['store.tagline'] ?? 'Build. Learn. Innovate.',
        registrationCountry: s['store.registrationCountry'] ?? 'Tanzania',
        tin: s['store.tin'] ?? '',
        registrationNumber: s['store.registrationNumber'] ?? '',
        poBox: s['store.poBox'] ?? '',
      },
      contact: {
        phonePrimary: s['contact.phonePrimary'] ?? '',
        phoneSecondary: s['contact.phoneSecondary'] ?? '',
        email: s['contact.email'] ?? '',
        whatsapp: s['contact.whatsapp'] ?? '',
        address: s['contact.address'] ?? '',
        latitude: Number(s['contact.latitude'] ?? -6.7924),
        longitude: Number(s['contact.longitude'] ?? 39.2083),
        openingHours: s['contact.openingHours'] ?? '',
      },
      social: {
        facebook: s['social.facebook'] ?? '',
        instagram: s['social.instagram'] ?? '',
        x: s['social.x'] ?? '',
        linkedin: s['social.linkedin'] ?? '',
        youtube: s['social.youtube'] ?? '',
      },
      payment: {
        tillMpesa: s['payment.tillMpesa'] ?? '',
        tillMixx: s['payment.tillMixx'] ?? '',
        tillAirtel: s['payment.tillAirtel'] ?? '',
        instructionsSw: s['payment.instructionsSw'] ?? '',
        instructionsEn: s['payment.instructionsEn'] ?? '',
      },
      currency: {
        code: s['currency.code'] ?? 'TZS',
        fractionDigits: Number(s['currency.fractionDigits'] ?? 0),
      },
      policies: {
        returnsWindowDays: Number(s['policies.returnsWindowDays'] ?? 7),
        invoiceTerms: s['policies.invoiceTerms'] ?? '',
      },
      features: {
        reviews: s['features.reviews'] !== 'false',
        comments: s['features.comments'] !== 'false',
        wishlist: s['features.wishlist'] !== 'false',
        guestCheckout: s['features.guestCheckout'] !== 'false',
        delegatedPayment: s['features.delegatedPayment'] !== 'false',
      },
      pageImages: {
        about: s['pages.aboutImage'] ?? '',
        privacy: s['pages.privacyImage'] ?? '',
        terms: s['pages.termsImage'] ?? '',
      },
    });
  }),
);

// ─────────────────────────────────────────────────── contact messages ──

contentRouter.post(
  '/contact-messages',
  validate({
    body: z.object({
      name: z.string().min(2, 'Name is required').max(120).transform(cleanName),
      email: z.string().email('Email not valid').max(255),
      subject: z.string().max(200).optional().or(z.literal('')),
      message: z.string().min(10, 'Message is required').max(3000),
      sendCopy: z.boolean().default(false),
      website: z.string().max(0).optional(), // honeypot — bots fill it, humans cannot see it
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as {
      name: string; email: string; subject?: string;
      message: string; sendCopy: boolean;
    };
    await prisma.contactMessage.create({
      data: {
        name: b.name,
        email: b.email.toLowerCase(),
        subject: b.subject || null,
        message: b.message,
        sendCopy: b.sendCopy,
        ipAddress: req.ip?.slice(0, 45) ?? null,
      },
    });
    return created(res, {
      message: 'Thank you for getting in touch with TechStar Store',
    });
  }),
);
