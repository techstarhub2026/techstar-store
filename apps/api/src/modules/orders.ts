import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../lib/http.js';
import { validate, requireAuth } from '../middleware/index.js';
import {
  ConflictError,
  ForbiddenError,
  InsufficientStockError,
  NotFoundError,
  PriceChangedError,
  TokenInvalidError,
  ValidationError,
} from '../lib/errors.js';
import { GUEST_COOKIE } from '../lib/auth.js';
import { applyDiscount, loadDiscountResolver } from '../lib/serialize.js';
import { assertTransition, nextStates, STATE_LABELS, STATE_TONES } from '../lib/orderState.js';
import {
  addHours,
  canonicalisePhone,
  cleanName,
  money,
  pad,
  randomToken,
  sha256,
} from '../lib/util.js';
import { config } from '../config/index.js';

export const orderRouter = Router();

// ───────────────────────────────────────────────────── order numbers ──

async function nextOrderNumber(tx: typeof prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TS-${year}-`;
  const last = await tx.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  const seq = last ? Number(last.orderNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${pad(seq, 6)}`;
}

// ────────────────────────────────────────────────────────── DTO ──

function orderDto(o: any, opts: { includeInternal?: boolean } = {}) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    statusLabel: STATE_LABELS[o.status as keyof typeof STATE_LABELS] ?? o.status,
    statusTone: STATE_TONES[o.status as keyof typeof STATE_TONES] ?? 'neutral',
    paymentStatus: o.paymentStatus,
    fulfilmentStatus: o.fulfilmentStatus,
    customer: {
      name: o.customerName,
      email: o.customerEmail,
      phone: o.customerPhone,
      isGuest: !o.userId,
    },
    items: (o.items ?? []).map((i: any) => ({
      name: i.productName,
      slug: i.productSlug,
      sku: i.variantSku,
      attributes: i.variantAttributes ? JSON.parse(i.variantAttributes) : [],
      image: i.imageUrl,
      unitPrice: money(i.unitPriceAmount),
      quantity: i.quantity,
      lineTotal: money(i.lineTotalAmount),
    })),
    shipping: {
      methodName: o.shippingMethodName,
      cost: money(o.shippingAmount),
      address: o.address
        ? {
            receiverName: o.address.receiverName,
            email: o.address.email,
            phone: o.address.phone,
            country: o.address.country,
            region: o.address.region,
            district: o.address.district,
            streetAddress: o.address.streetAddress,
            postalCode: o.address.postalCode,
          }
        : null,
    },
    payment: {
      method: o.paymentMethod,
      number: o.paymentNumber,
      delegatedPayerEmail: o.delegatedPayerEmail,
      paid: money(o.paidAmount),
      outstanding: money(Math.max(0, o.totalAmount - o.paidAmount)),
      records: (o.payments ?? []).map((p: any) => ({
        id: p.id,
        method: p.method,
        provider: p.provider,
        amount: money(p.amount),
        status: p.status,
        payerPhone: p.payerPhone,
        reference: p.providerReference,
        verifiedAt: p.verifiedAt,
        createdAt: p.createdAt,
      })),
    },
    totals: {
      subtotal: money(o.subtotalAmount),
      discount: money(o.discountAmount),
      shipping: money(o.shippingAmount),
      tax: money(o.taxAmount),
      total: money(o.totalAmount),
    },
    timeline: (o.events ?? []).map((e: any) => ({
      type: e.eventType,
      from: e.fromValue,
      to: e.toValue,
      actorType: e.actorType,
      message: e.message,
      at: e.createdAt,
    })),
    nextStates: nextStates(o.status),
    customerNote: o.customerNote,
    ...(opts.includeInternal ? { internalNote: o.internalNote } : {}),
    cancelReason: o.cancelReason,
    reservationExpiresAt: o.reservationExpiresAt,
    placedAt: o.placedAt,
    paidAt: o.paidAt,
    shippedAt: o.shippedAt,
    deliveredAt: o.deliveredAt,
  };
}

export const orderInclude = {
  items: true,
  address: true,
  payments: { orderBy: { createdAt: 'desc' as const } },
  events: { orderBy: { createdAt: 'desc' as const } },
};

// ─────────────────────────────────────────────────────────── checkout ──

const addressSchema = z.object({
  receiverName: z.string().min(2, "Receiver's name is required").max(120).transform(cleanName),
  email: z.string().email('Enter a valid email').max(255).optional().or(z.literal('')),
  phone: z.string().min(1, 'Phone is required'),
  country: z.string().default('Tanzania'),
  region: z.string().min(1, 'Region is required').max(64),
  district: z.string().min(1, 'District is required').max(64),
  streetAddress: z.string().min(5, 'Street address is required').max(255),
  postalCode: z.string().max(20).optional().or(z.literal('')),
});

