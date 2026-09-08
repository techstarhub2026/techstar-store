import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';
import { adjustStock } from './catalogueOps.js';
import { ConflictError } from './errors.js';
import { pad } from './util.js';

type Tx = Prisma.TransactionClient | PrismaClient;

// ─────────────────────────────────────────────────────── references ──

async function nextReference(tx: Tx, table: 'purchaseOrder' | 'stockTake', prefix: string) {
  const year = new Date().getFullYear();
  const full = `${prefix}-${year}-`;
  const delegate = (tx as unknown as Record<string, {
    findFirst: (a: unknown) => Promise<{ reference: string } | null>;
  }>)[table];
  const last = await delegate.findFirst({
    where: { reference: { startsWith: full } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const seq = last ? Number(last.reference.slice(full.length)) + 1 : 1;
  return `${full}${pad(seq, 4)}`;
}

export const nextPurchaseOrderRef = (tx: Tx) => nextReference(tx, 'purchaseOrder', 'PO');
export const nextStockTakeRef = (tx: Tx) => nextReference(tx, 'stockTake', 'ST');

// ─────────────────────────────────────────────── weighted average cost ──

/**
 * Receiving stock at a new price changes what the stock on hand is worth.
 * Overwriting the cost with the newest price would misstate margin on units
 * bought earlier, so the cost moves to a quantity-weighted average of what is
 * actually on the shelf.
 *
 *   newCost = (onHand × oldCost + received × receivedCost) / (onHand + received)
 *
 * With no prior cost or no prior stock, the received price simply becomes the
 * cost — there is nothing to average against.
 */
export function weightedAverageCost(
  onHand: number,
  currentCost: number | null,
  receivedQty: number,
  receivedCost: number,
): number {
  if (receivedQty <= 0) return currentCost ?? receivedCost;
  if (currentCost == null || onHand <= 0) return receivedCost;
  const total = onHand + receivedQty;
  return Math.round((onHand * currentCost + receivedQty * receivedCost) / total);
}

// ────────────────────────────────────────────────── receiving stock ──

export interface ReceiveLine {
  itemId: number;
  quantity: number;
}

/**
 * Receives against a purchase order: raises stock, rolls the weighted average
 * cost, writes the ledger, and advances the order's status. Partial receipts
 * are normal — a supplier short-shipping is not an error.
 */
export async function receivePurchaseOrder(
  tx: Tx,
  purchaseOrderId: number,
  lines: ReceiveLine[],
  actorUserId?: number,
) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: true },
  });
  if (!po) throw new ConflictError('Purchase order not found.');
  if (po.status === 'cancelled') {
    throw new ConflictError('A cancelled purchase order cannot receive stock.');
  }
  if (po.status === 'received') {
    throw new ConflictError('This purchase order has already been fully received.');
  }

  let receivedAny = false;

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const item = po.items.find((i) => i.id === line.itemId);
    if (!item) continue;

    const outstanding = item.quantityOrdered - item.quantityReceived;
    if (outstanding <= 0) continue;
    const qty = Math.min(line.quantity, outstanding);

    const variant = await tx.productVariant.findUnique({
      where: { id: item.productVariantId },
    });
    if (!variant) continue;

    const nextCost = weightedAverageCost(
      variant.stockQuantity,
      variant.costAmount,
      qty,
      item.unitCostAmount,
    );

    await tx.productVariant.update({
      where: { id: variant.id },
      data: { costAmount: nextCost, supplierId: variant.supplierId ?? po.supplierId },
    });

    await adjustStock(tx, variant.id, qty, 'purchase', {
      referenceType: 'purchase_order',
      referenceId: po.id,
      actorUserId,
      note: `Received ${qty} on ${po.reference}`,
    });

    await tx.purchaseOrderItem.update({
      where: { id: item.id },
      data: { quantityReceived: item.quantityReceived + qty },
    });
    receivedAny = true;
  }

  if (!receivedAny) throw new ConflictError('Nothing was received — check the quantities.');

  const after = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId } });
  const complete = after.every((i) => i.quantityReceived >= i.quantityOrdered);
  const partial = after.some((i) => i.quantityReceived > 0);

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      status: complete ? 'received' : partial ? 'partial' : po.status,
      receivedAt: complete ? new Date() : po.receivedAt,
    },
  });

  return { complete };
}

// ──────────────────────────────────────────────────────── stocktake ──

/**
 * Posts a stocktake: every counted line whose count differs from the system
 * becomes a stock movement with reason `stocktake`. Uncounted lines are left
 * alone — a line nobody counted is not evidence of zero.
 */
