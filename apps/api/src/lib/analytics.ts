import { prisma } from './prisma.js';

/**
 * Profit reporting.
 *
 * Cost of goods comes from `order_items.unit_cost_amount` — the cost snapshotted
 * at the moment of sale — never from the variant's current cost. Repricing a
 * product or receiving a restock at a different price must not silently rewrite
 * last month's margin.
 *
 * Lines with no recorded cost are excluded from margin and counted separately,
 * because a zero cost would inflate profit rather than admit the gap. Every
 * response carries that count so the number can be trusted or questioned.
 */

export interface Period {
  start: Date;
  end: Date;
  label: string;
}

export function resolvePeriod(key: string, from?: string, to?: string): Period {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end);

  if (!from) {
    switch (key) {
      case 'today': start.setHours(0, 0, 0, 0); break;
      case 'last7days': start.setDate(end.getDate() - 6); start.setHours(0, 0, 0, 0); break;
      case 'last90days': start.setDate(end.getDate() - 89); start.setHours(0, 0, 0, 0); break;
      case 'last12months': start.setMonth(end.getMonth() - 11, 1); start.setHours(0, 0, 0, 0); break;
      case 'thisYear': start.setMonth(0, 1); start.setHours(0, 0, 0, 0); break;
      default: start.setDate(end.getDate() - 29); start.setHours(0, 0, 0, 0);
    }
  }
  return { start, end, label: from ? `${from} → ${to ?? 'now'}` : key };
}

const paidIn = (p: Period) => ({
  order: { paymentStatus: 'paid', paidAt: { gte: p.start, lte: p.end } },
});

interface LineRow {
  unitPriceAmount: number;
  unitCostAmount: number | null;
  quantity: number;
  lineTotalAmount: number;
  discountAmount: number;
}

function summarise(lines: LineRow[]) {
  let revenue = 0;
  let cogs = 0;
  let units = 0;
  let costedRevenue = 0;
  let linesWithoutCost = 0;

  for (const l of lines) {
    revenue += l.lineTotalAmount;
    units += l.quantity;
    if (l.unitCostAmount == null) {
      linesWithoutCost += 1;
      continue;
    }
    cogs += l.unitCostAmount * l.quantity;
    costedRevenue += l.lineTotalAmount;
  }

  const grossProfit = costedRevenue - cogs;
  return {
    revenue,
    cogs,
    grossProfit,
    // Margin is expressed against the revenue we can actually cost, not against
    // all revenue — otherwise uncosted lines drag the percentage toward zero.
    marginPercent: costedRevenue > 0 ? Number(((grossProfit / costedRevenue) * 100).toFixed(1)) : 0,
    units,
    linesWithoutCost,
    costCoveragePercent: revenue > 0 ? Number(((costedRevenue / revenue) * 100).toFixed(1)) : 100,
  };
}

// ─────────────────────────────────────────────────────── headline ──

