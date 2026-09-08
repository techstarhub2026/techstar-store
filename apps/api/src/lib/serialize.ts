import { money } from './util.js';
import { toMediaDto } from './storage.js';
import { prisma } from './prisma.js';

/** Resolves the best-matching active discount for a variant. (Spec §12.3) */
export interface DiscountRow {
  scope: string;
  scopeId: number;
  type: string;
  value: number;
  endsAt: Date;
}

export function applyDiscount(price: number, d: DiscountRow | null) {
  if (!d) return { price, discount: null as null | { percent: number; endsAt: Date; saved: number } };
  const off = d.type === 'percentage' ? Math.round((price * d.value) / 100) : d.value;
  const next = Math.max(1, price - off);
  return {
    price: next,
    discount: { percent: Math.round(((price - next) / price) * 100), endsAt: d.endsAt, saved: price - next },
  };
}

/**
 * Loads every active discount once, then resolves per variant in memory.
 * Most specific scope wins; within a scope the larger saving wins; never stacks.
 */
export async function loadDiscountResolver() {
  const now = new Date();
  const rows = await prisma.discount.findMany({
    where: { isActive: true, deletedAt: null, startsAt: { lte: now }, endsAt: { gte: now } },
    select: { scope: true, scopeId: true, type: true, value: true, endsAt: true },
  });
  const index = new Map<string, DiscountRow[]>();
  for (const r of rows) {
    const key = `${r.scope}:${r.scopeId}`;
    const list = index.get(key) ?? [];
    list.push(r);
    index.set(key, list);
  }

  const bestIn = (key: string, price: number) => {
    const list = index.get(key);
    if (!list?.length) return null;
    return list.reduce((best, cur) => {
      const a = applyDiscount(price, best).price;
      const b = applyDiscount(price, cur).price;
      return b < a ? cur : best;
    });
  };

  return (ctx: {
    variantId: number;
    productId: number;
    subcategoryId: number;
    categoryId: number;
    price: number;
  }) =>
    bestIn(`variant:${ctx.variantId}`, ctx.price) ??
    bestIn(`product:${ctx.productId}`, ctx.price) ??
    bestIn(`subcategory:${ctx.subcategoryId}`, ctx.price) ??
    bestIn(`category:${ctx.categoryId}`, ctx.price);
}

export type DiscountResolver = Awaited<ReturnType<typeof loadDiscountResolver>>;

// ───────────────────────────────────────────────────────── products ──

const NEW_DAYS = 30;

export function stockStatus(available: number, threshold: number) {
  if (available <= 0) return 'out_of_stock';
  if (available <= threshold) return 'low_stock';
  return 'in_stock';
}

type ProductWithRels = {
  id: number;
  name: string;
  slug: string;
  skuPrefix: string;
  shortDescription: string | null;
  descriptionHtml?: string;
  brand: string | null;
  manufacturerPartNumber: string | null;
  status: string;
  totalStock: number;
  minPriceAmount: number;
  maxPriceAmount: number;
  orderCount: number;
  reviewCount: number;
  averageRating: unknown;
  isFeatured: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  displayImage: Parameters<typeof toMediaDto>[0] | null;
  specSheet?: { urlLg: string; originalFilename: string; byteSize: number } | null;
  subcategory: {
    id: number;
    name: string;
    slug: string;
    categoryId: number;
    category?: { id: number; name: string; slug: string } | null;
  };
  variants?: VariantRow[];
  images?: { media: Parameters<typeof toMediaDto>[0]; altText: string | null; position: number }[];
  attributes?: { id: number; name: string; unit: string | null; position: number }[];
};

type VariantRow = {
  id: number;
  sku: string;
  priceAmount: number;
  compareAtAmount: number | null;
  stockQuantity: number;
  reservedQuantity: number;
  lowStockThreshold: number;
  position: number;
  isActive: boolean;
  barcode?: string | null;
  attributeValues?: { value: string; attribute: { id: number; name: string; unit: string | null } }[];
};

