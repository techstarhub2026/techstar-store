import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { handler, ok } from '../../lib/http.js';
import { requirePermission } from '../../middleware/index.js';
import {
  bestSellers, missedDemand, profitByCategory, profitByProduct,
  profitSeries, profitSummary, resolvePeriod,
} from '../../lib/analytics.js';
import { money } from '../../lib/util.js';

export const adminReportsRouter = Router();

const periodFrom = (req: { query: Record<string, unknown> }) =>
  resolvePeriod(
    String(req.query.period ?? 'last30days'),
    typeof req.query.from === 'string' ? req.query.from : undefined,
    typeof req.query.to === 'string' ? req.query.to : undefined,
  );

const asMoney = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) out[`${String(k)}Formatted`] = money(Number(row[k] ?? 0)).formatted;
  return out;
};

// ─────────────────────────────────────────────────── profit headline ──

adminReportsRouter.get(
  '/reports/profit',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const s = await profitSummary(period);
    return ok(res, {
      ...s,
      revenue: { ...s.revenue, formatted: money(s.revenue.value).formatted },
      cogs: { ...s.cogs, formatted: money(s.cogs.value).formatted },
      grossProfit: { ...s.grossProfit, formatted: money(s.grossProfit.value).formatted },
      averageOrderValue: {
        ...s.averageOrderValue,
        formatted: money(s.averageOrderValue.value).formatted,
      },
      profitPerOrderFormatted: money(s.profitPerOrder).formatted,
      shippingCollectedFormatted: money(s.shippingCollected).formatted,
      discountsGivenFormatted: money(s.discountsGiven).formatted,
    });
  }),
);

adminReportsRouter.get(
  '/reports/profit/series',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const granularity = req.query.granularity === 'month' ? 'month' : 'day';
    return ok(res, await profitSeries(period, granularity));
  }),
);

adminReportsRouter.get(
  '/reports/profit/products',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const rows = await profitByProduct(period, Number(req.query.limit) || 100);
    return ok(res, rows.map((r) => asMoney(r, ['revenue', 'cogs', 'grossProfit', 'profitPerUnit'])));
  }),
);

adminReportsRouter.get(
  '/reports/profit/categories',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const rows = await profitByCategory(period);
    return ok(res, rows.map((r) => asMoney(r, ['revenue', 'cogs', 'grossProfit'])));
  }),
);

// ───────────────────────────────────────────────── what to stock next ──

adminReportsRouter.get(
  '/reports/best-sellers',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const by = ['units', 'revenue', 'profit'].includes(String(req.query.by))
      ? (req.query.by as 'units' | 'revenue' | 'profit')
      : 'profit';
    const rows = await bestSellers(period, by);
    return ok(res, rows.map((r) => asMoney(r, ['revenue', 'cogs', 'grossProfit', 'profitPerUnit'])));
  }),
);

adminReportsRouter.get(
  '/reports/missed-demand',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const days = Number(req.query.days) || 90;
    return ok(res, await missedDemand(days));
  }),
);

// ──────────────────────────────────────────────────────── customers ──

adminReportsRouter.get(
  '/reports/customers',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);

    const [orders, newCustomers, byRegion] = await Promise.all([
      prisma.order.findMany({
        where: { paymentStatus: 'paid', paidAt: { gte: period.start, lte: period.end } },
        select: { userId: true, customerPhone: true, totalAmount: true },
      }),
      prisma.user.count({
        where: {
          accountType: 'customer',
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.orderShippingAddress.groupBy({
        by: ['region'],
        where: { order: { paymentStatus: 'paid', paidAt: { gte: period.start, lte: period.end } } },
        _count: { region: true },
        orderBy: { _count: { region: 'desc' } },
        take: 15,
      }),
    ]);

    // Identify a buyer by account where there is one, by phone otherwise, so a
    // guest who orders twice is not counted as two people.
    const spend = new Map<string, { orders: number; total: number }>();
    for (const o of orders) {
      const key = o.userId ? `u${o.userId}` : `p${o.customerPhone}`;
      const cur = spend.get(key) ?? { orders: 0, total: 0 };
      cur.orders += 1;
      cur.total += o.totalAmount;
      spend.set(key, cur);
    }
    const buyers = [...spend.values()];
    const repeat = buyers.filter((b) => b.orders > 1).length;

    return ok(res, {
      newCustomers,
      buyingCustomers: buyers.length,
      repeatCustomers: repeat,
      repeatRatePercent: buyers.length
        ? Number(((repeat / buyers.length) * 100).toFixed(1))
        : 0,
      averageLifetimeValue: buyers.length
        ? money(Math.round(buyers.reduce((n, b) => n + b.total, 0) / buyers.length))
        : money(0),
      averageOrdersPerCustomer: buyers.length
        ? Number((orders.length / buyers.length).toFixed(2))
        : 0,
      byRegion: byRegion.map((r) => ({ region: r.region, orders: r._count.region })),
    });
  }),
);

