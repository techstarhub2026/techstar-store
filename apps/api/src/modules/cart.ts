import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handler, ok, noContent } from '../lib/http.js';
import { validate, requireAuth } from '../middleware/index.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { GUEST_COOKIE } from '../lib/auth.js';
import { loadDiscountResolver, applyDiscount } from '../lib/serialize.js';
import { money, randomToken } from '../lib/util.js';
import { config } from '../config/index.js';

export const cartRouter = Router();

const MAX_LINES = 100;
const MAX_QTY = 999;

// ─────────────────────────────────────────────────────── cart identity ──

function guestToken(req: Request, res: Response): string {
  let token = req.cookies?.[GUEST_COOKIE];
  if (!token || String(token).length !== 32) {
    token = randomToken(24).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32).padEnd(32, '0');
    res.cookie(GUEST_COOKIE, token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      maxAge: 90 * 86_400_000,
      path: '/',
    });
  }
  return token;
}

async function getOrCreateCart(req: Request, res: Response) {
  if (req.auth) {
    const existing = await prisma.cart.findUnique({ where: { userId: req.auth.uid } });
    if (existing) return existing;
    return prisma.cart.create({ data: { userId: req.auth.uid } });
  }
  const token = guestToken(req, res);
  const existing = await prisma.cart.findUnique({ where: { guestToken: token } });
  if (existing) return existing;
  return prisma.cart.create({ data: { guestToken: token } });
}

const lineInclude = {
  items: {
    include: {
      variant: {
        include: {
          product: { include: { displayImage: true, subcategory: true } },
          attributeValues: { include: { attribute: true } },
        },
      },
    },
    orderBy: { addedAt: 'asc' as const },
  },
};

/**
 * Builds the cart response, revalidating every line against live data:
 * availability, activity and price. This is the fix for defects R6 and R7 —
 * the reference platform trusts the price captured at add-to-cart time and
 * never re-checks stock. (Spec §12.5.3)
 */
async function buildCart(cartId: number, opts: { persistChanges?: boolean } = {}) {
  const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: lineInclude });
  if (!cart) throw new NotFoundError('Cart');

  const resolve = await loadDiscountResolver();
  const notices: { sku: string; type: string; message: string }[] = [];
  const lines: unknown[] = [];
  const removals: number[] = [];
  const clamps: { id: number; quantity: number }[] = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const v = item.variant;
    const p = v.product;

    if (p.deletedAt || v.deletedAt || !v.isActive || p.status !== 'active') {
      notices.push({ sku: v.sku, type: 'unavailable', message: 'This item is no longer available' });
      removals.push(item.id);
      continue;
    }

    const discount = resolve({
      variantId: v.id,
      productId: p.id,
      subcategoryId: p.subcategoryId,
      categoryId: p.subcategory.categoryId,
      price: v.priceAmount,
    });
    const { price } = applyDiscount(v.priceAmount, discount);
    const available = Math.max(0, v.stockQuantity - v.reservedQuantity);

    let quantity = item.quantity;
    if (available <= 0) {
      notices.push({ sku: v.sku, type: 'out_of_stock', message: 'This item is out of stock' });
      quantity = 0;
    } else if (quantity > available) {
      notices.push({
        sku: v.sku,
        type: 'stock_reduced',
        message: `Only ${available} left — quantity reduced`,
      });
      quantity = available;
      clamps.push({ id: item.id, quantity });
    }

    if (price !== item.unitPriceAmount) {
      notices.push({
        sku: v.sku,
        type: price > item.unitPriceAmount ? 'price_increased' : 'price_decreased',
        message: `Price changed from ${money(item.unitPriceAmount).formatted} to ${money(price).formatted}`,
      });
    }

    const lineTotal = price * quantity;
    subtotal += lineTotal;

    lines.push({
      sku: v.sku,
      productSlug: p.slug,
      name: p.name,
      image: p.displayImage
        ? { sm: p.displayImage.urlSm, md: p.displayImage.urlMd, lg: p.displayImage.urlLg }
        : null,
      attributes: v.attributeValues.map((a) => ({ name: a.attribute.name, value: a.value })),
      unitPrice: money(price),
      listPrice: price !== v.priceAmount ? money(v.priceAmount) : null,
      quantity,
      available,
      lineTotal: money(lineTotal),
      unavailable: quantity === 0,
    });
  }

  if (opts.persistChanges !== false) {
    if (removals.length) await prisma.cartItem.deleteMany({ where: { id: { in: removals } } });
    for (const c of clamps) {
      await prisma.cartItem.update({ where: { id: c.id }, data: { quantity: c.quantity } });
    }
  }

  return {
    lines,
    notices,
    subtotal: money(subtotal),
    itemCount: lines.filter((l) => !(l as { unavailable: boolean }).unavailable).length,
    unitCount: (lines as { quantity: number }[]).reduce((n, l) => n + l.quantity, 0),
  };
}

