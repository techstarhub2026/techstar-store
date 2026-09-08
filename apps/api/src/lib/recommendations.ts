import { prisma } from './prisma.js';
import { loadDiscountResolver, productCardDto, productCardInclude } from './serialize.js';

/**
 * Recommendations.
 *
 * The core is item-to-item collaborative filtering — "customers who bought this
 * also bought" — scored by *lift* rather than raw co-occurrence count, so a
 * genuinely related part beats a popular one that merely appears in many
 * baskets. Jumper wires ship with everything; lift stops them from being
 * recommended alongside everything.
 *
 *     lift(a→b) = P(b | a) / P(b)
 *
 * Every surface degrades gracefully: a store with no order history yet still
 * gets sensible same-shelf suggestions instead of an empty rail.
 */

const LIVE = { deletedAt: null, status: 'active' } as const;

/** Orders that actually represent a purchase decision — unpaid baskets lie. */
const REAL_ORDER = { paymentStatus: { not: 'unpaid' } } as const;

interface ScoredId {
  productId: number;
  score: number;
}

/**
 * Co-occurrence scores for a set of "seed" products the shopper has shown
 * interest in. Returns product ids ranked by summed lift.
 */
async function coOccurring(seedIds: number[], excludeIds: number[]): Promise<ScoredId[]> {
  if (!seedIds.length) return [];

  const seedOrders = await prisma.orderItem.findMany({
    where: { productId: { in: seedIds }, order: REAL_ORDER },
    select: { orderId: true },
    take: 2000,
  });
  const orderIds = [...new Set(seedOrders.map((o) => o.orderId))];
  if (!orderIds.length) return [];

  const [neighbours, totalOrders] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { orderId: { in: orderIds }, NOT: { productId: null } },
      _count: { productId: true },
    }),
    prisma.order.count({ where: REAL_ORDER }),
  ]);

  const candidateIds = neighbours
    .map((n) => n.productId)
    .filter((id): id is number => id != null && !excludeIds.includes(id));
  if (!candidateIds.length) return [];

  // Global popularity is the denominator in lift — how often each candidate
  // appears across ALL orders, not just the ones containing the seeds.
  const globalCounts = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { productId: { in: candidateIds }, order: REAL_ORDER },
    _count: { productId: true },
  });
  const globalById = new Map(globalCounts.map((g) => [g.productId, g._count.productId]));

  const basket = orderIds.length;
  return neighbours
    .filter((n) => n.productId != null && candidateIds.includes(n.productId))
    .map((n) => {
      const together = n._count.productId;
      const overall = globalById.get(n.productId) ?? 1;
      const confidence = together / basket;          // P(b | a)
      const prior = Math.max(overall / Math.max(totalOrders, 1), 1e-6); // P(b)
      // Damped by co-occurrence count so a single shared order cannot spike
      // an otherwise-unrelated product to the top on lift alone.
      const support = together / (together + 2);
      return { productId: n.productId as number, score: (confidence / prior) * support };
    })
    .sort((a, b) => b.score - a.score);
}

/** Hydrates ranked ids into storefront product cards, preserving rank order. */
async function hydrate(ids: number[]) {
  if (!ids.length) return [];
  const [rows, resolve] = await Promise.all([
    prisma.product.findMany({ where: { ...LIVE, id: { in: ids } }, include: productCardInclude }),
    loadDiscountResolver(),
  ]);
  const byId = new Map(rows.map((p) => [p.id, productCardDto(p as never, resolve)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Same-shelf best sellers — the cold-start fallback for every surface. */
async function sameShelf(subcategoryId: number, excludeIds: number[], take: number) {
  if (take <= 0) return [];
  const rows = await prisma.product.findMany({
    where: { ...LIVE, subcategoryId, id: { notIn: excludeIds } },
    orderBy: [{ orderCount: 'desc' }, { id: 'desc' }],
    take,
    include: productCardInclude,
  });
  const resolve = await loadDiscountResolver();
  return rows.map((p) => productCardDto(p as never, resolve));
}

/** "Customers who bought this also bought", padded with same-shelf sellers. */
export async function relatedProducts(slug: string, limit = 12) {
  const product = await prisma.product.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, subcategoryId: true },
  });
  if (!product) return null;

  const scored = await coOccurring([product.id], [product.id]);
  let cards = await hydrate(scored.slice(0, limit).map((s) => s.productId));

  if (cards.length < limit) {
    const have = cards.map((c: any) => c.slug);
    const filler = await sameShelf(product.subcategoryId, [product.id], limit - cards.length);
    cards = [...cards, ...filler.filter((f) => !have.includes(f.slug))];
  }
  return cards.slice(0, limit);
}

/**
 * "Frequently bought together" — the two strongest companions, presented as a
 * bundle the shopper can add in one action. Held to a higher bar than the
 * related rail: a weak association makes a bundle look silly.
 */
export async function bundleFor(slug: string, limit = 2) {
  const product = await prisma.product.findFirst({
    where: { ...LIVE, slug },
    select: { id: true },
  });
  if (!product) return [];

  const scored = await coOccurring([product.id], [product.id]);
  const strong = scored.filter((s) => s.score >= 1.2).slice(0, limit);
  return hydrate(strong.map((s) => s.productId));
}

/**
 * Personal recommendations from what this shopper has bought and viewed.
 * Anything already purchased is excluded — recommending a board someone
 * already owns is the classic own-goal of a naive engine.
 */
export async function recommendedFor(
  opts: { userId?: number | null; viewedSlugs?: string[]; limit?: number },
) {
  const limit = opts.limit ?? 12;

  const purchased = opts.userId
    ? await prisma.orderItem.findMany({
        where: { order: { userId: opts.userId, ...REAL_ORDER } },
        select: { productId: true },
        distinct: ['productId'],
        take: 50,
      })
    : [];
  const purchasedIds = purchased.map((p) => p.productId).filter((id): id is number => id != null);

  const viewed = opts.viewedSlugs?.length
    ? await prisma.product.findMany({
        where: { slug: { in: opts.viewedSlugs.slice(0, 20) } },
        select: { id: true },
      })
    : [];
  const viewedIds = viewed.map((v) => v.id);

  const seeds = [...new Set([...purchasedIds, ...viewedIds])];
  if (!seeds.length) return null; // caller falls back to best sellers

  const scored = await coOccurring(seeds, [...seeds]);
  const cards = await hydrate(scored.slice(0, limit).map((s) => s.productId));
  return cards.length ? cards : null;
}

/**
 * Trending — order velocity over a recent window, so a product that started
 * selling this week outranks one with a large all-time count and no momentum.
 */
export async function trendingProducts(days = 14, limit = 12) {
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: { ...REAL_ORDER, placedAt: { gte: since } }, NOT: { productId: null } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  const ids = rows.map((r) => r.productId).filter((id): id is number => id != null);
  const cards = await hydrate(ids);
  if (cards.length >= limit) return cards;

  // Not enough recent movement — top up with all-time best sellers.
  const resolve = await loadDiscountResolver();
  const filler = await prisma.product.findMany({
    where: { ...LIVE, id: { notIn: ids.length ? ids : [0] } },
    orderBy: [{ orderCount: 'desc' }, { id: 'desc' }],
    take: limit - cards.length,
    include: productCardInclude,
  });
  return [...cards, ...filler.map((p) => productCardDto(p as never, resolve))];
}