const checkoutSchema = z.object({
  customer: z.object({
    name: z.string().min(2, 'Username is required').max(120).transform(cleanName),
    phone: z.string().min(1, 'Phone is required'),
    email: z.string().email('Enter a valid email').max(255).optional().or(z.literal('')),
  }),
  shippingMethodSlug: z.string().min(1, 'Please select a shipping method'),
  shippingAddress: addressSchema.optional(),
  paymentMethod: z.enum(['lipa_namba', 'cash']).optional(),
  paymentNumber: z.string().optional().or(z.literal('')),
  delegatedPayerEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  customerNote: z.string().max(500).optional().or(z.literal('')),
  idempotencyKey: z.string().uuid().optional(),
});

orderRouter.post(
  '/orders',
  validate({ body: checkoutSchema }),
  handler(async (req, res) => {
    const body = req.body as z.infer<typeof checkoutSchema>;
    const issues: { field: string; code: string; message: string }[] = [];

    const phone = canonicalisePhone(body.customer.phone);
    if (!phone) {
      issues.push({
        field: 'customer.phone',
        code: 'invalid',
        message: 'Phone number must be 12 characters long',
      });
    }

    // Idempotency — a double-click must never create two orders (spec §7.7.3)
    if (body.idempotencyKey) {
      const prior = await prisma.order.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
        include: orderInclude,
      });
      if (prior) return ok(res, orderDto(prior));
    }

    const method = await prisma.shippingMethod.findFirst({
      where: { slug: body.shippingMethodSlug, deletedAt: null, isActive: true },
    });
    if (!method) {
      issues.push({
        field: 'shippingMethodSlug',
        code: 'invalid',
        message: 'Please select a shipping method',
      });
    }

    if (method?.requiresShippingAddress && !body.shippingAddress) {
      issues.push({
        field: 'shippingAddress',
        code: 'required',
        message: 'Delivery details are required for this shipping method',
      });
    }

    let paymentMethod = body.paymentMethod ?? null;
    if (method?.isCashOnDelivery) paymentMethod = 'cash';
    if (method?.acceptsMobilePayment && !method.isCashOnDelivery && !paymentMethod) {
      issues.push({
        field: 'paymentMethod',
        code: 'required',
        message: 'Please select a payment method',
      });
    }

    let paymentNumber: string | null = null;
    if (paymentMethod === 'lipa_namba') {
      paymentNumber = canonicalisePhone(body.paymentNumber ?? '');
      if (!paymentNumber) {
        issues.push({
          field: 'paymentNumber',
          code: 'invalid',
          message: body.paymentNumber ? 'Payment number must be 12 characters long' : 'Enter a payment number',
        });
      }
    }

    if (issues.length) throw new ValidationError(issues);

    // ── load the cart ────────────────────────────────────────────────
    const cart = req.auth
      ? await prisma.cart.findUnique({ where: { userId: req.auth.uid }, include: { items: true } })
      : await prisma.cart.findUnique({
          where: { guestToken: req.cookies?.[GUEST_COOKIE] ?? '' },
          include: { items: true },
        });

    if (!cart || cart.items.length === 0) {
      throw new ConflictError('Your cart is empty.', 'CART_EMPTY');
    }

    const resolve = await loadDiscountResolver();

    // ── the order transaction ────────────────────────────────────────
    const order = await prisma.$transaction(async (tx) => {
      // Lock variants in ascending id order to avoid deadlock (spec §20.3)
      const variantIds = cart.items.map((i) => i.productVariantId).sort((a, b) => a - b);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: {
          product: { include: { subcategory: true, displayImage: true } },
          attributeValues: { include: { attribute: true } },
        },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));

      const stockIssues: { field: string; code: string; message: string; meta?: any }[] = [];
      const priceIssues: { field: string; code: string; message: string; meta?: any }[] = [];
      const lines: any[] = [];
      let subtotal = 0;

      for (const item of cart.items) {
        const v = byId.get(item.productVariantId);
        if (!v || v.deletedAt || !v.isActive || v.product.deletedAt || v.product.status !== 'active') {
          stockIssues.push({
            field: `items.${item.productVariantId}`,
            code: 'unavailable',
            message: 'An item in your cart is no longer available',
          });
          continue;
        }

        const d = resolve({
          variantId: v.id,
          productId: v.productId,
          subcategoryId: v.product.subcategoryId,
          categoryId: v.product.subcategory.categoryId,
          price: v.priceAmount,
        });
        const { price } = applyDiscount(v.priceAmount, d);

        if (price > item.unitPriceAmount) {
          priceIssues.push({
            field: v.sku,
            code: 'price_changed',
            message: `${v.product.name}: price changed from ${money(item.unitPriceAmount).formatted} to ${money(price).formatted}`,
            meta: { was: item.unitPriceAmount, now: price },
          });
        }

        const available = Math.max(0, v.stockQuantity - v.reservedQuantity);
        if (available < item.quantity) {
          stockIssues.push({
            field: v.sku,
            code: 'insufficient_stock',
            message: `${v.product.name}: only ${available} available`,
            meta: { available },
          });
          continue;
        }

        const lineTotal = price * item.quantity;
        subtotal += lineTotal;
        lines.push({
          variant: v,
          quantity: item.quantity,
          unitPrice: price,
          lineTotal,
        });
      }

      if (stockIssues.length) throw new InsufficientStockError(stockIssues);
      if (priceIssues.length) throw new PriceChangedError(priceIssues);
      if (!lines.length) throw new ConflictError('Your cart is empty.', 'CART_EMPTY');

      const shippingCost =
        method!.freeOverAmount != null && subtotal >= method!.freeOverAmount ? 0 : method!.costAmount;
      const total = subtotal + shippingCost;

      const isCod = Boolean(method!.isCashOnDelivery);
      const orderNumber = await nextOrderNumber(tx as unknown as typeof prisma);
      const confirmationToken = randomToken(16).slice(0, 32).padEnd(32, '0');

      let paymentTokenRaw: string | null = null;
      let paymentTokenHash: string | null = null;
      if (body.delegatedPayerEmail) {
        paymentTokenRaw = randomToken(32);
        paymentTokenHash = sha256(paymentTokenRaw);
      }

      const createdOrder = await tx.order.create({
        data: {
          orderNumber,
          userId: req.auth?.uid ?? null,
          status: isCod ? 'confirmed' : 'awaiting_payment',
          paymentStatus: 'unpaid',
          fulfilmentStatus: 'unfulfilled',
          customerName: body.customer.name,
          customerEmail: body.customer.email || null,
          customerPhone: phone!,
          shippingMethodId: method!.id,
          shippingMethodName: method!.name,
          subtotalAmount: subtotal,
          shippingAmount: shippingCost,
          totalAmount: total,
          paymentMethod,
          paymentNumber,
          delegatedPayerEmail: body.delegatedPayerEmail || null,
          paymentTokenHash,
          paymentTokenExpiresAt: paymentTokenHash ? addHours(new Date(), 24 * 14) : null,
          confirmationToken,
          idempotencyKey: body.idempotencyKey ?? null,
          customerNote: body.customerNote || null,
          reservationExpiresAt: isCod ? null : addHours(new Date(), config.RESERVATION_HOURS),
          source: 'web',
          items: {
            create: lines.map((l) => ({
              productId: l.variant.productId,
              productVariantId: l.variant.id,
              productName: l.variant.product.name,
              productSlug: l.variant.product.slug,
              variantSku: l.variant.sku,
              variantAttributes: JSON.stringify(
                l.variant.attributeValues.map((a: any) => ({
                  name: a.attribute.name,
                  value: a.value,
                })),
              ),
              imageUrl: l.variant.product.displayImage?.urlMd ?? null,
              unitPriceAmount: l.unitPrice,
              // Cost is snapshotted at the moment of sale. Repricing a product
              // or restocking it at a different cost must never rewrite the
              // margin on an order already placed (spec §18.1).
              unitCostAmount: l.variant.costAmount,
              quantity: l.quantity,
              lineTotalAmount: l.lineTotal,
            })),
          },
          ...(body.shippingAddress
            ? {
                address: {
                  create: {
                    receiverName: body.shippingAddress.receiverName,
                    email: body.shippingAddress.email || null,
                    phone: canonicalisePhone(body.shippingAddress.phone) ?? phone!,
                    country: body.shippingAddress.country || 'Tanzania',
                    region: body.shippingAddress.region,
                    district: body.shippingAddress.district,
                    streetAddress: body.shippingAddress.streetAddress,
                    postalCode: body.shippingAddress.postalCode || null,
                  },
                },
              }
            : {}),
        },
      });

      // Reserve stock — reserved goods stay on the shelf but are not sellable
      for (const l of lines) {
        await tx.productVariant.update({
          where: { id: l.variant.id },
          data: { reservedQuantity: { increment: l.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            productVariantId: l.variant.id,
            delta: 0,
            balanceAfter: l.variant.stockQuantity,
            reason: 'reservation',
            referenceType: 'order',
            referenceId: createdOrder.id,
            note: `Reserved ${l.quantity} for ${orderNumber}`,
          },
        });
        await tx.product.update({
          where: { id: l.variant.productId },
          data: { orderCount: { increment: l.quantity } },
        });
      }

      await tx.orderEvent.create({
        data: {
          orderId: createdOrder.id,
          eventType: 'placed',
          toValue: createdOrder.status,
          actorType: req.auth ? 'customer' : 'system',
          actorUserId: req.auth?.uid ?? null,
          message: `Order placed — ${money(total).formatted}`,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      if (paymentTokenRaw) {
        console.log(
          `[mail] payment request to ${body.delegatedPayerEmail}: /pay/${paymentTokenRaw}`,
        );
      }

      return { createdOrder, confirmationToken };
    });

    const full = await prisma.order.findUnique({
      where: { id: order.createdOrder.id },
      include: orderInclude,
    });

    return created(res, {
      ...orderDto(full),
      confirmationToken: order.confirmationToken,
    });
  }),
);