// ─────────────────────────────────────────────────────────────── cart ──

cartRouter.get(
  '/cart',
  handler(async (req, res) => {
    const cart = await getOrCreateCart(req, res);
    return ok(res, await buildCart(cart.id));
  }),
);

cartRouter.post(
  '/cart/items',
  validate({
    body: z.object({
      variantSku: z.string().min(1),
      quantity: z.coerce.number().int().min(1).max(MAX_QTY).default(1),
    }),
  }),
  handler(async (req, res) => {
    const { variantSku, quantity } = req.body as { variantSku: string; quantity: number };
    const cart = await getOrCreateCart(req, res);

    const variant = await prisma.productVariant.findFirst({
      where: { sku: variantSku, deletedAt: null, isActive: true },
      include: { product: { include: { subcategory: true } } },
    });
    if (!variant || variant.product.deletedAt || variant.product.status !== 'active') {
      throw new NotFoundError('Product');
    }

    const lineCount = await prisma.cartItem.count({ where: { cartId: cart.id } });
    const existing = await prisma.cartItem.findUnique({
      where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variant.id } },
    });
    if (!existing && lineCount >= MAX_LINES) {
      throw new ConflictError(`A cart can hold at most ${MAX_LINES} different items.`);
    }

    const available = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
    if (available <= 0) throw new ConflictError('This item is out of stock.', 'INSUFFICIENT_STOCK');

    const wanted = Math.min((existing?.quantity ?? 0) + quantity, MAX_QTY);
    const finalQty = Math.min(wanted, available);

    const resolve = await loadDiscountResolver();
    const d = resolve({
      variantId: variant.id,
      productId: variant.productId,
      subcategoryId: variant.product.subcategoryId,
      categoryId: variant.product.subcategory.categoryId,
      price: variant.priceAmount,
    });
    const { price } = applyDiscount(variant.priceAmount, d);

    await prisma.cartItem.upsert({
      where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variant.id } },
      create: {
        cartId: cart.id,
        productVariantId: variant.id,
        quantity: finalQty,
        unitPriceAmount: price,
      },
      update: { quantity: finalQty, unitPriceAmount: price },
    });
    await prisma.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date() } });

    const body = await buildCart(cart.id);
    return ok(res, {
      ...body,
      clamped: finalQty < wanted ? { sku: variantSku, available } : null,
    });
  }),
);

cartRouter.patch(
  '/cart/items/:sku',
  validate({ body: z.object({ quantity: z.coerce.number().int().min(0).max(MAX_QTY) }) }),
  handler(async (req, res) => {
    const cart = await getOrCreateCart(req, res);
    const variant = await prisma.productVariant.findFirst({ where: { sku: req.params.sku } });
    if (!variant) throw new NotFoundError('Item');

    const { quantity } = req.body as { quantity: number };
    if (quantity === 0) {
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id, productVariantId: variant.id },
      });
    } else {
      const available = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
      await prisma.cartItem.updateMany({
        where: { cartId: cart.id, productVariantId: variant.id },
        data: { quantity: Math.min(quantity, Math.max(1, available)) },
      });
    }
    return ok(res, await buildCart(cart.id));
  }),
);

cartRouter.delete(
  '/cart/items/:sku',
  handler(async (req, res) => {
    const cart = await getOrCreateCart(req, res);
    const variant = await prisma.productVariant.findFirst({ where: { sku: req.params.sku } });
    if (variant) {
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id, productVariantId: variant.id },
      });
    }
    return ok(res, await buildCart(cart.id));
  }),
);

cartRouter.delete(
  '/cart',
  handler(async (req, res) => {
    const cart = await getOrCreateCart(req, res);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return ok(res, await buildCart(cart.id));
  }),
);

/**
 * Merges a guest cart into the signed-in cart. Quantities take the MAXIMUM,
 * never the sum — summing silently doubles an order nobody asked for.
 * (Spec §12.5.4)
 */
