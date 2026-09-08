import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../../lib/http.js';
import { validate, requirePermission, audit } from '../../middleware/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { assertTransition, STATE_LABELS, STATE_TONES } from '../../lib/orderState.js';
import { adjustStock, refreshProductAggregates } from '../../lib/catalogueOps.js';
import { canonicalisePhone, cleanName, money, pad, randomToken } from '../../lib/util.js';
import { orderDto, orderInclude } from '../orders.js';

export const adminSalesRouter = Router();

// ═══════════════════════════════════════════════════════════ ORDERS ══

adminSalesRouter.get(
  '/orders',
  requirePermission('order.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const paymentStatus =
      typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : undefined;

    const where: Record<string, unknown> = {
      ...(status && status !== 'all' ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q } },
              { customerName: { contains: q } },
              { customerPhone: { contains: q } },
              { customerEmail: { contains: q } },
              { paymentNumber: { contains: q } },
              { items: { some: { variantSku: { contains: q } } } },
            ],
          }
        : {}),
    };

    // The verification queue is a work list: oldest first.
    const oldestFirst = paymentStatus === 'pending_verification';

    const [total, rows, counts] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { placedAt: oldestFirst ? 'asc' : 'desc' },
        skip,
        take,
        include: { items: true, address: true },
      }),
      prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    ]);

    return res.json({
      data: rows.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: STATE_LABELS[o.status as keyof typeof STATE_LABELS],
        statusTone: STATE_TONES[o.status as keyof typeof STATE_TONES],
        paymentStatus: o.paymentStatus,
        fulfilmentStatus: o.fulfilmentStatus,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        region: o.address?.region ?? null,
        shippingMethodName: o.shippingMethodName,
        paymentMethod: o.paymentMethod,
        itemCount: o.items.length,
        total: money(o.totalAmount),
        paid: money(o.paidAmount),
        placedAt: o.placedAt,
      })),
      meta: {
        ...pageMeta(page, pageSize, total),
        statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count.status])),
      },
    });
  }),
);

adminSalesRouter.get(
  '/orders/:orderNumber',
  requirePermission('order.read'),
  handler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: orderInclude,
    });
    if (!order) throw new NotFoundError('Order');
    return ok(res, orderDto(order, { includeInternal: true }));
  }),
);

adminSalesRouter.patch(
  '/orders/:orderNumber/status',
  requirePermission('order.update'),
  validate({
    body: z.object({
      status: z.string().min(1),
      note: z.string().max(500).optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const { status, note } = req.body as { status: string; note?: string };
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Order');

    assertTransition(order.status, status);

    await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = { status };

      // Cash on delivery deducts stock at dispatch; prepaid deducts on payment.
      if (status === 'shipped') {
        data.shippedAt = new Date();
        data.fulfilmentStatus = 'shipped';
        if (order.paymentStatus !== 'paid') {
          for (const item of order.items) {
            if (!item.productVariantId) continue;
            await tx.productVariant.update({
              where: { id: item.productVariantId },
              data: { reservedQuantity: { decrement: item.quantity } },
            });
            await adjustStock(tx, item.productVariantId, -item.quantity, 'sale', {
              referenceType: 'order',
              referenceId: order.id,
              actorUserId: req.auth?.uid,
              note: `Shipped on ${order.orderNumber}`,
            });
          }
        }
      }
      if (status === 'processing') data.fulfilmentStatus = 'processing';
      if (status === 'delivered') {
        data.deliveredAt = new Date();
        data.fulfilmentStatus = 'delivered';
      }
      if (status === 'cancelled') {
        data.cancelledAt = new Date();
        data.cancelReason = note || 'Cancelled by staff';
        for (const item of order.items) {
          if (!item.productVariantId) continue;
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
      }

      await tx.order.update({ where: { id: order.id }, data });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'status_changed',
          fromValue: order.status,
          toValue: status,
          actorType: 'staff',
          actorUserId: req.auth?.uid ?? null,
          message: note || null,
        },
      });
    });

    await audit(req, { action: 'order.status_change', entityType: 'order', entityId: order.id, entityLabel: order.orderNumber, before: { status: order.status }, after: { status } });

    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });
    return ok(res, orderDto(full, { includeInternal: true }));
  }),
);