// ───────────────────────────────────────────────────── customer views ──

orderRouter.get(
  '/orders',
  requireAuth,
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 20);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where = { userId: req.auth!.uid, ...(status && status !== 'all' ? { status } : {}) };

    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip,
        take,
        include: { items: true },
      }),
    ]);

    return collection(
      res,
      rows.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: STATE_LABELS[o.status as keyof typeof STATE_LABELS],
        statusTone: STATE_TONES[o.status as keyof typeof STATE_TONES],
        paymentStatus: o.paymentStatus,
        itemCount: o.items.length,
        total: money(o.totalAmount),
        placedAt: o.placedAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

orderRouter.get(
  '/orders/:orderNumber',
  handler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: orderInclude,
    });
    if (!order) throw new NotFoundError('Order');

    const token = req.headers['x-confirmation-token'] as string | undefined;
    const owns = req.auth && order.userId === req.auth.uid;
    const staff = req.auth?.typ === 'staff';
    const hasToken = token && order.confirmationToken && token === order.confirmationToken;
    if (!owns && !staff && !hasToken) throw new ForbiddenError();

    return ok(res, orderDto(order, { includeInternal: staff }));
  }),
);

orderRouter.post(
  '/orders/:orderNumber/cancel',
  validate({ body: z.object({ reason: z.string().max(255).optional() }) }),
  handler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Order');

    const owns = req.auth && order.userId === req.auth.uid;
    const staff = req.auth?.typ === 'staff';
    if (!owns && !staff) throw new ForbiddenError();

    assertTransition(order.status, 'cancelled');

    await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        if (!item.productVariantId) continue;
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { reservedQuantity: { decrement: item.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            productVariantId: item.productVariantId,
            delta: 0,
            balanceAfter: 0,
            reason: 'release',
            referenceType: 'order',
            referenceId: order.id,
            note: `Released ${item.quantity} — order cancelled`,
          },
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: (req.body as { reason?: string }).reason ?? null,
          reservationExpiresAt: null,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'cancelled',
          fromValue: order.status,
          toValue: 'cancelled',
          actorType: staff ? 'staff' : 'customer',
          actorUserId: req.auth?.uid ?? null,
          message: (req.body as { reason?: string }).reason ?? 'Cancelled',
        },
      });
    });

    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });
    return ok(res, orderDto(full));
  }),
);