export async function profitSummary(period: Period) {
  const span = period.end.getTime() - period.start.getTime();
  const prev: Period = {
    start: new Date(period.start.getTime() - span),
    end: new Date(period.start.getTime()),
    label: 'previous',
  };

  const select = {
    unitPriceAmount: true, unitCostAmount: true,
    quantity: true, lineTotalAmount: true, discountAmount: true,
  };

  const [lines, prevLines, orderCount, prevOrderCount, shipping] = await Promise.all([
    prisma.orderItem.findMany({ where: paidIn(period), select }),
    prisma.orderItem.findMany({ where: paidIn(prev), select }),
    prisma.order.count({ where: { paymentStatus: 'paid', paidAt: { gte: period.start, lte: period.end } } }),
    prisma.order.count({ where: { paymentStatus: 'paid', paidAt: { gte: prev.start, lte: prev.end } } }),
    prisma.order.aggregate({
      where: { paymentStatus: 'paid', paidAt: { gte: period.start, lte: period.end } },
      _sum: { shippingAmount: true, discountAmount: true },
    }),
  ]);

  const now = summarise(lines);
  const before = summarise(prevLines);
  const pct = (a: number, b: number) =>
    b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100);

  return {
    period: { start: period.start, end: period.end, label: period.label },
    revenue: { value: now.revenue, change: pct(now.revenue, before.revenue) },
    cogs: { value: now.cogs, change: pct(now.cogs, before.cogs) },
    grossProfit: { value: now.grossProfit, change: pct(now.grossProfit, before.grossProfit) },
    marginPercent: {
      value: now.marginPercent,
      change: Number((now.marginPercent - before.marginPercent).toFixed(1)),
    },
    unitsSold: { value: now.units, change: pct(now.units, before.units) },
    orders: { value: orderCount, change: pct(orderCount, prevOrderCount) },
    averageOrderValue: {
      value: orderCount ? Math.round(now.revenue / orderCount) : 0,
      change: pct(
        orderCount ? now.revenue / orderCount : 0,
        prevOrderCount ? before.revenue / prevOrderCount : 0,
      ),
    },
    profitPerOrder: orderCount ? Math.round(now.grossProfit / orderCount) : 0,
    shippingCollected: shipping._sum.shippingAmount ?? 0,
    discountsGiven: shipping._sum.discountAmount ?? 0,
    dataQuality: {
      linesWithoutCost: now.linesWithoutCost,
      costCoveragePercent: now.costCoveragePercent,
    },
  };
}

// ──────────────────────────────────────────────── margin by product ──

