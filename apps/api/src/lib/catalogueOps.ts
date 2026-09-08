import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';
import { pad, slugify } from './util.js';
import { ConflictError } from './errors.js';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * SKU allocation (spec §12.1).
 *   category    2 digits   "05"
 *   subcategory 4 digits   "0510"  = category + 2-digit sequence
 *   product     7 digits   "0510003"
 *   variant     9 digits   "051000301"
 * Codes are immutable once assigned and are never reused.
 */

export async function nextCategoryCode(tx: Tx): Promise<string> {
  const rows = await tx.category.findMany({ select: { skuCode: true } });
  const used = new Set(rows.map((r) => r.skuCode));
  for (let i = 0; i < 100; i += 1) {
    const code = pad(i, 2);
    if (!used.has(code)) return code;
  }
  throw new ConflictError('All 100 category codes are in use.');
}

export async function nextSubcategoryCode(tx: Tx, categoryId: number): Promise<string> {
  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { skuCode: true },
  });
  if (!category) throw new ConflictError('Category not found.');
  const rows = await tx.subcategory.findMany({
    where: { skuCode: { startsWith: category.skuCode } },
    select: { skuCode: true },
  });
  const used = new Set(rows.map((r) => r.skuCode.slice(2)));
  for (let i = 0; i < 100; i += 1) {
    const seq = pad(i, 2);
    if (!used.has(seq)) return `${category.skuCode}${seq}`;
  }
  throw new ConflictError('All 100 subcategory codes are in use for this category.');
}

export async function nextProductSku(tx: Tx, subcategoryId: number): Promise<string> {
  const sub = await tx.subcategory.findUnique({
    where: { id: subcategoryId },
    select: { skuCode: true },
  });
  if (!sub) throw new ConflictError('Subcategory not found.');
  const rows = await tx.product.findMany({
    where: { skuPrefix: { startsWith: sub.skuCode } },
    select: { skuPrefix: true },
  });
  const used = new Set(rows.map((r) => r.skuPrefix.slice(4)));
  for (let i = 0; i < 1000; i += 1) {
    const seq = pad(i, 3);
    if (!used.has(seq)) return `${sub.skuCode}${seq}`;
  }
  throw new ConflictError('This subcategory already holds 1,000 products. Split it.');
}

export const variantSku = (productSkuPrefix: string, index: number) =>
  `${productSkuPrefix}${pad(index, 2)}`;

/** Generates a slug that does not collide, appending -2, -3, … as needed. */
export async function uniqueSlug(
  tx: Tx,
  table: 'product' | 'category' | 'subcategory' | 'article' | 'service' | 'event' | 'course' | 'project',
  value: string,
  ignoreId?: number,
): Promise<string> {
  const base = slugify(value);
  let candidate = base;
  for (let i = 2; i < 200; i += 1) {
    // The delegate is resolved by name, so the union of model types is widened
    // here deliberately — every one of these models has `slug` and `id`.
    const delegate = (tx as unknown as Record<string, {
      findFirst: (args: unknown) => Promise<{ id: number } | null>;
    }>)[table];
    const existing = await delegate.findFirst({
      where: { slug: candidate, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { id: true },
    });
    const retired =
      table === 'product'
        ? await tx.productSlugHistory.findUnique({ where: { slug: candidate } })
        : null;
    if (!existing && !retired) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Recomputes a product's maintained aggregates from its variants, then rolls
 * the counts up to subcategory and category. Called inside the same
 * transaction as any change to a variant's price, stock or active flag
 * (spec §12.2) — these are never computed on read.
 */
export async function refreshProductAggregates(tx: Tx, productId: number) {
  const variants = await tx.productVariant.findMany({
    where: { productId, deletedAt: null, isActive: true },
    select: { priceAmount: true, stockQuantity: true, reservedQuantity: true },
  });

  const prices = variants.map((v) => v.priceAmount);
  const totalStock = variants.reduce(
    (n, v) => n + Math.max(0, v.stockQuantity - v.reservedQuantity),
    0,
  );

  await tx.product.update({
    where: { id: productId },
    data: {
      totalStock,
      minPriceAmount: prices.length ? Math.min(...prices) : 0,
      maxPriceAmount: prices.length ? Math.max(...prices) : 0,
    },
  });
}

export async function refreshTaxonomyCounts(tx: Tx, subcategoryId?: number) {
  const subs = subcategoryId
    ? await tx.subcategory.findMany({ where: { id: subcategoryId } })
    : await tx.subcategory.findMany({ where: { deletedAt: null } });

  for (const sub of subs) {
    const count = await tx.product.count({
      where: { subcategoryId: sub.id, deletedAt: null, status: 'active' },
    });
    await tx.subcategory.update({ where: { id: sub.id }, data: { productCount: count } });
  }

  const categoryIds = Array.from(new Set(subs.map((s) => s.categoryId)));
  for (const categoryId of categoryIds) {
    const [subCount, agg] = await Promise.all([
      tx.subcategory.count({ where: { categoryId, deletedAt: null } }),
      tx.subcategory.aggregate({
        where: { categoryId, deletedAt: null },
        _sum: { productCount: true },
      }),
    ]);
    await tx.category.update({
      where: { id: categoryId },
      data: { subcategoryCount: subCount, productCount: agg._sum.productCount ?? 0 },
    });
  }
}

/** Adjusts stock and writes the ledger row in one step — never one without the other. */
export async function adjustStock(
  tx: Tx,
  variantId: number,
  delta: number,
  reason: string,
  opts: { referenceType?: string; referenceId?: number; actorUserId?: number; note?: string } = {},
) {
  const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
  if (!variant) throw new ConflictError('Variant not found.');
  const balanceAfter = variant.stockQuantity + delta;
  if (balanceAfter < 0) throw new ConflictError('Stock cannot go negative.');

  await tx.productVariant.update({
    where: { id: variantId },
    data: { stockQuantity: balanceAfter },
  });
  await tx.stockMovement.create({
    data: {
      productVariantId: variantId,
      delta,
      balanceAfter,
      reason,
      referenceType: opts.referenceType ?? null,
      referenceId: opts.referenceId ?? null,
      actorUserId: opts.actorUserId ?? null,
      note: opts.note ?? null,
    },
  });
  await refreshProductAggregates(tx, variant.productId);
  return balanceAfter;
}

/** Attaches an uploaded image to a product and maintains the reference count. */
export async function attachProductImage(
  tx: Tx,
  productId: number,
  mediaFileId: number,
  position: number,
  altText?: string | null,
) {
  const existing = await tx.productImage.findFirst({ where: { productId, mediaFileId } });
  if (existing) {
    await tx.productImage.update({ where: { id: existing.id }, data: { position, altText: altText ?? null } });
    return existing.id;
  }
  const row = await tx.productImage.create({
    data: { productId, mediaFileId, position, altText: altText ?? null },
  });
  await tx.mediaFile.update({
    where: { id: mediaFileId },
    data: { referenceCount: { increment: 1 } },
  });
  return row.id;
}

export async function detachProductImage(tx: Tx, productImageId: number) {
  const row = await tx.productImage.findUnique({ where: { id: productImageId } });
  if (!row) return;
  await tx.productImage.delete({ where: { id: productImageId } });
  await tx.mediaFile.update({
    where: { id: row.mediaFileId },
    data: { referenceCount: { decrement: 1 } },
  });
}

export { prisma };
