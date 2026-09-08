import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../../lib/http.js';
import { validate, requirePermission, audit } from '../../middleware/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { adjustStock, refreshProductAggregates } from '../../lib/catalogueOps.js';
import {
  deadStockReport, nextPurchaseOrderRef, nextStockTakeRef, postStockTake,
  receivePurchaseOrder, replenishmentReport, stockValuation,
} from '../../lib/inventory.js';
import { canonicalisePhone, cleanName, money } from '../../lib/util.js';

export const adminInventoryRouter = Router();

// ═══════════════════════════════════════════════════════ SUPPLIERS ══

const supplierBody = z.object({
  name: z.string().min(2, 'Supplier name is required').max(140).transform(cleanName),
  contactName: z.string().max(120).optional().or(z.literal('')),
  email: z.string().email('Enter a valid email').max(255).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  notes: z.string().max(2000).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
});

adminInventoryRouter.get(
  '/suppliers',
  requirePermission('stock.read', 'product.read'),
  handler(async (_req, res) => {
    const rows = await prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { variants: true, purchaseOrders: true } } },
    });
    return ok(res, rows.map((s) => ({
      id: s.id,
      name: s.name,
      contactName: s.contactName,
      email: s.email,
      phone: s.phone,
      address: s.address,
      leadTimeDays: s.leadTimeDays,
      notes: s.notes,
      isActive: s.isActive,
      productCount: s._count.variants,
      purchaseOrderCount: s._count.purchaseOrders,
    })));
  }),
);

adminInventoryRouter.post(
  '/suppliers',
  requirePermission('stock.adjust', 'product.create'),
  validate({ body: supplierBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof supplierBody>;
    const row = await prisma.supplier.create({
      data: {
        ...b,
        contactName: b.contactName || null,
        email: b.email || null,
        phone: canonicalisePhone(b.phone ?? '') ?? null,
        address: b.address || null,
        notes: b.notes || null,
      },
    });
    await audit(req, { action: 'supplier.create', entityType: 'supplier', entityId: row.id, entityLabel: row.name });
    return created(res, row);
  }),
);

adminInventoryRouter.patch(
  '/suppliers/:id',
  requirePermission('stock.adjust', 'product.update'),
  validate({ body: supplierBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Supplier');
    const b = req.body as Partial<z.infer<typeof supplierBody>>;
    const row = await prisma.supplier.update({
      where: { id },
      data: {
        ...b,
        ...(b.phone !== undefined ? { phone: canonicalisePhone(b.phone) ?? null } : {}),
      },
    });
    await audit(req, { action: 'supplier.update', entityType: 'supplier', entityId: id, entityLabel: row.name, before, after: row });
    return ok(res, row);
  }),
);

adminInventoryRouter.delete(
  '/suppliers/:id',
  requirePermission('stock.adjust', 'product.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const open = await prisma.purchaseOrder.count({
      where: { supplierId: id, status: { in: ['draft', 'ordered', 'partial'] }, deletedAt: null },
    });
    if (open > 0) {
      throw new ConflictError(
        `This supplier has ${open} open purchase order${open === 1 ? '' : 's'}. Close them first.`,
      );
    }
    await prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'supplier.delete', entityType: 'supplier', entityId: id });
    return ok(res, { deleted: true });
  }),
);

// ══════════════════════════════════════════════════ PURCHASE ORDERS ══

const poBody = z.object({
  supplierId: z.number().int(),
  expectedAt: z.coerce.date().nullable().optional(),
  shippingAmount: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().or(z.literal('')),
  items: z.array(z.object({
    productVariantId: z.number().int(),
    unitCostAmount: z.number().int().min(0),
    quantityOrdered: z.number().int().positive(),
  })).min(1, 'Add at least one line'),
});

adminInventoryRouter.get(
  '/purchase-orders',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where = {
      deletedAt: null,
      ...(status && status !== 'all' ? { status } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take,
        include: { supplier: { select: { name: true } }, items: true },
      }),
    ]);
    return collection(res, rows.map((p) => {
      const ordered = p.items.reduce((n, i) => n + i.quantityOrdered, 0);
      const receivedQty = p.items.reduce((n, i) => n + i.quantityReceived, 0);
      return {
        id: p.id,
        reference: p.reference,
        supplier: p.supplier.name,
        status: p.status,
        lineCount: p.items.length,
        unitsOrdered: ordered,
        unitsReceived: receivedQty,
        progress: ordered ? Math.round((receivedQty / ordered) * 100) : 0,
        total: money(p.totalAmount),
        expectedAt: p.expectedAt,
        createdAt: p.createdAt,
      };
    }), pageMeta(page, pageSize, total));
  }),
);

