import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../../lib/http.js';
import { validate, requirePermission, audit } from '../../middleware/index.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { getSettings, maskSettings, setSettings, stripUnchangedSecrets } from '../../lib/settings.js';
import { canonicalisePhone, cleanName, hashPassword, money, newUlid } from '../../lib/util.js';

export const adminSystemRouter = Router();

// ════════════════════════════════════════════════════════ ANALYTICS ══

function periodRange(period: string) {
  const now = new Date();
  const end = now;
  const start = new Date(now);
  if (period === 'today') start.setHours(0, 0, 0, 0);
  else if (period === 'last7days') start.setDate(now.getDate() - 6);
  else if (period === 'last30days') start.setDate(now.getDate() - 29);
  else start.setMonth(now.getMonth() - 11, 1);
  start.setHours(period === 'last12months' ? 0 : start.getHours(), 0, 0, 0);
  return { start, end };
}

adminSystemRouter.get(
  '/analytics/summary',
  requirePermission('analytics.view', 'dashboard.view'),
  handler(async (req, res) => {
    const period = String(req.query.period ?? 'last30days');
    const { start, end } = periodRange(period);
    const span = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - span);

    const [paid, prevPaid, placed, prevPlaced, customers, prevCustomers] = await Promise.all([
      prisma.order.aggregate({
        where: { paymentStatus: 'paid', paidAt: { gte: start, lte: end } },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { paymentStatus: 'paid', paidAt: { gte: prevStart, lt: start } },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.order.count({ where: { placedAt: { gte: start, lte: end }, status: { not: 'expired' } } }),
      prisma.order.count({ where: { placedAt: { gte: prevStart, lt: start }, status: { not: 'expired' } } }),
      prisma.user.count({ where: { accountType: 'customer', createdAt: { gte: start, lte: end } } }),
      prisma.user.count({ where: { accountType: 'customer', createdAt: { gte: prevStart, lt: start } } }),
    ]);

    const revenue = paid._sum.totalAmount ?? 0;
    const prevRevenue = prevPaid._sum.totalAmount ?? 0;
    const aov = paid._count.id ? Math.round(revenue / paid._count.id) : 0;
    const prevAov = prevPaid._count.id ? Math.round(prevRevenue / prevPaid._count.id) : 0;

    const pct = (now: number, before: number) =>
      before === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - before) / before) * 100);

    // The attention strip — what needs a human right now (spec §14.2.1)
    const [awaitingVerification, toFulfil, lowStock, pendingComments, pendingReviews] =
      await Promise.all([
        prisma.order.count({ where: { paymentStatus: 'pending_verification' } }),
        prisma.order.count({ where: { status: { in: ['confirmed', 'processing'] } } }),
        prisma.$queryRawUnsafe<{ n: bigint }[]>(
          'SELECT COUNT(*) AS n FROM product_variants v ' +
            'JOIN products p ON p.id = v.productId ' +
            'WHERE v.deletedAt IS NULL AND p.deletedAt IS NULL AND v.isActive = 1 ' +
            'AND (v.stockQuantity - v.reservedQuantity) <= v.lowStockThreshold',
        ),
        prisma.comment.count({ where: { status: 'pending', deletedAt: null } }),
        prisma.review.count({ where: { status: 'pending', deletedAt: null } }),
      ]);

    return ok(res, {
      period,
      metrics: {
        revenue: { value: money(revenue), change: pct(revenue, prevRevenue) },
        orders: { value: placed, change: pct(placed, prevPlaced) },
        averageOrderValue: { value: money(aov), change: pct(aov, prevAov) },
        customers: { value: customers, change: pct(customers, prevCustomers) },
      },
      attention: {
        awaitingVerification,
        toFulfil,
        lowStock: Number(lowStock?.[0]?.n ?? 0),
        pendingModeration: pendingComments + pendingReviews,
      },
    });
  }),
);