cartRouter.post(
  '/cart/merge',
  requireAuth,
  handler(async (req, res) => {
    const token = req.cookies?.[GUEST_COOKIE];
    const userCart =
      (await prisma.cart.findUnique({ where: { userId: req.auth!.uid } })) ??
      (await prisma.cart.create({ data: { userId: req.auth!.uid } }));

    if (!token) return ok(res, { ...(await buildCart(userCart.id)), merged: 0 });

    const guestCart = await prisma.cart.findUnique({
      where: { guestToken: token },
      include: { items: true },
    });
    if (!guestCart || guestCart.id === userCart.id) {
      return ok(res, { ...(await buildCart(userCart.id)), merged: 0 });
    }

    let merged = 0;
    for (const item of guestCart.items) {
      const existing = await prisma.cartItem.findUnique({
        where: {
          cartId_productVariantId: { cartId: userCart.id, productVariantId: item.productVariantId },
        },
      });
      if (existing) {
        if (item.quantity > existing.quantity) {
          await prisma.cartItem.update({
            where: { id: existing.id },
            data: { quantity: item.quantity },
          });
          merged += 1;
        }
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: userCart.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPriceAmount: item.unitPriceAmount,
          },
        });
        merged += 1;
      }
    }

    await prisma.cart.delete({ where: { id: guestCart.id } });
    res.clearCookie(GUEST_COOKIE, { path: '/' });
    return ok(res, { ...(await buildCart(userCart.id)), merged });
  }),
);

// ─────────────────────────────────────────────────────────── wishlist ──

async function getOrCreateWishlist(req: Request, res: Response) {
  if (req.auth) {
    return (
      (await prisma.wishlist.findUnique({ where: { userId: req.auth.uid } })) ??
      (await prisma.wishlist.create({ data: { userId: req.auth.uid } }))
    );
  }
  const token = guestToken(req, res);
  return (
    (await prisma.wishlist.findUnique({ where: { guestToken: token } })) ??
    (await prisma.wishlist.create({ data: { guestToken: token } }))
  );
}

async function buildWishlist(wishlistId: number) {
  const rows = await prisma.wishlistItem.findMany({
    where: { wishlistId },
    orderBy: { addedAt: 'desc' },
    include: {
      product: { include: { displayImage: true, subcategory: true } },
      variant: true,
    },
  });
  return {
    items: rows
      .filter((r) => !r.product.deletedAt)
      .map((r) => ({
        productSlug: r.product.slug,
        name: r.product.name,
        image: r.product.displayImage
          ? {
              sm: r.product.displayImage.urlSm,
              md: r.product.displayImage.urlMd,
              lg: r.product.displayImage.urlLg,
            }
          : null,
        price: money(r.variant?.priceAmount ?? r.product.minPriceAmount),
        variantSku: r.variant?.sku ?? null,
        inStock: r.product.totalStock > 0,
      })),
  };
}

cartRouter.get(
  '/wishlist',
  handler(async (req, res) => {
    const w = await getOrCreateWishlist(req, res);
    return ok(res, await buildWishlist(w.id));
  }),
);

cartRouter.post(
  '/wishlist/items',
  validate({ body: z.object({ productSlug: z.string().min(1), variantSku: z.string().optional() }) }),
  handler(async (req, res) => {
    const { productSlug, variantSku } = req.body as { productSlug: string; variantSku?: string };
    const wishlist = await getOrCreateWishlist(req, res);
    const product = await prisma.product.findFirst({
      where: { slug: productSlug, deletedAt: null },
    });
    if (!product) throw new NotFoundError('Product');
    const variant = variantSku
      ? await prisma.productVariant.findFirst({ where: { sku: variantSku } })
      : null;

    const existing = await prisma.wishlistItem.findFirst({
      where: { wishlistId: wishlist.id, productId: product.id, productVariantId: variant?.id ?? null },
    });
    if (!existing) {
      await prisma.wishlistItem.create({
        data: {
          wishlistId: wishlist.id,
          productId: product.id,
          productVariantId: variant?.id ?? null,
        },
      });
    }
    return ok(res, await buildWishlist(wishlist.id));
  }),
);

cartRouter.delete(
  '/wishlist/items/:productSlug',
  handler(async (req, res) => {
    const wishlist = await getOrCreateWishlist(req, res);
    const product = await prisma.product.findFirst({ where: { slug: req.params.productSlug } });
    if (product) {
      await prisma.wishlistItem.deleteMany({
        where: { wishlistId: wishlist.id, productId: product.id },
      });
    }
    return ok(res, await buildWishlist(wishlist.id));
  }),
);

cartRouter.delete(
  '/wishlist',
  handler(async (req, res) => {
    const wishlist = await getOrCreateWishlist(req, res);
    await prisma.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id } });
    return noContent(res);
  }),
);

export { getOrCreateCart, buildCart };