adminInventoryRouter.get(
  '/purchase-orders/:id',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: Number(req.params.id), deletedAt: null },
      include: {
        supplier: true,
        createdBy: { select: { username: true } },
        items: {
          orderBy: { position: 'asc' },
          include: {
            variant: {
              select: {
                sku: true, stockQuantity: true, costAmount: true,
                product: { select: { name: true, displayImage: { select: { urlSm: true } } } },
              },
            },
          },
        },
      },
    });
    if (!po) throw new NotFoundError('Purchase order');
    return ok(res, {
      id: po.id,
      reference: po.reference,
      status: po.status,
      supplier: po.supplier,
      notes: po.notes,
      expectedAt: po.expectedAt,
      orderedAt: po.orderedAt,
      receivedAt: po.receivedAt,
      createdBy: po.createdBy?.username ?? null,
      createdAt: po.createdAt,
      totals: {
        subtotal: money(po.subtotalAmount),
        shipping: money(po.shippingAmount),
        total: money(po.totalAmount),
      },
      items: po.items.map((i) => ({
        id: i.id,
        variantId: i.productVariantId,
        sku: i.sku,
        description: i.description,
        image: i.variant.product.displayImage?.urlSm ?? null,
        unitCost: money(i.unitCostAmount),
        unitCostAmount: i.unitCostAmount,
        quantityOrdered: i.quantityOrdered,
        quantityReceived: i.quantityReceived,
        outstanding: i.quantityOrdered - i.quantityReceived,
        lineTotal: money(i.lineTotalAmount),
        currentStock: i.variant.stockQuantity,
      })),
    });
  }),
);

adminInventoryRouter.post(
  '/purchase-orders',
  requirePermission('stock.adjust'),
  validate({ body: poBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof poBody>;

    const po = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: b.supplierId, deletedAt: null },
      });
      if (!supplier) {
        throw new ValidationError([
          { field: 'supplierId', code: 'invalid', message: 'Choose a supplier' },
        ]);
      }

      const variants = await tx.productVariant.findMany({
        where: { id: { in: b.items.map((i) => i.productVariantId) }, deletedAt: null },
        include: { product: { select: { name: true } } },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));

      const lines = b.items.map((i, index) => {
        const v = byId.get(i.productVariantId);
        if (!v) {
          throw new ValidationError([
            { field: `items.${index}`, code: 'invalid', message: 'One of the products no longer exists' },
          ]);
        }
        return {
          productVariantId: v.id,
          sku: v.sku,
          description: v.product.name,
          unitCostAmount: i.unitCostAmount,
          quantityOrdered: i.quantityOrdered,
          lineTotalAmount: i.unitCostAmount * i.quantityOrdered,
          position: index,
        };
      });

      const subtotal = lines.reduce((n, l) => n + l.lineTotalAmount, 0);

      return tx.purchaseOrder.create({
        data: {
          reference: await nextPurchaseOrderRef(tx),
          supplierId: b.supplierId,
          status: 'draft',
          subtotalAmount: subtotal,
          shippingAmount: b.shippingAmount,
          totalAmount: subtotal + b.shippingAmount,
          expectedAt: b.expectedAt ?? null,
          notes: b.notes || null,
          createdById: req.auth?.uid ?? null,
          items: { create: lines },
        },
      });
    });

    await audit(req, { action: 'purchase_order.create', entityType: 'purchase_order', entityId: po.id, entityLabel: po.reference });
    return created(res, { id: po.id, reference: po.reference });
  }),
);