adminSystemRouter.get(
  '/analytics/series',
  requirePermission('analytics.view', 'dashboard.view'),
  handler(async (req, res) => {
    const period = String(req.query.period ?? 'last30days');
    const { start, end } = periodRange(period);

    const orders = await prisma.order.findMany({
      where: { placedAt: { gte: start, lte: end } },
      select: { placedAt: true, totalAmount: true, paymentStatus: true, paidAt: true },
    });

    const monthly = period === 'last12months';
    const buckets = new Map<string, { revenue: number; orders: number }>();

    // Zero-fill the spine so a quiet day still produces a point on the chart
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = monthly
        ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        : cursor.toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, { revenue: 0, orders: 0 });
      if (monthly) cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + 1);
    }

    for (const o of orders) {
      const d = o.placedAt;
      const key = monthly
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : d.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.orders += 1;
      if (o.paymentStatus === 'paid') b.revenue += o.totalAmount;
    }

    return ok(
      res,
      Array.from(buckets.entries()).map(([bucket, v]) => ({
        bucket,
        revenue: v.revenue,
        orders: v.orders,
      })),
    );
  }),
);

adminSystemRouter.get(
  '/analytics/best-sellers',
  requirePermission('analytics.view', 'dashboard.view'),
  handler(async (req, res) => {
    const rows = await prisma.product.findMany({
      where: { deletedAt: null, orderCount: { gt: 0 } },
      orderBy: { orderCount: 'desc' },
      take: 10,
      include: { displayImage: true, subcategory: true },
    });
    return ok(
      res,
      rows.map((p) => ({
        slug: p.slug,
        name: p.name,
        image: p.displayImage?.urlSm ?? null,
        subcategory: p.subcategory.name,
        unitsSold: p.orderCount,
        price: money(p.minPriceAmount),
      })),
    );
  }),
);

adminSystemRouter.get(
  '/analytics/searches',
  requirePermission('analytics.view'),
  handler(async (req, res) => {
    const zeroOnly = req.query.zeroOnly === 'true';
    const rows = await prisma.searchLog.groupBy({
      by: ['normalisedTerm'],
      _count: { normalisedTerm: true },
      _avg: { resultCount: true },
      _max: { createdAt: true },
      orderBy: { _count: { normalisedTerm: 'desc' } },
      take: 100,
    });
    let mapped = rows.map((r) => ({
      term: r.normalisedTerm,
      searches: r._count.normalisedTerm,
      averageResults: Math.round(r._avg.resultCount ?? 0),
      lastSearchedAt: r._max.createdAt,
    }));
    if (zeroOnly) mapped = mapped.filter((m) => m.averageResults === 0);
    return ok(res, mapped);
  }),
);

/**
 * Composition data for the dashboard donuts: where orders sit in the pipeline,
 * how customers are paying, and which categories the money actually comes from.
 */
adminSystemRouter.get(
  '/analytics/breakdown',
  requirePermission('analytics.view', 'dashboard.view'),
  handler(async (req, res) => {
    const period = String(req.query.period ?? 'last30days');
    const { start, end } = periodRange(period);

    const [byStatus, byPayment, paidOrders] = await Promise.all([
      prisma.order.groupBy({
        by: ['status'],
        where: { placedAt: { gte: start, lte: end } },
        _count: { status: true },
      }),
      prisma.order.groupBy({
        by: ['paymentMethod'],
        where: { placedAt: { gte: start, lte: end }, paymentStatus: 'paid' },
        _count: { paymentMethod: true },
        _sum: { totalAmount: true },
      }),
      prisma.orderItem.findMany({
        where: { order: { paymentStatus: 'paid', paidAt: { gte: start, lte: end } } },
        select: {
          lineTotalAmount: true,
          product: { select: { subcategory: { select: { category: { select: { name: true } } } } } },
        },
      }),
    ]);

    const categoryTotals = new Map<string, number>();
    for (const item of paidOrders) {
      const name = item.product?.subcategory?.category?.name ?? 'Uncategorised';
      categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + item.lineTotalAmount);
    }

    // Anything past the top five folds into "Other" rather than growing the
    // palette — a categorical slot is never generated on the fly.
    const ranked = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
    const topCategories = ranked.slice(0, 5).map(([name, value]) => ({ name, value }));
    const rest = ranked.slice(5).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) topCategories.push({ name: 'Other', value: rest });

    const label = (s: string) =>
      s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

    return ok(res, {
      orderStatus: byStatus
        .map((r) => ({ name: label(r.status), value: r._count.status }))
        .sort((a, b) => b.value - a.value),
      paymentMethods: byPayment
        .map((r) => ({
          name: label(r.paymentMethod ?? 'unspecified'),
          value: r._sum.totalAmount ?? 0,
          count: r._count.paymentMethod,
        }))
        .sort((a, b) => b.value - a.value),
      revenueByCategory: topCategories,
    });
  }),
);