adminSalesRouter.post(
  '/orders/:orderNumber/notes',
  requirePermission('order.update'),
  validate({ body: z.object({ note: z.string().min(1).max(2000) }) }),
  handler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
    });
    if (!order) throw new NotFoundError('Order');
    const { note } = req.body as { note: string };
    const stamped = `${new Date().toISOString()} — ${note}`;
    await prisma.order.update({
      where: { id: order.id },
      data: { internalNote: order.internalNote ? `${order.internalNote}\n${stamped}` : stamped },
    });
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'note_added',
        actorType: 'staff',
        actorUserId: req.auth?.uid ?? null,
        message: note.slice(0, 500),
      },
    });
    return ok(res, { added: true });
  }),
);

// ═════════════════════════════════════════════════════════ PAYMENTS ══

/**
 * Verifies a manual mobile-money payment. The provider reference is required
 * and unique, so the same transaction can never be credited twice — the most
 * likely and most costly manual error (spec §12.8).
 */
adminSalesRouter.post(
  '/orders/:orderNumber/payments/verify',
  requirePermission('payment.verify'),
  validate({
    body: z.object({
      paymentId: z.number().int().optional(),
      providerReference: z.string().min(3, 'Enter the transaction reference').max(120),
      amount: z.number().int().positive(),
      note: z.string().max(255).optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as {
      paymentId?: number; providerReference: string; amount: number; note?: string;
    };
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.paymentStatus === 'paid') {
      throw new ConflictError('This order is already marked paid.');
    }

    const duplicate = await prisma.payment.findFirst({
      where: { provider: 'manual', providerReference: b.providerReference },
    });
    if (duplicate && duplicate.orderId !== order.id) {
      throw new ConflictError(
        'That transaction reference is already recorded against another order.',
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = b.paymentId
        ? await tx.payment.update({
            where: { id: b.paymentId },
            data: {
              status: 'succeeded',
              amount: b.amount,
              providerReference: b.providerReference,
              verifiedById: req.auth?.uid ?? null,
              verifiedAt: new Date(),
            },
          })
        : await tx.payment.create({
            data: {
              orderId: order.id,
              method: order.paymentMethod ?? 'lipa_namba',
              provider: 'manual',
              amount: b.amount,
              status: 'succeeded',
              payerPhone: order.paymentNumber,
              providerReference: b.providerReference,
              merchantReference: order.orderNumber,
              verifiedById: req.auth?.uid ?? null,
              verifiedAt: new Date(),
            },
          });

      const paidAmount = order.paidAmount + b.amount;
      const fullyPaid = paidAmount >= order.totalAmount;

      await tx.order.update({
        where: { id: order.id },
        data: {
          paidAmount,
          paymentStatus: fullyPaid ? 'paid' : 'pending_verification',
          ...(fullyPaid ? { paidAt: new Date() } : {}),
          ...(fullyPaid && order.status === 'awaiting_payment'
            ? { status: 'confirmed', reservationExpiresAt: null }
            : {}),
        },
      });

      // Stock leaves the shelf when the money arrives.
      if (fullyPaid && order.status === 'awaiting_payment') {
        for (const item of order.items) {
          if (!item.productVariantId) continue;
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
          await adjustStock(tx, item.productVariantId, -item.quantity, 'sale', {
            referenceType: 'order',
            referenceId: order.id,
            actorUserId: req.auth?.uid,
            note: `Paid — ${order.orderNumber}`,
          });
        }
      }

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'payment_verified',
          toValue: fullyPaid ? 'paid' : 'partial',
          actorType: 'staff',
          actorUserId: req.auth?.uid ?? null,
          message: `${money(b.amount).formatted} verified — ref ${b.providerReference}${b.note ? ` (${b.note})` : ''}`,
        },
      });

      return { payment, fullyPaid, paidAmount };
    });

    await audit(req, { action: 'payment.verify', entityType: 'order', entityId: order.id, entityLabel: order.orderNumber, after: { amount: b.amount, reference: b.providerReference } });

    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });
    return ok(res, { ...orderDto(full, { includeInternal: true }), fullyPaid: result.fullyPaid });
  }),
);

