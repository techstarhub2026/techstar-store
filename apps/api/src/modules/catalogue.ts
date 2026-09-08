import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handler, ok, collection, pagination, pageMeta } from '../lib/http.js';
import { validate } from '../middleware/index.js';
import { GoneError, NotFoundError } from '../lib/errors.js';
import { toMediaDto } from '../lib/storage.js';
import {
  loadDiscountResolver,
  productCardDto,
  productCardInclude,
  productDetailDto,
  productInclude,
} from '../lib/serialize.js';
import { cleanName } from '../lib/util.js';
import {
  bundleFor, recommendedFor, relatedProducts, trendingProducts,
} from '../lib/recommendations.js';

export const catalogueRouter = Router();

const LIVE = { deletedAt: null, status: 'active' } as const;

// ─────────────────────────────────────────────────────────── taxonomy ──

catalogueRouter.get(
  '/categories',
  handler(async (req, res) => {
    const hideEmpty = req.query.hideEmpty !== 'false';
    const categories = await prisma.category.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: {
        image: true,
        subcategories: {
          where: {
            deletedAt: null,
            isActive: true,
            ...(hideEmpty ? { productCount: { gt: 0 } } : {}),
          },
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
        },
      },
    });

    const data = categories
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        skuCode: c.skuCode,
        description: c.description,
        image: c.image ? toMediaDto(c.image) : null,
        productCount: c.productCount,
        subcategories: c.subcategories.map((s) => ({
          slug: s.slug,
          name: s.name,
          skuCode: s.skuCode,
          productCount: s.productCount,
        })),
      }))
      // A category whose every subcategory is empty is a dead end in navigation
      .filter((c) => (hideEmpty ? c.subcategories.length > 0 : true));

    return ok(res, data);
  }),
);

catalogueRouter.get(
  '/categories/:slug',
  handler(async (req, res) => {
    const category = await prisma.category.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      include: {
        image: true,
        subcategories: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
        },
      },
    });
    if (!category) throw new NotFoundError('Category');
    return ok(res, {
      slug: category.slug,
      name: category.name,
      description: category.description,
      image: category.image ? toMediaDto(category.image) : null,
      productCount: category.productCount,
      subcategories: category.subcategories.map((s) => ({
        slug: s.slug,
        name: s.name,
        productCount: s.productCount,
      })),
    });
  }),
);

catalogueRouter.get(
  '/subcategories',
  handler(async (req, res) => {
    const categorySlug = typeof req.query.categorySlug === 'string' ? req.query.categorySlug : undefined;
    const rows = await prisma.subcategory.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { category: true },
    });
    return ok(
      res,
      rows.map((s) => ({
        slug: s.slug,
        name: s.name,
        skuCode: s.skuCode,
        productCount: s.productCount,
        category: { slug: s.category.slug, name: s.category.name },
      })),
    );
  }),
);

// ─────────────────────────────────────────────────────────── products ──

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  sort: z
    .enum(['bestSelling', 'newest', 'priceAsc', 'priceDesc', 'name', 'random'])
    .default('newest'),
  categorySlug: z.string().optional(),
  subcategorySlug: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  onOffer: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  q: z.string().max(160).optional(),
});

function orderFor(sort: string) {
  switch (sort) {
    case 'bestSelling':
      return [{ orderCount: 'desc' as const }, { id: 'desc' as const }];
    case 'priceAsc':
      return [{ minPriceAmount: 'asc' as const }];
    case 'priceDesc':
      return [{ minPriceAmount: 'desc' as const }];
    case 'name':
      return [{ name: 'asc' as const }];
    default:
      return [{ publishedAt: 'desc' as const }, { id: 'desc' as const }];
  }
}

catalogueRouter.get(
  '/products',
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const where: Record<string, unknown> = { ...LIVE };

    if (q.subcategorySlug) where.subcategory = { slug: q.subcategorySlug };
    else if (q.categorySlug) where.subcategory = { category: { slug: q.categorySlug } };
    if (q.inStock === 'true') where.totalStock = { gt: 0 };
    if (q.featured === 'true') where.isFeatured = true;
    if (q.minPrice != null || q.maxPrice != null) {
      where.minPriceAmount = {
        ...(q.minPrice != null ? { gte: q.minPrice } : {}),
        ...(q.maxPrice != null ? { lte: q.maxPrice } : {}),
      };
    }
    if (q.q) {
      const term = q.q.trim();
      where.OR = [
        { name: { contains: term } },
        { brand: { contains: term } },
        { manufacturerPartNumber: { contains: term } },
        { skuPrefix: { startsWith: term } },
      ];
    }

    const skip = (q.page - 1) * q.pageSize;
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: q.sort === 'random' ? [{ id: 'asc' }] : orderFor(q.sort),
        skip: q.sort === 'random' ? 0 : skip,
        take: q.sort === 'random' ? 200 : q.pageSize,
        include: productCardInclude,
      }),
    ]);

    const resolve = await loadDiscountResolver();
    let cards = rows.map((p) => productCardDto(p as never, resolve));

    if (q.sort === 'random') {
      cards = cards.sort(() => Math.random() - 0.5).slice(0, q.pageSize);
    }
    if (q.onOffer === 'true') cards = cards.filter((c) => c.discount);

    return collection(res, cards, pageMeta(q.page, q.pageSize, total));
  }),
);