// ──────────────────────────────────────────────────────── operations ──

adminReportsRouter.get(
  '/reports/operations',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const inPeriod = { placedAt: { gte: period.start, lte: period.end } };

    const [placed, paid, cancelled, expired, awaiting, timings] = await Promise.all([
      prisma.order.count({ where: inPeriod }),
      prisma.order.count({ where: { ...inPeriod, paymentStatus: 'paid' } }),
      prisma.order.count({ where: { ...inPeriod, status: 'cancelled' } }),
      prisma.order.count({ where: { ...inPeriod, status: 'expired' } }),
      prisma.order.count({ where: { paymentStatus: 'pending_verification' } }),
      prisma.order.findMany({
        where: { ...inPeriod, paidAt: { not: null } },
        select: { placedAt: true, paidAt: true, shippedAt: true, deliveredAt: true },
      }),
    ]);

    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    };

    const paymentLag = timings
      .filter((t) => t.paidAt)
      .map((t) => Math.round((t.paidAt!.getTime() - t.placedAt.getTime()) / 60_000));
    const fulfilLag = timings
      .filter((t) => t.paidAt && t.shippedAt)
      .map((t) => Math.round((t.shippedAt!.getTime() - t.paidAt!.getTime()) / 3_600_000));
    const deliveryLag = timings
      .filter((t) => t.shippedAt && t.deliveredAt)
      .map((t) => Math.round((t.deliveredAt!.getTime() - t.shippedAt!.getTime()) / 3_600_000));

    return ok(res, {
      ordersPlaced: placed,
      ordersPaid: paid,
      conversionToPaidPercent: placed ? Number(((paid / placed) * 100).toFixed(1)) : 0,
      cancelled,
      expired,
      cancellationRatePercent: placed ? Number(((cancelled / placed) * 100).toFixed(1)) : 0,
      expiryRatePercent: placed ? Number(((expired / placed) * 100).toFixed(1)) : 0,
      awaitingVerificationNow: awaiting,
      medianPaymentLagMinutes: median(paymentLag),
      medianFulfilmentLagHours: median(fulfilLag),
      medianDeliveryLagHours: median(deliveryLag),
    });
  }),
);

// ─────────────────────────────────────────────────────────── exports ──

/**
 * CSV export. UTF-8 with a BOM so Excel opens Swahili and symbol characters
 * correctly, and money as plain integers so spreadsheets can sum it.
 */
function toCsv(rows: Record<string, unknown>[], columns: [string, string][]): string {
  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(([, label]) => escape(label)).join(',');
  const body = rows.map((r) => columns.map(([key]) => escape(r[key])).join(',')).join('\n');
  return `﻿${head}\n${body}`;
}