export async function postStockTake(tx: Tx, stockTakeId: number, actorUserId?: number) {
  const take = await tx.stockTake.findUnique({
    where: { id: stockTakeId },
    include: { items: true },
  });
  if (!take) throw new ConflictError('Stocktake not found.');
  if (take.status === 'posted') throw new ConflictError('This stocktake has already been posted.');

  let varianceLines = 0;
  let varianceValue = 0;

  for (const item of take.items) {
    if (item.countedQuantity == null) continue;

    const variant = await tx.productVariant.findUnique({
      where: { id: item.productVariantId },
    });
    if (!variant) continue;

    // Recompute against live stock rather than the snapshot: the shelf may
    // have moved since the sheet was printed.
    const delta = item.countedQuantity - variant.stockQuantity;
    if (delta === 0) continue;

    varianceLines += 1;
    varianceValue += delta * (item.unitCostAmount ?? variant.costAmount ?? 0);

    await adjustStock(tx, variant.id, delta, 'stocktake', {
      referenceType: 'stock_take',
      referenceId: take.id,
      actorUserId,
      note: `${take.reference}: counted ${item.countedQuantity}, system ${variant.stockQuantity}`
        + (item.note ? ` — ${item.note}` : ''),
    });
  }

  await tx.stockTake.update({
    where: { id: stockTakeId },
    data: {
      status: 'posted',
      postedById: actorUserId ?? null,
      postedAt: new Date(),
      varianceLines,
      varianceValue,
    },
  });

  return { varianceLines, varianceValue };
}

// ─────────────────────────────────────────── replenishment analysis ──

export interface ReplenishmentRow {
  variantId: number;
  sku: string;
  productId: number;
  productName: string;
  image: string | null;
  supplierId: number | null;
  supplierName: string | null;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  reorderQuantity: number;
  unitsSold: number;
  dailyVelocity: number;
  daysOfCover: number | null;
  suggestedOrder: number;
  unitCost: number | null;
  orderValue: number;
  urgency: 'out_of_stock' | 'critical' | 'low' | 'ok';
}

/**
 * Reorder suggestions from actual sales velocity rather than a fixed threshold.
 *
 * Velocity is units sold per day over the window, counting only paid orders.
 * Days of cover is available stock divided by velocity — the number a buyer
 * actually acts on. Where a variant has no explicit reorder point, one is
 * derived from velocity across the supplier's lead time plus a safety margin,
 * which is what a fixed "low stock threshold" is a crude approximation of.
 */
export async function replenishmentReport(opts: {
  windowDays?: number;
  supplierId?: number;
  onlyNeeded?: boolean;
} = {}): Promise<ReplenishmentRow[]> {
  const windowDays = opts.windowDays ?? 60;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [variants, sales] = await Promise.all([
    prisma.productVariant.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        product: { deletedAt: null },
        ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
      },
      include: {
        product: { select: { id: true, name: true, displayImage: { select: { urlSm: true } } } },
        supplier: { select: { id: true, name: true, leadTimeDays: true } },
      },
    }),
    prisma.orderItem.groupBy({
      by: ['productVariantId'],
      where: {
        productVariantId: { not: null },
        order: { paymentStatus: 'paid', paidAt: { gte: since } },
      },
      _sum: { quantity: true },
    }),
  ]);

  const sold = new Map<number, number>();
  for (const s of sales) {
    if (s.productVariantId != null) sold.set(s.productVariantId, s._sum.quantity ?? 0);
  }

  const rows = variants.map((v) => {
    const unitsSold = sold.get(v.id) ?? 0;
    const dailyVelocity = unitsSold / windowDays;
    const available = Math.max(0, v.stockQuantity - v.reservedQuantity);
    const leadTime = v.supplier?.leadTimeDays ?? 7;

    // Cover the lead time plus half again as safety stock.
    const derivedPoint = Math.ceil(dailyVelocity * leadTime * 1.5);
    const reorderPoint = v.reorderPoint ?? Math.max(v.lowStockThreshold, derivedPoint);

    // How much to buy in one go: 30 days of demand, or the configured
    // quantity. Never zero — a line that has reached its reorder point but
    // suggests ordering nothing is advice nobody can act on.
    const batchSize = v.reorderQuantity ?? Math.max(Math.ceil(dailyVelocity * 30), 1);

    // Order up to the reorder point plus one batch, so the next order is not
    // due again immediately.
    const orderUpTo = reorderPoint + batchSize;
    const suggestedOrder = available <= reorderPoint
      ? Math.max(orderUpTo - available, batchSize)
      : 0;

    const daysOfCover = dailyVelocity > 0 ? Math.floor(available / dailyVelocity) : null;

    const urgency: ReplenishmentRow['urgency'] =
      available <= 0 ? 'out_of_stock'
        : daysOfCover != null && daysOfCover <= leadTime ? 'critical'
          : available <= reorderPoint ? 'low'
            : 'ok';

    return {
      variantId: v.id,
      sku: v.sku,
      productId: v.product.id,
      productName: v.product.name,
      image: v.product.displayImage?.urlSm ?? null,
      supplierId: v.supplier?.id ?? null,
      supplierName: v.supplier?.name ?? null,
      onHand: v.stockQuantity,
      reserved: v.reservedQuantity,
      available,
      reorderPoint,
      reorderQuantity: batchSize,
      unitsSold,
      dailyVelocity: Number(dailyVelocity.toFixed(3)),
      daysOfCover,
      suggestedOrder,
      unitCost: v.costAmount,
      orderValue: suggestedOrder * (v.costAmount ?? 0),
      urgency,
    };
  });

  const rank = { out_of_stock: 0, critical: 1, low: 2, ok: 3 };
  const filtered = opts.onlyNeeded ? rows.filter((r) => r.urgency !== 'ok') : rows;
  return filtered.sort(
    (a, b) => rank[a.urgency] - rank[b.urgency] || b.unitsSold - a.unitsSold,
  );
}