adminInventoryRouter.patch(
  '/purchase-orders/:id/status',
  requirePermission('stock.adjust'),
  validate({ body: z.object({ status: z.enum(['draft', 'ordered', 'cancelled']) }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
    if (!po) throw new NotFoundError('Purchase order');

    if (['received', 'partial'].includes(po.status) && status === 'cancelled') {
      throw new ConflictError('Stock has already been received against this order.');
    }

    const row = await prisma.purchaseOrder.update({
      where: { id },
      data: { status, orderedAt: status === 'ordered' ? new Date() : po.orderedAt },
    });
    await audit(req, { action: 'purchase_order.status', entityType: 'purchase_order', entityId: id, entityLabel: po.reference, before: { status: po.status }, after: { status } });
    return ok(res, row);
  }),
);

/** Receives stock — the step that actually changes what is on the shelf. */
adminInventoryRouter.post(
  '/purchase-orders/:id/receive',
  requirePermission('stock.adjust'),
  validate({
    body: z.object({
      lines: z.array(z.object({
        itemId: z.number().int(),
        quantity: z.number().int().min(0),
      })).min(1),
    }),
  }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { lines } = req.body as { lines: { itemId: number; quantity: number }[] };

    const result = await prisma.$transaction((tx) =>
      receivePurchaseOrder(tx, id, lines, req.auth?.uid));

    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    await audit(req, {
      action: 'purchase_order.receive',
      entityType: 'purchase_order',
      entityId: id,
      entityLabel: po?.reference,
      after: { lines: lines.filter((l) => l.quantity > 0), complete: result.complete },
    });
    return ok(res, { received: true, complete: result.complete });
  }),
);

adminInventoryRouter.delete(
  '/purchase-orders/:id',
  requirePermission('stock.adjust'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
    if (!po) throw new NotFoundError('Purchase order');
    if (po.status !== 'draft') {
      throw new ConflictError('Only a draft purchase order can be deleted. Cancel it instead.');
    }
    await prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'purchase_order.delete', entityType: 'purchase_order', entityId: id, entityLabel: po.reference });
    return ok(res, { deleted: true });
  }),
);

// ══════════════════════════════════════════════════════ STOCKTAKES ══

adminInventoryRouter.get(
  '/stock-takes',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const [total, rows] = await Promise.all([
      prisma.stockTake.count(),
      prisma.stockTake.findMany({
        orderBy: { id: 'desc' },
        skip,
        take,
        include: {
          createdBy: { select: { username: true } },
          postedBy: { select: { username: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return collection(res, rows.map((s) => ({
      id: s.id,
      reference: s.reference,
      status: s.status,
      scope: s.scope,
      lineCount: s._count.items,
      varianceLines: s.varianceLines,
      varianceValue: money(s.varianceValue),
      createdBy: s.createdBy?.username ?? null,
      postedBy: s.postedBy?.username ?? null,
      postedAt: s.postedAt,
      createdAt: s.createdAt,
    })), pageMeta(page, pageSize, total));
  }),
);

adminInventoryRouter.get(
  '/stock-takes/:id',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const take = await prisma.stockTake.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        items: {
          orderBy: { sku: 'asc' },
          include: {
            variant: {
              select: {
                stockQuantity: true,
                product: { select: { displayImage: { select: { urlSm: true } } } },
              },
            },
          },
        },
      },
    });
    if (!take) throw new NotFoundError('Stocktake');
    return ok(res, {
      id: take.id,
      reference: take.reference,
      status: take.status,
      scope: take.scope,
      notes: take.notes,
      postedAt: take.postedAt,
      varianceLines: take.varianceLines,
      varianceValue: money(take.varianceValue),
      items: take.items.map((i) => ({
        id: i.id,
        variantId: i.productVariantId,
        sku: i.sku,
        description: i.description,
        image: i.variant.product.displayImage?.urlSm ?? null,
        // For an open sheet the live figure is what matters; once posted the
        // snapshot is the historical record.
        expectedQuantity: take.status === 'posted' ? i.expectedQuantity : i.variant.stockQuantity,
        countedQuantity: i.countedQuantity,
        variance: i.countedQuantity == null
          ? null
          : i.countedQuantity - (take.status === 'posted' ? i.expectedQuantity : i.variant.stockQuantity),
        unitCost: i.unitCostAmount,
        note: i.note,
      })),
    });
  }),
);