orderRouter.post(
  '/orders/:orderNumber/reorder',
  requireAuth,
  handler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { orderNumber: req.params.orderNumber, userId: req.auth!.uid },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Order');

    const cart =
      (await prisma.cart.findUnique({ where: { userId: req.auth!.uid } })) ??
      (await prisma.cart.create({ data: { userId: req.auth!.uid } }));

    const added: string[] = [];
    const unavailable: string[] = [];
    for (const item of order.items) {
      const variant = item.productVariantId
        ? await prisma.productVariant.findFirst({
            where: { id: item.productVariantId, deletedAt: null, isActive: true },
            include: { product: true },
          })
        : null;
      const available = variant ? Math.max(0, variant.stockQuantity - variant.reservedQuantity) : 0;
      if (!variant || variant.product.deletedAt || available <= 0) {
        unavailable.push(item.productName);
        continue;
      }
      await prisma.cartItem.upsert({
        where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variant.id } },
        create: {
          cartId: cart.id,
          productVariantId: variant.id,
          quantity: Math.min(item.quantity, available),
          unitPriceAmount: variant.priceAmount,
        },
        update: { quantity: Math.min(item.quantity, available) },
      });
      added.push(item.productName);
    }
    return ok(res, { added, unavailable });
  }),
);

// ───────────────────────────────────────────────── delegated payment ──