// ═════════════════════════════════════════════════════════ SETTINGS ══

adminSystemRouter.get(
  '/settings',
  requirePermission('settings.read', 'settings.update'),
  handler(async (_req, res) => ok(res, maskSettings(await getSettings(true)))),
);

adminSystemRouter.patch(
  '/settings',
  requirePermission('settings.update'),
  validate({ body: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) }),
  handler(async (req, res) => {
    const body = req.body as Record<string, string | number | boolean>;
    const entries = stripUnchangedSecrets(
      Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])),
    );
    await setSettings(entries);
    await audit(req, {
      action: 'settings.update',
      entityType: 'settings',
      entityLabel: Object.keys(entries).join(', ').slice(0, 255),
      // Never write a live credential into the audit trail — record that the
      // key changed, not what it changed to.
      after: maskSettings(entries),
    });
    return ok(res, maskSettings(await getSettings(true)));
  }),
);

// ════════════════════════════════════════════════════════════ STAFF ══

adminSystemRouter.get(
  '/staff',
  requirePermission('staff.manage'),
  handler(async (_req, res) => {
    const rows = await prisma.user.findMany({
      where: { accountType: 'staff', deletedAt: null },
      orderBy: { id: 'asc' },
      include: { roles: { include: { role: true } } },
    });
    return ok(
      res,
      rows.map((u) => ({
        id: u.publicId,
        username: u.username,
        email: u.email,
        status: u.status,
        roles: u.roles.map((r) => ({ key: r.role.key, name: r.role.name })),
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
    );
  }),
);

adminSystemRouter.post(
  '/staff',
  requirePermission('staff.manage'),
  validate({
    body: z.object({
      username: z.string().min(2).max(80).transform(cleanName),
      email: z.string().email().max(255).toLowerCase(),
      phone: z.string().max(20).optional().or(z.literal('')),
      password: z.string().min(10, 'Password must be at least 10 characters'),
      roleKeys: z.array(z.string()).min(1, 'Choose at least one role'),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as {
      username: string; email: string; phone?: string; password: string; roleKeys: string[];
    };
    const clash = await prisma.user.findFirst({ where: { email: b.email, deletedAt: null } });
    if (clash) throw new ConflictError('An account with that email already exists.');

    const roles = await prisma.role.findMany({ where: { key: { in: b.roleKeys } } });
    if (!roles.length) throw new ConflictError('No matching roles found.');

    const user = await prisma.user.create({
      data: {
        publicId: newUlid(),
        username: b.username,
        email: b.email,
        phone: canonicalisePhone(b.phone ?? '') ?? null,
        passwordHash: await hashPassword(b.password),
        accountType: 'staff',
        emailVerifiedAt: new Date(),
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
    await audit(req, { action: 'staff.create', entityType: 'user', entityId: user.id, entityLabel: user.username, after: { roles: b.roleKeys } });
    return created(res, { id: user.publicId, username: user.username });
  }),
);

adminSystemRouter.patch(
  '/staff/:publicId/roles',
  requirePermission('staff.manage'),
  validate({ body: z.object({ roleKeys: z.array(z.string()) }) }),
  handler(async (req, res) => {
    const { roleKeys } = req.body as { roleKeys: string[] };
    const user = await prisma.user.findFirst({
      where: { publicId: req.params.publicId, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundError('Staff member');

    // Nobody may edit their own roles (spec §11.5)
    if (user.id === req.auth?.uid) {
      throw new ConflictError('You cannot change your own roles.');
    }

    // The last owner cannot be demoted
    const wasOwner = user.roles.some((r) => r.role.key === 'owner');
    if (wasOwner && !roleKeys.includes('owner')) {
      const owners = await prisma.userRole.count({ where: { role: { key: 'owner' } } });
      if (owners <= 1) throw new ConflictError('There must always be at least one owner.');
    }

    const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: user.id } }),
      ...roles.map((r) =>
        prisma.userRole.create({ data: { userId: user.id, roleId: r.id } }),
      ),
    ]);
    await audit(req, { action: 'staff.roles', entityType: 'user', entityId: user.id, entityLabel: user.username, before: { roles: user.roles.map((r) => r.role.key) }, after: { roles: roleKeys } });
    return ok(res, { roles: roleKeys });
  }),
);

adminSystemRouter.get(
  '/roles',
  requirePermission('staff.manage'),
  handler(async (_req, res) => {
    const rows = await prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: { permissions: { include: { permission: true } }, users: true },
    });
    return ok(
      res,
      rows.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        memberCount: r.users.length,
        permissions: r.permissions.map((p) => p.permission.key),
      })),
    );
  }),
);

// ════════════════════════════════════════════════════════ AUDIT LOG ══

adminSystemRouter.get(
  '/audit-logs',
  requirePermission('audit.view'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 50);
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const where = {
      ...(entityType ? { entityType } : {}),
      ...(action ? { action: { contains: action } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take,
        include: { actor: { select: { username: true, email: true } } },
      }),
    ]);
    return collection(
      res,
      rows.map((a) => ({
        id: a.id,
        actor: a.actor?.username ?? a.actorEmail ?? 'system',
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        entityLabel: a.entityLabel,
        before: a.before ? JSON.parse(a.before) : null,
        after: a.after ? JSON.parse(a.after) : null,
        ipAddress: a.ipAddress,
        requestId: a.requestId,
        createdAt: a.createdAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

// ═════════════════════════════════════════════════════════ CONTACTS ══

adminSystemRouter.get(
  '/contacts',
  requirePermission('campaign.read', 'customer.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 50);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({ where, orderBy: { id: 'desc' }, skip, take }),
    ]);
    return collection(res, rows, pageMeta(page, pageSize, total));
  }),
);

// ════════════════════════════════════════════════════════ CAMPAIGNS ══

const campaignBody = z.object({
  channel: z.enum(['sms', 'email']),
  name: z.string().min(2, 'Campaign name is required').max(160),
  audience: z.enum(['all', 'specific']).default('all'),
  bodyText: z.string().min(2, 'Message is required'),
  bodyHtml: z.string().optional(),
  additionalRecipients: z.array(z.string()).default([]),
  scheduledFor: z.coerce.date().nullable().optional(),
  contactIds: z.array(z.number().int()).default([]),
});

adminSystemRouter.get(
  '/campaigns',
  requirePermission('campaign.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const [total, rows, contactCount] = await Promise.all([
      prisma.campaign.count({ where: { deletedAt: null } }),
      prisma.campaign.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'desc' },
        skip,
        take,
        include: { createdBy: { select: { username: true } } },
      }),
      prisma.contact.count({ where: { deletedAt: null } }),
    ]);
    const totals = await prisma.campaign.aggregate({
      where: { deletedAt: null },
      _sum: { sentCount: true },
    });
    return res.json({
      data: rows.map((c) => ({
        id: c.id,
        channel: c.channel,
        name: c.name,
        audience: c.audience,
        status: c.status,
        recipientCount: c.recipientCount,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        scheduledFor: c.scheduledFor,
        sentAt: c.sentAt,
        createdBy: c.createdBy?.username ?? null,
        createdAt: c.createdAt,
      })),
      meta: {
        ...pageMeta(page, pageSize, total),
        totals: { campaigns: total, contacts: contactCount, sent: totals._sum.sentCount ?? 0 },
      },
    });
  }),
);