adminInventoryRouter.post(
  '/stock-takes',
  requirePermission('stock.adjust'),
  validate({
    body: z.object({
      scope: z.enum(['all', 'category', 'subcategory', 'supplier', 'low_stock']).default('all'),
      scopeId: z.number().int().nullable().optional(),
      notes: z.string().max(2000).optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as { scope: string; scopeId?: number | null; notes?: string };

    const where: Record<string, unknown> = {
      deletedAt: null,
      isActive: true,
      product: { deletedAt: null },
    };
    if (b.scope === 'subcategory' && b.scopeId) where.product = { deletedAt: null, subcategoryId: b.scopeId };
    if (b.scope === 'category' && b.scopeId) {
      where.product = { deletedAt: null, subcategory: { categoryId: b.scopeId } };
    }
    if (b.scope === 'supplier' && b.scopeId) where.supplierId = b.scopeId;

    let variants = await prisma.productVariant.findMany({
      where,
      include: { product: { select: { name: true } } },
    });
    if (b.scope === 'low_stock') {
      variants = variants.filter(
        (v) => v.stockQuantity - v.reservedQuantity <= v.lowStockThreshold,
      );
    }
    if (!variants.length) throw new ConflictError('No products match that scope.');

    const take = await prisma.$transaction(async (tx) =>
      tx.stockTake.create({
        data: {
          reference: await nextStockTakeRef(tx),
          scope: b.scope,
          scopeId: b.scopeId ?? null,
          notes: b.notes || null,
          countedLines: 0,
          createdById: req.auth?.uid ?? null,
          items: {
            create: variants.map((v) => ({
              productVariantId: v.id,
              sku: v.sku,
              description: v.product.name,
              expectedQuantity: v.stockQuantity,
              unitCostAmount: v.costAmount,
            })),
          },
        },
      }));

    await audit(req, { action: 'stock_take.create', entityType: 'stock_take', entityId: take.id, entityLabel: take.reference, after: { lines: variants.length } });
    return created(res, { id: take.id, reference: take.reference, lineCount: variants.length });
  }),
);

adminInventoryRouter.patch(
  '/stock-takes/:id/counts',
  requirePermission('stock.adjust'),
  validate({
    body: z.object({
      counts: z.array(z.object({
        itemId: z.number().int(),
        countedQuantity: z.number().int().min(0).nullable(),
        note: z.string().max(255).optional().or(z.literal('')),
      })).min(1),
    }),
  }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { counts } = req.body as {
      counts: { itemId: number; countedQuantity: number | null; note?: string }[];
    };
    const take = await prisma.stockTake.findUnique({ where: { id } });
    if (!take) throw new NotFoundError('Stocktake');
    if (take.status === 'posted') throw new ConflictError('This stocktake is already posted.');

    await prisma.$transaction(async (tx) => {
      for (const c of counts) {
        await tx.stockTakeItem.updateMany({
          where: { id: c.itemId, stockTakeId: id },
          data: { countedQuantity: c.countedQuantity, note: c.note || null },
        });
      }
      const counted = await tx.stockTakeItem.count({
        where: { stockTakeId: id, countedQuantity: { not: null } },
      });
      await tx.stockTake.update({
        where: { id },
        data: { countedLines: counted, status: counted > 0 ? 'counting' : 'open' },
      });
    });

    return ok(res, { saved: counts.length });
  }),
);

adminInventoryRouter.post(
  '/stock-takes/:id/post',
  requirePermission('stock.adjust'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await prisma.$transaction((tx) => postStockTake(tx, id, req.auth?.uid));
    const take = await prisma.stockTake.findUnique({ where: { id } });
    await audit(req, {
      action: 'stock_take.post',
      entityType: 'stock_take',
      entityId: id,
      entityLabel: take?.reference,
      after: result,
    });
    return ok(res, {
      ...result,
      varianceValueFormatted: money(result.varianceValue).formatted,
    });
  }),
);

// ═══════════════════════════════════════════════ BULK STOCK EDITING ══

/**
 * Spreadsheet-style bulk save. Restocking twenty lines should be one action,
 * not twenty. Price changes are written directly; stock changes go through the
 * ledger so the history stays complete.
 */