export function variantDto(
  v: VariantRow,
  ctx: { productId: number; subcategoryId: number; categoryId: number },
  resolve?: DiscountResolver,
) {
  const d = resolve
    ? resolve({
        variantId: v.id,
        productId: ctx.productId,
        subcategoryId: ctx.subcategoryId,
        categoryId: ctx.categoryId,
        price: v.priceAmount,
      })
    : null;
  const { price, discount } = applyDiscount(v.priceAmount, d);
  const available = Math.max(0, v.stockQuantity - v.reservedQuantity);
  return {
    sku: v.sku,
    price: money(price),
    listPrice: price !== v.priceAmount ? money(v.priceAmount) : null,
    compareAt: v.compareAtAmount ? money(v.compareAtAmount) : null,
    discount: discount ? { percent: discount.percent, endsAt: discount.endsAt } : null,
    attributes:
      v.attributeValues?.map((a) => ({
        name: a.attribute.name,
        unit: a.attribute.unit,
        value: a.value,
      })) ?? [],
    stock: {
      available,
      status: stockStatus(available, v.lowStockThreshold),
      lowThreshold: v.lowStockThreshold,
    },
    isActive: v.isActive,
    position: v.position,
  };
}

export function productCardDto(p: ProductWithRels, resolve?: DiscountResolver) {
  const categoryId = p.subcategory.category?.id ?? p.subcategory.categoryId;
  const variants = (p.variants ?? []).filter((v) => v.isActive);
  const dtos = variants.map((v) =>
    variantDto(v, { productId: p.id, subcategoryId: p.subcategory.id, categoryId }, resolve),
  );
  const prices = dtos.map((v) => v.price.amount);
  const min = prices.length ? Math.min(...prices) : p.minPriceAmount;
  const max = prices.length ? Math.max(...prices) : p.maxPriceAmount;
  const bestDiscount = dtos.find((v) => v.discount)?.discount ?? null;
  const wasPrice = dtos.find((v) => v.price.amount === min)?.listPrice ?? null;
  const created = p.publishedAt ?? p.createdAt;

  return {
    slug: p.slug,
    name: p.name,
    sku: p.skuPrefix,
    shortDescription: p.shortDescription,
    brand: p.brand,
    image: p.displayImage ? toMediaDto(p.displayImage) : null,
    subcategory: {
      slug: p.subcategory.slug,
      name: p.subcategory.name,
      category: p.subcategory.category
        ? { slug: p.subcategory.category.slug, name: p.subcategory.category.name }
        : null,
    },
    price: money(min),
    priceMax: max !== min ? money(max) : null,
    wasPrice,
    hasVariants: variants.length > 1,
    variantCount: variants.length,
    discount: bestDiscount,
    totalStock: p.totalStock,
    inStock: p.totalStock > 0,
    isNew: Date.now() - new Date(created).getTime() < NEW_DAYS * 86_400_000,
    isFeatured: p.isFeatured,
    rating: { average: Number(p.averageRating ?? 0), count: p.reviewCount },
    orderCount: p.orderCount,
  };
}

export function productDetailDto(p: ProductWithRels, resolve?: DiscountResolver) {
  const categoryId = p.subcategory.category?.id ?? p.subcategory.categoryId;
  const card = productCardDto(p, resolve);
  const variants = (p.variants ?? [])
    .filter((v) => v.isActive)
    .sort((a, b) => a.position - b.position)
    .map((v) =>
      variantDto(v, { productId: p.id, subcategoryId: p.subcategory.id, categoryId }, resolve),
    );

  return {
    ...card,
    descriptionHtml: p.descriptionHtml ?? '',
    manufacturerPartNumber: p.manufacturerPartNumber,
    specSheet: p.specSheet
      ? {
          url: p.specSheet.urlLg,
          filename: p.specSheet.originalFilename || `${p.slug}-datasheet.pdf`,
          byteSize: p.specSheet.byteSize,
        }
      : null,
    images: (p.images ?? [])
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ ...toMediaDto(i.media), altText: i.altText ?? p.name })),
    attributes: (p.attributes ?? [])
      .sort((a, b) => a.position - b.position)
      .map((a) => ({ name: a.name, unit: a.unit })),
    variants,
    publishedAt: p.publishedAt,
  };
}

/** The include tree every product read uses, so DTOs always have what they need. */
export const productInclude = {
  displayImage: true,
  specSheet: true,
  subcategory: { include: { category: true } },
  attributes: true,
  variants: {
    where: { deletedAt: null },
    orderBy: { position: 'asc' },
    include: { attributeValues: { include: { attribute: true } } },
  },
  images: { include: { media: true }, orderBy: { position: 'asc' } },
} as const;

export const productCardInclude = {
  displayImage: true,
  subcategory: { include: { category: true } },
  variants: {
    where: { deletedAt: null, isActive: true },
    orderBy: { position: 'asc' },
    include: { attributeValues: { include: { attribute: true } } },
  },
} as const;