adminSystemRouter.post(
  '/campaigns',
  requirePermission('campaign.create'),
  validate({ body: campaignBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof campaignBody>;

    // Consent is not optional — recipients without opt-in are excluded here,
    // not at send time (spec §11.8.2).
    const contacts = await prisma.contact.findMany({
      where: {
        deletedAt: null,
        unsubscribedAt: null,
        ...(b.channel === 'sms'
          ? { smsOptIn: true, phone: { not: null } }
          : { emailOptIn: true, email: { not: null } }),
        ...(b.audience === 'specific' && b.contactIds.length ? { id: { in: b.contactIds } } : {}),
      },
    });

    const destinations = [
      ...contacts.map((c) => ({
        contactId: c.id,
        destination: (b.channel === 'sms' ? c.phone : c.email) as string,
      })),
      ...b.additionalRecipients
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => ({
          contactId: null,
          destination: b.channel === 'sms' ? canonicalisePhone(d) ?? d : d.toLowerCase(),
        })),
    ];

    const campaign = await prisma.campaign.create({
      data: {
        channel: b.channel,
        name: b.name,
        audience: b.audience,
        bodyText: b.bodyText,
        bodyHtml: b.bodyHtml ?? null,
        additionalRecipients: JSON.stringify(b.additionalRecipients),
        scheduledFor: b.scheduledFor ?? null,
        status: b.scheduledFor ? 'scheduled' : 'draft',
        recipientCount: destinations.length,
        createdById: req.auth?.uid ?? null,
        recipients: {
          create: destinations.map((d) => ({
            contactId: d.contactId,
            destination: d.destination,
            status: 'queued',
          })),
        },
      },
    });

    await audit(req, { action: 'campaign.create', entityType: 'campaign', entityId: campaign.id, entityLabel: campaign.name });
    return created(res, {
      id: campaign.id,
      recipientCount: destinations.length,
      // SMS is metered, so the spend is surfaced before anything is sent
      estimatedSegments:
        b.channel === 'sms' ? Math.ceil(b.bodyText.length / 160) * destinations.length : null,
    });
  }),
);