adminInventoryRouter.patch(
  '/stock/bulk',
  requirePermission('stock.adjust'),
  validate({
    body: z.object({
      rows: z.array(z.object({
        variantId: z.number().int(),
        stockQuantity: z.number().int().min(0).optional(),
        priceAmount: z.number().int().positive().optional(),
        costAmount: z.number().int().min(0).nullable().optional(),
        lowStockThreshold: z.number().int().min(0).optional(),
        reorderPoint: z.number().int().min(0).nullable().optional(),
        reorderQuantity: z.number().int().min(0).nullable().optional(),
        supplierId: z.number().int().nullable().optional(),
        binLocation: z.string().max(40).nullable().optional(),
      })).min(1).max(500),
      reason: z.enum(['purchase', 'adjustment', 'return', 'damage', 'stocktake']).default('adjustment'),
      note: z.string().max(255).optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as {
      rows: Record<string, number | string | null | undefined>[];
      reason: string;
      note?: string;
    };

    const changes: { sku: string; field: string; from: unknown; to: unknown }[] = [];
    const touchedProducts = new Set<number>();

    await prisma.$transaction(async (tx) => {
      for (const row of b.rows) {
        const variantId = Number(row.variantId);
        const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
        if (!variant) continue;
        touchedProducts.add(variant.productId);

        const data: Record<string, unknown> = {};
        for (const field of [
          'priceAmount', 'costAmount', 'lowStockThreshold',
          'reorderPoint', 'reorderQuantity', 'supplierId', 'binLocation',
        ] as const) {
          if (row[field] === undefined) continue;
          const next = row[field];
          if ((variant as never as Record<string, unknown>)[field] === next) continue;
          data[field] = next;
          changes.push({
            sku: variant.sku,
            field,
            from: (variant as never as Record<string, unknown>)[field],
            to: next,
          });
        }
        if (Object.keys(data).length) {
          await tx.productVariant.update({ where: { id: variantId }, data });
        }

        if (row.stockQuantity !== undefined && row.stockQuantity !== null) {
          const target = Number(row.stockQuantity);
          const delta = target - variant.stockQuantity;
          if (delta !== 0) {
            await adjustStock(tx, variantId, delta, b.reason, {
              actorUserId: req.auth?.uid,
              note: b.note || 'Bulk edit',
            });
            changes.push({
              sku: variant.sku, field: 'stockQuantity',
              from: variant.stockQuantity, to: target,
            });
          }
        }
      }

      for (const productId of touchedProducts) {
        await refreshProductAggregates(tx, productId);
      }
    });

    await audit(req, {
      action: 'stock.bulk_edit',
      entityType: 'variant',
      entityLabel: `${changes.length} change(s) across ${b.rows.length} row(s)`,
      after: changes.slice(0, 200),
    });

    return ok(res, { rowsProcessed: b.rows.length, changes: changes.length });
  }),
);

// ═════════════════════════════════════════════════════════ REPORTS ══

adminInventoryRouter.get(
  '/inventory/valuation',
  requirePermission('stock.read', 'analytics.view'),
  handler(async (_req, res) => {
    const v = await stockValuation();
    return ok(res, {
      atCost: money(v.atCost),
      atRetail: money(v.atRetail),
      potentialMargin: money(v.potentialMargin),
      marginPercent: v.atRetail > 0
        ? Number(((v.potentialMargin / v.atRetail) * 100).toFixed(1))
        : 0,
      unitsOnHand: v.unitsOnHand,
      variantsMissingCost: v.variantsMissingCost,
      byCategory: v.byCategory.map((c) => ({
        category: c.category,
        atCost: money(c.atCost),
        atRetail: money(c.atRetail),
        units: c.units,
      })),
    });
  }),
);

adminInventoryRouter.get(
  '/inventory/replenishment',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const windowDays = Number(req.query.windowDays) || 60;
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const onlyNeeded = req.query.onlyNeeded !== 'false';

    const rows = await replenishmentReport({ windowDays, supplierId, onlyNeeded });
    const totalValue = rows.reduce((n, r) => n + r.orderValue, 0);

    return res.json({
      data: rows.map((r) => ({
        ...r,
        unitCostFormatted: r.unitCost != null ? money(r.unitCost).formatted : null,
        orderValueFormatted: money(r.orderValue).formatted,
      })),
      meta: {
        windowDays,
        rowCount: rows.length,
        totalOrderValue: money(totalValue),
        outOfStock: rows.filter((r) => r.urgency === 'out_of_stock').length,
        critical: rows.filter((r) => r.urgency === 'critical').length,
        low: rows.filter((r) => r.urgency === 'low').length,
      },
    });
  }),
);

adminInventoryRouter.get(
  '/inventory/dead-stock',
  requirePermission('stock.read', 'analytics.view'),
  handler(async (req, res) => {
    const days = Number(req.query.days) || 90;
    const rows = await deadStockReport(days);
    const tiedUp = rows.reduce((n, r) => n + r.tiedUpCapital, 0);
    return res.json({
      data: rows.map((r) => ({
        ...r,
        unitCostFormatted: r.unitCost != null ? money(r.unitCost).formatted : null,
        tiedUpCapitalFormatted: money(r.tiedUpCapital).formatted,
        priceFormatted: money(r.price).formatted,
      })),
      meta: { days, rowCount: rows.length, tiedUpCapital: money(tiedUp) },
    });
  }),
);