adminSalesRouter.post(
  '/orders/:orderNumber/refunds',
  requirePermission('payment.refund', 'order.refund'),
  validate({
    body: z.object({
      amount: z.number().int().positive(),
      reason: z.string().min(3).max(255),
      restoreStock: z.boolean().default(false),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as { amount: number; reason: string; restoreStock: boolean };
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.paidAmount <= 0) throw new ConflictError('This order has no payment to refund.');
    if (b.amount > order.paidAmount) {
      throw new ValidationError([
        { field: 'amount', code: 'range', message: 'A refund cannot exceed the amount paid' },
      ]);
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: order.paymentMethod ?? 'lipa_namba',
          provider: 'manual',
          amount: b.amount,
          status: 'refunded',
          merchantReference: `${order.orderNumber}-REFUND`,
          verifiedById: req.auth?.uid ?? null,
          verifiedAt: new Date(),
          failureReason: b.reason,
        },
      });
      const remaining = order.paidAmount - b.amount;
      await tx.order.update({
        where: { id: order.id },
        data: {
          paidAmount: remaining,
          paymentStatus: remaining <= 0 ? 'refunded' : 'partially_refunded',
          ...(remaining <= 0 ? { status: 'refunded' } : {}),
        },
      });
      if (b.restoreStock) {
        for (const item of order.items) {
          if (!item.productVariantId) continue;
          await adjustStock(tx, item.productVariantId, item.quantity, 'return', {
            referenceType: 'order',
            referenceId: order.id,
            actorUserId: req.auth?.uid,
            note: `Refund — ${b.reason}`,
          });
        }
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: 'refunded',
          actorType: 'staff',
          actorUserId: req.auth?.uid ?? null,
          message: `${money(b.amount).formatted} refunded — ${b.reason}`,
        },
      });
    });

    await audit(req, { action: 'order.refund', entityType: 'order', entityId: order.id, entityLabel: order.orderNumber, after: { amount: b.amount, reason: b.reason } });
    const full = await prisma.order.findUnique({ where: { id: order.id }, include: orderInclude });
    return ok(res, orderDto(full, { includeInternal: true }));
  }),
);

// ════════════════════════════════════════════════════════ CUSTOMERS ══

adminSalesRouter.get(
  '/customers',
  requirePermission('customer.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where = {
      deletedAt: null,
      accountType: 'customer',
      ...(q
        ? {
            OR: [
              { username: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take,
        include: {
          profileImage: true,
          orders: { select: { totalAmount: true, paymentStatus: true, placedAt: true } },
        },
      }),
    ]);

    return collection(
      res,
      rows.map((u) => {
        const paid = u.orders.filter((o) => o.paymentStatus === 'paid');
        return {
          id: u.publicId,
          username: u.username,
          email: u.email,
          emailVerified: Boolean(u.emailVerifiedAt),
          phone: u.phone,
          status: u.status,
          orderCount: u.orders.length,
          lifetimeValue: money(paid.reduce((n, o) => n + o.totalAmount, 0)),
          lastOrderAt: u.orders.length
            ? u.orders.map((o) => o.placedAt).sort((a, b) => b.getTime() - a.getTime())[0]
            : null,
          createdAt: u.createdAt,
          avatar: u.profileImage ? u.profileImage.urlSm : null,
        };
      }),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminSalesRouter.get(
  '/customers/:publicId',
  requirePermission('customer.read'),
  handler(async (req, res) => {
    const u = await prisma.user.findFirst({
      where: { publicId: req.params.publicId, deletedAt: null },
      include: {
        profileImage: true,
        addresses: { where: { deletedAt: null } },
        orders: { orderBy: { placedAt: 'desc' }, include: { items: true } },
        reviews: true,
      },
    });
    if (!u) throw new NotFoundError('Customer');

    // Reading a customer record is itself an auditable event (spec §14.7).
    await audit(req, { action: 'customer.view', entityType: 'user', entityId: u.id, entityLabel: u.username });

    const paid = u.orders.filter((o) => o.paymentStatus === 'paid');
    return ok(res, {
      id: u.publicId,
      username: u.username,
      email: u.email,
      emailVerified: Boolean(u.emailVerifiedAt),
      phone: u.phone,
      status: u.status,
      marketingOptIn: u.marketingOptIn,
      avatar: u.profileImage ? u.profileImage.urlMd : null,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      stats: {
        orderCount: u.orders.length,
        paidCount: paid.length,
        lifetimeValue: money(paid.reduce((n, o) => n + o.totalAmount, 0)),
        reviewCount: u.reviews.length,
      },
      addresses: u.addresses,
      orders: u.orders.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: STATE_LABELS[o.status as keyof typeof STATE_LABELS],
        paymentStatus: o.paymentStatus,
        itemCount: o.items.length,
        total: money(o.totalAmount),
        placedAt: o.placedAt,
      })),
    });
  }),
);