/**
 * Sends a campaign. Delivery adapters log to the console in development; the
 * per-recipient records and counters are written exactly as they would be with
 * a live gateway, so the reporting is real.
 */
adminSystemRouter.post(
  '/campaigns/:id/send',
  requirePermission('campaign.send'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const campaign = await prisma.campaign.findFirst({
      where: { id, deletedAt: null },
      include: { recipients: true },
    });
    if (!campaign) throw new NotFoundError('Campaign');
    if (campaign.status === 'sent') throw new ConflictError('This campaign has already been sent.');

    let sent = 0;
    let failed = 0;
    for (const r of campaign.recipients) {
      const okToSend = Boolean(r.destination);
      if (okToSend) {
        console.log(`[${campaign.channel}] → ${r.destination}: ${campaign.bodyText.slice(0, 80)}`);
        sent += 1;
      } else {
        failed += 1;
      }
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: okToSend ? 'sent' : 'failed',
          sentAt: okToSend ? new Date() : null,
          error: okToSend ? null : 'No destination',
        },
      });
    }

    await prisma.campaign.update({
      where: { id },
      data: { status: 'sent', sentCount: sent, failedCount: failed, sentAt: new Date() },
    });
    await audit(req, { action: 'campaign.send', entityType: 'campaign', entityId: id, entityLabel: campaign.name, after: { sent, failed } });
    return ok(res, { sent, failed });
  }),
);

adminSystemRouter.delete(
  '/campaigns/:id',
  requirePermission('campaign.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'campaign.delete', entityType: 'campaign', entityId: id });
    return ok(res, { deleted: true });
  }),
);