/**
 * Stock that is not moving. Capital sitting on a shelf is the other half of
 * the inventory problem, and the half nobody gets an alert about.
 */
export async function deadStockReport(days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [variants, sales] = await Promise.all([
    prisma.productVariant.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        stockQuantity: { gt: 0 },
        product: { deletedAt: null },
      },
      include: {
        product: {
          select: {
            id: true, name: true, slug: true, createdAt: true,
            displayImage: { select: { urlSm: true } },
            subcategory: { select: { name: true } },
          },
        },
      },
    }),
    prisma.orderItem.groupBy({
      by: ['productVariantId'],
      where: {
        productVariantId: { not: null },
        order: { paymentStatus: 'paid', paidAt: { gte: since } },
      },
      _sum: { quantity: true },
      _max: { createdAt: true },
    }),
  ]);

  const sold = new Map(
    sales.map((s) => [s.productVariantId!, { qty: s._sum.quantity ?? 0, last: s._max.createdAt }]),
  );

  return variants
    .filter((v) => (sold.get(v.id)?.qty ?? 0) === 0)
    // Something stocked last week has not had a chance to sell yet.
    .filter((v) => v.product.createdAt < since)
    .map((v) => ({
      variantId: v.id,
      sku: v.sku,
      productName: v.product.name,
      productSlug: v.product.slug,
      subcategory: v.product.subcategory.name,
      image: v.product.displayImage?.urlSm ?? null,
      onHand: v.stockQuantity,
      unitCost: v.costAmount,
      tiedUpCapital: v.stockQuantity * (v.costAmount ?? 0),
      price: v.priceAmount,
      listedOn: v.product.createdAt,
      daysListed: Math.floor((Date.now() - v.product.createdAt.getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.tiedUpCapital - a.tiedUpCapital);
}

/** Total value of stock on hand, at cost and at retail. */
export async function stockValuation() {
  const variants = await prisma.productVariant.findMany({
    where: { deletedAt: null, product: { deletedAt: null } },
    select: {
      stockQuantity: true, costAmount: true, priceAmount: true,
      product: { select: { subcategory: { select: { name: true, category: { select: { name: true } } } } } },
    },
  });

  let atCost = 0;
  let atRetail = 0;
  let unitsOnHand = 0;
  let missingCost = 0;
  const byCategory = new Map<string, { atCost: number; atRetail: number; units: number }>();

  for (const v of variants) {
    if (v.stockQuantity <= 0) continue;
    const cost = v.costAmount ?? 0;
    if (v.costAmount == null) missingCost += 1;
    const lineCost = v.stockQuantity * cost;
    const lineRetail = v.stockQuantity * v.priceAmount;

    atCost += lineCost;
    atRetail += lineRetail;
    unitsOnHand += v.stockQuantity;

    const key = v.product.subcategory.category.name;
    const bucket = byCategory.get(key) ?? { atCost: 0, atRetail: 0, units: 0 };
    bucket.atCost += lineCost;
    bucket.atRetail += lineRetail;
    bucket.units += v.stockQuantity;
    byCategory.set(key, bucket);
  }

  return {
    atCost,
    atRetail,
    potentialMargin: atRetail - atCost,
    unitsOnHand,
    variantsMissingCost: missingCost,
    byCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.atCost - a.atCost),
  };
}