catalogueRouter.get(
  '/products/:slug',
  handler(async (req, res) => {
    const slug = req.params.slug;
    const product = await prisma.product.findFirst({
      where: { slug },
      include: productInclude,
    });

    if (!product) {
      const retired = await prisma.productSlugHistory.findUnique({
        where: { slug },
        include: { product: { select: { slug: true, deletedAt: true } } },
      });
      if (retired?.product && !retired.product.deletedAt) {
        return res.status(301).json({
          data: { redirectTo: retired.product.slug },
          error: { code: 'MOVED', message: 'This product has a new address.' },
        });
      }
      throw new NotFoundError('Product');
    }
    if (product.deletedAt) throw new GoneError('This product is no longer available.');

    const resolve = await loadDiscountResolver();
    await prisma.product
      .update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    return ok(res, productDetailDto(product as never, resolve));
  }),
);

catalogueRouter.get(
  '/products/:slug/related',
  handler(async (req, res) => {
    const cards = await relatedProducts(req.params.slug);
    if (!cards) throw new NotFoundError('Product');
    return ok(res, cards);
  }),
);

/** The two strongest companions, for the "frequently bought together" bundle. */
catalogueRouter.get(
  '/products/:slug/bundle',
  handler(async (req, res) => ok(res, await bundleFor(req.params.slug))),
);

/** Order velocity over a recent window. */
catalogueRouter.get(
  '/products-trending',
  handler(async (_req, res) => ok(res, await trendingProducts())),
);

/**
 * Personalised picks. Signed-in shoppers are seeded from their purchase
 * history; guests may pass the slugs their browser remembers viewing. With
 * neither, this falls back to trending so the rail is never empty.
 */
catalogueRouter.get(
  '/recommendations',
  handler(async (req, res) => {
    const viewed = typeof req.query.viewed === 'string'
      ? req.query.viewed.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
      : [];

    const personal = await recommendedFor({
      userId: req.auth?.uid ?? null,
      viewedSlugs: viewed,
    });

    if (personal) return ok(res, personal);
    return ok(res, await trendingProducts());
  }),
);

// ───────────────────────────────────────────────────────────── search ──

const searchQuery = z.object({
  q: z.string().min(1).max(160),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  suggest: z.enum(['true', 'false']).optional(),
});

/**
 * Four-pass ranking (spec §16.2): exact SKU or MPN first, then name prefix,
 * then name contains, then description. A shopper typing "74HC14" must get that
 * exact part before anything that merely mentions it.
 */
catalogueRouter.get(
  '/search',
  validate({ query: searchQuery }),
  handler(async (req, res) => {
    const { q, page, pageSize, suggest } = req.query as unknown as z.infer<typeof searchQuery>;
    const term = cleanName(q);
    const isSuggest = suggest === 'true';

    const rows = await prisma.product.findMany({
      where: {
        ...LIVE,
        OR: [
          { name: { contains: term } },
          { brand: { contains: term } },
          { manufacturerPartNumber: { contains: term } },
          { skuPrefix: { startsWith: term } },
          { descriptionText: { contains: term } },
          { variants: { some: { sku: { startsWith: term }, deletedAt: null } } },
        ],
      },
      include: productCardInclude,
      take: 400,
    });

    const lower = term.toLowerCase();
    const score = (p: (typeof rows)[number]) => {
      const name = p.name.toLowerCase();
      if (p.skuPrefix === term || p.manufacturerPartNumber?.toLowerCase() === lower) return 0;
      if (p.variants.some((v) => v.sku === term)) return 0;
      if (name === lower) return 1;
      if (name.startsWith(lower)) return 2;
      if (name.includes(lower)) return 3;
      if ((p.brand ?? '').toLowerCase().includes(lower)) return 4;
      return 5;
    };
    const ranked = rows
      .map((p) => ({ p, s: score(p) }))
      .sort((a, b) => a.s - b.s || b.p.orderCount - a.p.orderCount)
      .map((x) => x.p);

    const resolve = await loadDiscountResolver();

    if (isSuggest) {
      return ok(res, ranked.slice(0, 8).map((p) => productCardDto(p as never, resolve)));
    }

    // Log the term once per session for the merchandising report (spec §16.4)
    const sessionId = (req.headers['x-session-id'] as string | undefined)?.slice(0, 32) ?? null;
    prisma.searchLog
      .create({
        data: {
          term: term.slice(0, 160),
          normalisedTerm: lower.slice(0, 160),
          resultCount: ranked.length,
          userId: req.auth?.uid ?? null,
          sessionId,
        },
      })
      .catch(() => undefined);

    const start = (page - 1) * pageSize;
    return collection(
      res,
      ranked.slice(start, start + pageSize).map((p) => productCardDto(p as never, resolve)),
      pageMeta(page, pageSize, ranked.length),
    );
  }),
);

// ─────────────────────────────────────────────────────────── reviews ──

catalogueRouter.get(
  '/products/:slug/reviews',
  handler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      select: { id: true, reviewCount: true, averageRating: true },
    });
    if (!product) throw new NotFoundError('Product');

    const { page, pageSize, skip, take } = pagination(req, 10);
    const where = { productId: product.id, status: 'approved', deletedAt: null };
    const [total, rows, buckets] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.review.groupBy({ by: ['rating'], where, _count: { rating: true } }),
    ]);

    const histogram: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const b of buckets) histogram[String(b.rating)] = b._count.rating;

    return res.json({
      data: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author: r.authorName,
        verifiedPurchase: Boolean(r.orderItemId),
        createdAt: r.createdAt,
      })),
      meta: {
        ...pageMeta(page, pageSize, total),
        summary: {
          count: product.reviewCount,
          average: Number(product.averageRating),
          histogram,
        },
      },
    });
  }),
);