adminSalesRouter.post(
  '/customers/:publicId/suspend',
  requirePermission('customer.suspend'),
  validate({ body: z.object({ suspend: z.boolean(), reason: z.string().max(255).optional() }) }),
  handler(async (req, res) => {
    const { suspend, reason } = req.body as { suspend: boolean; reason?: string };
    const u = await prisma.user.findFirst({
      where: { publicId: req.params.publicId, deletedAt: null },
    });
    if (!u) throw new NotFoundError('Customer');

    await prisma.user.update({
      where: { id: u.id },
      data: { status: suspend ? 'suspended' : 'active' },
    });
    if (suspend) {
      await prisma.session.updateMany({
        where: { userId: u.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await audit(req, { action: suspend ? 'customer.suspend' : 'customer.unsuspend', entityType: 'user', entityId: u.id, entityLabel: u.username, after: { reason } });
    return ok(res, { status: suspend ? 'suspended' : 'active' });
  }),
);

// ════════════════════════════════════════════════ SHIPPING METHODS ══

const shippingBody = z.object({
  name: z.string().min(2, 'Shipping method is required').max(80).transform(cleanName),
  description: z.string().min(5, 'Description is required').max(500),
  costAmount: z.number().int().min(0, 'Please enter a valid shipping cost'),
  requiresShippingAddress: z.boolean().default(true),
  acceptsMobilePayment: z.boolean().default(true),
  isCashOnDelivery: z.boolean().default(false),
  freeOverAmount: z.number().int().positive().nullable().optional(),
  estimatedDaysMin: z.number().int().min(0).nullable().optional(),
  estimatedDaysMax: z.number().int().min(0).nullable().optional(),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminSalesRouter.get(
  '/shipping-methods',
  requirePermission('shipping.read'),
  handler(async (_req, res) => {
    const rows = await prisma.shippingMethod.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { costAmount: 'asc' }],
    });
    return ok(res, rows.map((m) => ({ ...m, cost: money(m.costAmount) })));
  }),
);

adminSalesRouter.post(
  '/shipping-methods',
  requirePermission('shipping.create'),
  validate({ body: shippingBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof shippingBody>;
    const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const clash = await prisma.shippingMethod.findFirst({ where: { slug, deletedAt: null } });
    if (clash) throw new ConflictError('A method with this name already exists');
    const row = await prisma.shippingMethod.create({ data: { ...b, slug } });
    await audit(req, { action: 'shipping.create', entityType: 'shipping_method', entityId: row.id, entityLabel: row.name, after: row });
    return created(res, row);
  }),
);

adminSalesRouter.patch(
  '/shipping-methods/:id',
  requirePermission('shipping.update'),
  validate({ body: shippingBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.shippingMethod.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Shipping method');
    const row = await prisma.shippingMethod.update({ where: { id }, data: req.body as object });
    await audit(req, { action: 'shipping.update', entityType: 'shipping_method', entityId: id, entityLabel: row.name, before, after: row });
    return ok(res, row);
  }),
);

adminSalesRouter.delete(
  '/shipping-methods/:id',
  requirePermission('shipping.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const method = await prisma.shippingMethod.findFirst({ where: { id, deletedAt: null } });
    if (!method) throw new NotFoundError('Shipping method');

    const remaining = await prisma.shippingMethod.count({
      where: { deletedAt: null, isActive: true, id: { not: id } },
    });
    if (remaining === 0) {
      throw new ConflictError(
        'This is the last active shipping method — checkout would have nothing to offer.',
      );
    }
    await prisma.shippingMethod.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'shipping.delete', entityType: 'shipping_method', entityId: id, entityLabel: method.name });
    return ok(res, { deleted: true });
  }),
);