function sendCsv(res: import('express').Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

adminReportsRouter.get(
  '/exports/products',
  requirePermission('product.read'),
  handler(async (_req, res) => {
    const rows = await prisma.productVariant.findMany({
      where: { deletedAt: null, product: { deletedAt: null } },
      include: {
        supplier: { select: { name: true } },
        product: {
          select: {
            name: true, status: true, brand: true, orderCount: true,
            subcategory: { select: { name: true, category: { select: { name: true } } } },
          },
        },
      },
      orderBy: { sku: 'asc' },
    });

    const csv = toCsv(
      rows.map((v) => ({
        sku: v.sku,
        name: v.product.name,
        category: v.product.subcategory.category.name,
        subcategory: v.product.subcategory.name,
        brand: v.product.brand ?? '',
        supplier: v.supplier?.name ?? '',
        price: v.priceAmount,
        cost: v.costAmount ?? '',
        margin: v.costAmount != null
          ? Number((((v.priceAmount - v.costAmount) / v.priceAmount) * 100).toFixed(1))
          : '',
        onHand: v.stockQuantity,
        reserved: v.reservedQuantity,
        available: Math.max(0, v.stockQuantity - v.reservedQuantity),
        lowStockThreshold: v.lowStockThreshold,
        reorderPoint: v.reorderPoint ?? '',
        binLocation: v.binLocation ?? '',
        status: v.product.status,
        unitsSold: v.product.orderCount,
      })),
      [
        ['sku', 'SKU'], ['name', 'Product'], ['category', 'Category'],
        ['subcategory', 'Subcategory'], ['brand', 'Brand'], ['supplier', 'Supplier'],
        ['price', 'Price'], ['cost', 'Cost'], ['margin', 'Margin %'],
        ['onHand', 'On hand'], ['reserved', 'Reserved'], ['available', 'Available'],
        ['lowStockThreshold', 'Low at'], ['reorderPoint', 'Reorder point'],
        ['binLocation', 'Bin'], ['status', 'Status'], ['unitsSold', 'Units sold'],
      ],
    );
    sendCsv(res, `techstar-products-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }),
);

adminReportsRouter.get(
  '/exports/orders',
  requirePermission('order.read'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const rows = await prisma.order.findMany({
      where: { placedAt: { gte: period.start, lte: period.end } },
      include: { address: true, items: true },
      orderBy: { placedAt: 'desc' },
    });

    const csv = toCsv(
      rows.map((o) => ({
        orderNumber: o.orderNumber,
        placedAt: o.placedAt.toISOString(),
        customer: o.customerName,
        phone: o.customerPhone,
        email: o.customerEmail ?? '',
        region: o.address?.region ?? '',
        district: o.address?.district ?? '',
        method: o.shippingMethodName,
        paymentMethod: o.paymentMethod ?? '',
        paymentStatus: o.paymentStatus,
        status: o.status,
        items: o.items.length,
        units: o.items.reduce((n, i) => n + i.quantity, 0),
        subtotal: o.subtotalAmount,
        shipping: o.shippingAmount,
        total: o.totalAmount,
        paid: o.paidAmount,
        cogs: o.items.reduce((n, i) => n + (i.unitCostAmount ?? 0) * i.quantity, 0),
      })),
      [
        ['orderNumber', 'Order'], ['placedAt', 'Placed'], ['customer', 'Customer'],
        ['phone', 'Phone'], ['email', 'Email'], ['region', 'Region'], ['district', 'District'],
        ['method', 'Shipping method'], ['paymentMethod', 'Payment method'],
        ['paymentStatus', 'Payment status'], ['status', 'Status'],
        ['items', 'Lines'], ['units', 'Units'], ['subtotal', 'Subtotal'],
        ['shipping', 'Shipping'], ['total', 'Total'], ['paid', 'Paid'], ['cogs', 'Cost of goods'],
      ],
    );
    sendCsv(res, `techstar-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }),
);

adminReportsRouter.get(
  '/exports/stock-movements',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const rows = await prisma.stockMovement.findMany({
      where: { createdAt: { gte: period.start, lte: period.end } },
      include: {
        variant: { select: { sku: true, product: { select: { name: true } } } },
        actor: { select: { username: true } },
      },
      orderBy: { id: 'desc' },
      take: 20_000,
    });

    const csv = toCsv(
      rows.map((m) => ({
        at: m.createdAt.toISOString(),
        sku: m.variant.sku,
        product: m.variant.product.name,
        delta: m.delta,
        balanceAfter: m.balanceAfter,
        reason: m.reason,
        reference: m.referenceType ? `${m.referenceType}#${m.referenceId}` : '',
        actor: m.actor?.username ?? 'system',
        note: m.note ?? '',
      })),
      [
        ['at', 'When'], ['sku', 'SKU'], ['product', 'Product'], ['delta', 'Change'],
        ['balanceAfter', 'Balance after'], ['reason', 'Reason'],
        ['reference', 'Reference'], ['actor', 'By'], ['note', 'Note'],
      ],
    );
    sendCsv(res, `techstar-stock-movements-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }),
);

adminReportsRouter.get(
  '/exports/profit',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const period = periodFrom(req);
    const rows = await profitByProduct(period, 5000);
    const csv = toCsv(rows, [
      ['name', 'Product'], ['category', 'Category'], ['subcategory', 'Subcategory'],
      ['unitsSold', 'Units sold'], ['revenue', 'Revenue'], ['cogs', 'Cost of goods'],
      ['grossProfit', 'Gross profit'], ['marginPercent', 'Margin %'],
      ['profitPerUnit', 'Profit per unit'],
    ]);
    sendCsv(res, `techstar-profit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }),
);

adminReportsRouter.get(
  '/exports/customers',
  requirePermission('customer.read'),
  handler(async (_req, res) => {
    const rows = await prisma.user.findMany({
      where: { accountType: 'customer', deletedAt: null },
      include: {
        orders: { select: { totalAmount: true, paymentStatus: true, placedAt: true } },
        addresses: { where: { isDefault: true }, take: 1 },
      },
      orderBy: { id: 'asc' },
    });

    const csv = toCsv(
      rows.map((u) => {
        const paid = u.orders.filter((o) => o.paymentStatus === 'paid');
        return {
          name: u.username,
          email: u.email ?? '',
          phone: u.phone ?? '',
          verified: u.emailVerifiedAt ? 'yes' : 'no',
          region: u.addresses[0]?.region ?? '',
          orders: u.orders.length,
          paidOrders: paid.length,
          lifetimeValue: paid.reduce((n, o) => n + o.totalAmount, 0),
          marketingOptIn: u.marketingOptIn ? 'yes' : 'no',
          joined: u.createdAt.toISOString().slice(0, 10),
        };
      }),
      [
        ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['verified', 'Email verified'],
        ['region', 'Region'], ['orders', 'Orders'], ['paidOrders', 'Paid orders'],
        ['lifetimeValue', 'Lifetime value'], ['marketingOptIn', 'Marketing consent'],
        ['joined', 'Joined'],
      ],
    );
    sendCsv(res, `techstar-customers-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }),
);