export async function profitByProduct(period: Period, limit = 100) {
  const lines = await prisma.orderItem.findMany({
    where: paidIn(period),
    select: {
      productId: true, productName: true, variantSku: true,
      unitPriceAmount: true, unitCostAmount: true,
      quantity: true, lineTotalAmount: true, discountAmount: true,
      product: {
        select: {
          slug: true,
          displayImage: { select: { urlSm: true } },
          subcategory: { select: { name: true, category: { select: { name: true } } } },
        },
      },
    },
  });

  const byProduct = new Map<string, {
    productId: number | null; name: string; slug: string | null; image: string | null;
    category: string; subcategory: string; lines: LineRow[];
  }>();

  for (const l of lines) {
    const key = String(l.productId ?? l.productName);
    const entry = byProduct.get(key) ?? {
      productId: l.productId,
      name: l.productName,
      slug: l.product?.slug ?? null,
      image: l.product?.displayImage?.urlSm ?? null,
      category: l.product?.subcategory.category.name ?? '—',
      subcategory: l.product?.subcategory.name ?? '—',
      lines: [],
    };
    entry.lines.push(l);
    byProduct.set(key, entry);
  }

  return [...byProduct.values()]
    .map((p) => {
      const s = summarise(p.lines);
      return {
        productId: p.productId,
        name: p.name,
        slug: p.slug,
        image: p.image,
        category: p.category,
        subcategory: p.subcategory,
        revenue: s.revenue,
        cogs: s.cogs,
        grossProfit: s.grossProfit,
        marginPercent: s.marginPercent,
        unitsSold: s.units,
        profitPerUnit: s.units ? Math.round(s.grossProfit / s.units) : 0,
        hasCostGap: s.linesWithoutCost > 0,
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, limit);
}

export async function profitByCategory(period: Period) {
  const lines = await prisma.orderItem.findMany({
    where: paidIn(period),
    select: {
      unitPriceAmount: true, unitCostAmount: true, quantity: true,
      lineTotalAmount: true, discountAmount: true,
      product: { select: { subcategory: { select: { category: { select: { name: true } } } } } },
    },
  });

  const buckets = new Map<string, LineRow[]>();
  for (const l of lines) {
    const key = l.product?.subcategory.category.name ?? 'Uncategorised';
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(l);
  }

  return [...buckets.entries()]
    .map(([category, rows]) => ({ category, ...summarise(rows) }))
    .sort((a, b) => b.grossProfit - a.grossProfit);
}

// ────────────────────────────────────────────── profit over time ──

export async function profitSeries(period: Period, granularity: 'day' | 'month' = 'day') {
  const lines = await prisma.orderItem.findMany({
    where: paidIn(period),
    select: {
      unitPriceAmount: true, unitCostAmount: true, quantity: true,
      lineTotalAmount: true, discountAmount: true,
      order: { select: { paidAt: true } },
    },
  });

  const key = (d: Date) =>
    granularity === 'month'
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : d.toISOString().slice(0, 10);

  // Zero-fill the spine so a quiet day is a visible zero, not a gap the eye
  // reads as a shorter month.
  const buckets = new Map<string, LineRow[]>();
  const cursor = new Date(period.start);
  while (cursor <= period.end) {
    buckets.set(key(cursor), []);
    if (granularity === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }

  for (const l of lines) {
    if (!l.order.paidAt) continue;
    const k = key(l.order.paidAt);
    buckets.get(k)?.push(l);
  }

  return [...buckets.entries()].map(([bucket, rows]) => {
    const s = summarise(rows);
    return {
      bucket,
      revenue: s.revenue,
      cogs: s.cogs,
      grossProfit: s.grossProfit,
      marginPercent: s.marginPercent,
      units: s.units,
    };
  });
}

// ────────────────────────────────────────── what to stock next ──

/**
 * Demand the store failed to capture. Three independent signals, each pointing
 * at a different kind of gap:
 *
 *   · zero-result searches — customers asking for what is not listed at all
 *   · back-in-stock requests — a listed product that was unavailable
 *   · wishlisted but out of stock — intent parked against empty shelves
 */
export async function missedDemand(days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [zeroResults, notifyRequests, wishlistedOos] = await Promise.all([
    prisma.searchLog.groupBy({
      by: ['normalisedTerm'],
      where: { resultCount: 0, createdAt: { gte: since } },
      _count: { normalisedTerm: true },
      _max: { createdAt: true },
      orderBy: { _count: { normalisedTerm: 'desc' } },
      take: 40,
    }),
    prisma.notifyRequest.groupBy({
      by: ['productVariantId'],
      where: { notifiedAt: null },
      _count: { productVariantId: true },
      orderBy: { _count: { productVariantId: 'desc' } },
      take: 30,
    }),
    prisma.wishlistItem.groupBy({
      by: ['productId'],
      _count: { productId: true },
      orderBy: { _count: { productId: 'desc' } },
      take: 40,
    }),
  ]);

  const variantIds = notifyRequests.map((n) => n.productVariantId);
  const productIds = wishlistedOos.map((w) => w.productId);

  const [variants, products] = await Promise.all([
    variantIds.length
      ? prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true, sku: true, stockQuantity: true, reservedQuantity: true,
            product: { select: { name: true, slug: true } },
          },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, slug: true, totalStock: true },
        })
      : Promise.resolve([]),
  ]);

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const productById = new Map(products.map((p) => [p.id, p]));

  return {
    zeroResultSearches: zeroResults.map((z) => ({
      term: z.normalisedTerm,
      searches: z._count.normalisedTerm,
      lastSearchedAt: z._max.createdAt,
    })),
    backInStockRequests: notifyRequests
      .map((n) => {
        const v = variantById.get(n.productVariantId);
        if (!v) return null;
        return {
          sku: v.sku,
          productName: v.product.name,
          productSlug: v.product.slug,
          waiting: n._count.productVariantId,
          available: Math.max(0, v.stockQuantity - v.reservedQuantity),
        };
      })
      .filter(Boolean),
    wishlistedOutOfStock: wishlistedOos
      .map((w) => {
        const p = productById.get(w.productId);
        if (!p || p.totalStock > 0) return null;
        return { productName: p.name, productSlug: p.slug, wishlisted: w._count.productId };
      })
      .filter(Boolean),
  };
}

/** Products ranked by units, revenue and profit — the three disagree, usefully. */
export async function bestSellers(period: Period, by: 'units' | 'revenue' | 'profit' = 'profit') {
  const rows = await profitByProduct(period, 500);
  const sorted = [...rows].sort((a, b) =>
    by === 'units' ? b.unitsSold - a.unitsSold
      : by === 'revenue' ? b.revenue - a.revenue
        : b.grossProfit - a.grossProfit);
  return sorted.slice(0, 20);
}