// ═════════════════════════════════════════════════════════ INVOICES ══

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });
  const seq = last ? Number(last.invoiceNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${pad(seq, 6)}`;
}

const invoiceBody = z.object({
  orderId: z.number().int().nullable().optional(),
  clientName: z.string().min(2, 'Client name is required').max(120).transform(cleanName),
  clientEmail: z.string().email('Enter a valid email').max(255),
  clientPhone: z.string().max(20).optional().or(z.literal('')),
  clientAddress: z.string().max(500).optional().or(z.literal('')),
  shippingMethodName: z.string().max(80).optional().or(z.literal('')),
  shippingAmount: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().or(z.literal('')),
  status: z.enum(['draft', 'issued']).default('draft'),
  items: z
    .array(
      z.object({
        productVariantId: z.number().int().nullable().optional(),
        description: z.string().min(1).max(255),
        sku: z.string().max(20).nullable().optional(),
        unitPriceAmount: z.number().int().min(0),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'Add at least one line item'),
});

adminSalesRouter.get(
  '/invoices',
  requirePermission('invoice.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q } },
              { clientName: { contains: q } },
              { clientEmail: { contains: q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take,
        include: { order: { select: { orderNumber: true } } },
      }),
    ]);
    return collection(
      res,
      rows.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        orderNumber: i.order?.orderNumber ?? null,
        clientName: i.clientName,
        clientEmail: i.clientEmail,
        total: money(i.totalAmount),
        status: i.status,
        issuedAt: i.issuedAt,
        createdAt: i.createdAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminSalesRouter.get(
  '/invoices/:id',
  requirePermission('invoice.read'),
  handler(async (req, res) => {
    const inv = await prisma.invoice.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
      include: { items: { orderBy: { position: 'asc' } }, order: true },
    });
    if (!inv) throw new NotFoundError('Invoice');
    return ok(res, {
      ...inv,
      subtotal: money(inv.subtotalAmount),
      shipping: money(inv.shippingAmount),
      total: money(inv.totalAmount),
      items: inv.items.map((it) => ({
        ...it,
        unitPrice: money(it.unitPriceAmount),
        lineTotal: money(it.lineTotalAmount),
      })),
    });
  }),
);

adminSalesRouter.post(
  '/invoices',
  requirePermission('invoice.create'),
  validate({ body: invoiceBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof invoiceBody>;
    const subtotal = b.items.reduce((n, i) => n + i.unitPriceAmount * i.quantity, 0);
    const total = subtotal + b.shippingAmount;

    const row = await prisma.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceNumber(),
        orderId: b.orderId ?? null,
        clientName: b.clientName,
        clientEmail: b.clientEmail.toLowerCase(),
        clientPhone: canonicalisePhone(b.clientPhone ?? '') ?? null,
        clientAddress: b.clientAddress || null,
        shippingMethodName: b.shippingMethodName || null,
        subtotalAmount: subtotal,
        shippingAmount: b.shippingAmount,
        totalAmount: total,
        status: b.status,
        issuedAt: b.status === 'issued' ? new Date() : null,
        notes: b.notes || null,
        createdById: req.auth?.uid ?? null,
        items: {
          create: b.items.map((it, index) => ({
            productVariantId: it.productVariantId ?? null,
            description: it.description,
            sku: it.sku || null,
            unitPriceAmount: it.unitPriceAmount,
            quantity: it.quantity,
            lineTotalAmount: it.unitPriceAmount * it.quantity,
            position: index,
          })),
        },
      },
    });
    await audit(req, { action: 'invoice.create', entityType: 'invoice', entityId: row.id, entityLabel: row.invoiceNumber });
    return created(res, row);
  }),
);

adminSalesRouter.post(
  '/invoices/:id/share',
  requirePermission('invoice.update', 'invoice.create'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!inv) throw new NotFoundError('Invoice');
    const token = randomToken(24).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32).padEnd(32, '0');
    await prisma.invoice.update({ where: { id }, data: { shareToken: token } });
    return ok(res, { shareUrl: `/invoice/${token}` });
  }),
);

adminSalesRouter.patch(
  '/invoices/:id/status',
  requirePermission('invoice.update'),
  validate({ body: z.object({ status: z.enum(['draft', 'issued', 'paid', 'void']) }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const inv = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!inv) throw new NotFoundError('Invoice');
    if (inv.status !== 'draft' && status === 'draft') {
      throw new ConflictError('An issued invoice cannot go back to draft. Void and re-issue.');
    }
    const row = await prisma.invoice.update({
      where: { id },
      data: {
        status,
        ...(status === 'issued' && !inv.issuedAt ? { issuedAt: new Date() } : {}),
        ...(status === 'paid' ? { paidAt: new Date() } : {}),
      },
    });
    await audit(req, { action: 'invoice.status', entityType: 'invoice', entityId: id, entityLabel: row.invoiceNumber, before: { status: inv.status }, after: { status } });
    return ok(res, row);
  }),
);

adminSalesRouter.delete(
  '/invoices/:id',
  requirePermission('invoice.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!inv) throw new NotFoundError('Invoice');
    if (inv.status !== 'draft') {
      throw new ConflictError('Only a draft invoice can be deleted. Void it instead.');
    }
    await prisma.invoice.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'invoice.delete', entityType: 'invoice', entityId: id, entityLabel: inv.invoiceNumber });
    return ok(res, { deleted: true });
  }),
);