orderRouter.get(
  '/pay/:token',
  handler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { paymentTokenHash: sha256(req.params.token) },
      include: { items: true },
    });
    if (!order) throw new TokenInvalidError('This payment link is not valid.');
    if (order.paymentTokenExpiresAt && order.paymentTokenExpiresAt < new Date()) {
      throw new TokenInvalidError('This payment link has expired.');
    }
    if (order.paymentStatus === 'paid') {
      throw new ConflictError('This order has already been paid.', 'ALREADY_PAID');
    }

    // The payer sees the goods and the amount — never the buyer's contact details.
    const parts = order.customerName.split(' ');
    const requester = `${parts[0]}${parts[1] ? ' ' + parts[1][0] + '.' : ''}`;

    return ok(res, {
      orderNumber: order.orderNumber,
      requestedBy: requester,
      items: order.items.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        lineTotal: money(i.lineTotalAmount),
      })),
      totals: {
        subtotal: money(order.subtotalAmount),
        shipping: money(order.shippingAmount),
        total: money(order.totalAmount),
      },
      status: order.status,
    });
  }),
);

orderRouter.post(
  '/pay/:token',
  validate({
    body: z.object({
      paymentMethod: z.enum(['lipa_namba', 'cash']),
      paymentNumber: z.string().optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const body = req.body as { paymentMethod: string; paymentNumber?: string };
    const order = await prisma.order.findFirst({
      where: { paymentTokenHash: sha256(req.params.token) },
    });
    if (!order) throw new TokenInvalidError('This payment link is not valid.');
    if (order.paymentTokenExpiresAt && order.paymentTokenExpiresAt < new Date()) {
      throw new TokenInvalidError('This payment link has expired.');
    }
    if (order.paymentStatus === 'paid') {
      throw new ConflictError('This order has already been paid.', 'ALREADY_PAID');
    }

    let payerPhone: string | null = null;
    if (body.paymentMethod === 'lipa_namba') {
      payerPhone = canonicalisePhone(body.paymentNumber ?? '');
      if (!payerPhone) {
        throw new ValidationError([
          {
            field: 'paymentNumber',
            code: 'invalid',
            message: body.paymentNumber
              ? 'Payment number must be 12 characters long'
              : 'Enter a payment number',
          },
        ]);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: body.paymentMethod,
          provider: 'manual',
          amount: order.totalAmount,
          status: 'pending',
          payerPhone,
          merchantReference: order.orderNumber,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'pending_verification',
          paymentTokenHash: null, // single use
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'payment_recorded',
          actorType: 'customer',
          message: `Delegated payment recorded from ${payerPhone ?? 'cash'}`,
        },
      });
    });

    return ok(res, { recorded: true, orderNumber: order.orderNumber });
  }),
);

/** A customer recording that they have paid their own order. */
orderRouter.post(
  '/orders/:orderNumber/payments',
  validate({
    body: z.object({
      paymentMethod: z.enum(['lipa_namba', 'cash']),
      paymentNumber: z.string().optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const body = req.body as { paymentMethod: string; paymentNumber?: string };
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
    });
    if (!order) throw new NotFoundError('Order');

    const token = req.headers['x-confirmation-token'] as string | undefined;
    const owns = req.auth && order.userId === req.auth.uid;
    const hasToken = token && order.confirmationToken && token === order.confirmationToken;
    if (!owns && !hasToken) throw new ForbiddenError();
    if (order.paymentStatus === 'paid') {
      throw new ConflictError('This order has already been paid.', 'ALREADY_PAID');
    }

    const payerPhone =
      body.paymentMethod === 'lipa_namba' ? canonicalisePhone(body.paymentNumber ?? '') : null;
    if (body.paymentMethod === 'lipa_namba' && !payerPhone) {
      throw new ValidationError([
        { field: 'paymentNumber', code: 'invalid', message: 'Enter a payment number' },
      ]);
    }

    await prisma.$transaction([
      prisma.payment.create({
        data: {
          orderId: order.id,
          method: body.paymentMethod,
          provider: 'manual',
          amount: order.totalAmount - order.paidAmount,
          status: 'pending',
          payerPhone,
          merchantReference: order.orderNumber,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'pending_verification' },
      }),
      prisma.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'payment_recorded',
          actorType: 'customer',
          message: `Payment details submitted (${payerPhone ?? 'cash'})`,
        },
      }),
    ]);

    return ok(res, { recorded: true });
  }),
);

export { orderDto };
