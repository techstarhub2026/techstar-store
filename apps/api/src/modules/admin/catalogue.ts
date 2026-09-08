import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { handler, ok, created, collection, pagination, pageMeta } from '../../lib/http.js';
import { validate, requirePermission, audit } from '../../middleware/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import {
  adjustStock,
  attachProductImage,
  detachProductImage,
  nextCategoryCode,
  nextProductSku,
  nextSubcategoryCode,
  refreshProductAggregates,
  refreshTaxonomyCounts,
  uniqueSlug,
  variantSku,
} from '../../lib/catalogueOps.js';
import { attributeHash, cleanName, money, sanitizeHtml, stripHtml } from '../../lib/util.js';
import { toMediaDto } from '../../lib/storage.js';
import { productInclude } from '../../lib/serialize.js';

export const adminCatalogueRouter = Router();

// ═══════════════════════════════════════════════════════ CATEGORIES ══

const categoryBody = z.object({
  name: z.string().min(2, 'Name is required').max(120).transform(cleanName),
  skuCode: z
    .string()
    .regex(/^[0-9]{2}$/, 'SKU must be exactly 2 digits')
    .optional(),
  description: z.string().max(500).optional().or(z.literal('')),
  imageId: z.number().int().nullable().optional(),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminCatalogueRouter.get(
  '/categories',
  requirePermission('category.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 50);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where = { deletedAt: null, ...(q ? { name: { contains: q } } : {}) };
    const [total, rows] = await Promise.all([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        skip,
        take,
        include: { image: true },
      }),
    ]);
    return collection(
      res,
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        skuCode: c.skuCode,
        description: c.description,
        image: c.image ? toMediaDto(c.image) : null,
        position: c.position,
        subcategoryCount: c.subcategoryCount,
        productCount: c.productCount,
        isActive: c.isActive,
        createdAt: c.createdAt,
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminCatalogueRouter.post(
  '/categories',
  requirePermission('category.create'),
  validate({ body: categoryBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof categoryBody>;
    const row = await prisma.$transaction(async (tx) => {
      const skuCode = b.skuCode ?? (await nextCategoryCode(tx));
      const clash = await tx.category.findFirst({ where: { skuCode } });
      if (clash) throw new ConflictError('That SKU is already in use');
      return tx.category.create({
        data: {
          name: b.name,
          slug: await uniqueSlug(tx, 'category', b.name),
          skuCode,
          description: b.description || null,
          imageId: b.imageId ?? null,
          position: b.position,
          isActive: b.isActive,
        },
      });
    });
    await audit(req, { action: 'category.create', entityType: 'category', entityId: row.id, entityLabel: row.name, after: row });
    return created(res, row);
  }),
);

adminCatalogueRouter.patch(
  '/categories/:id',
  requirePermission('category.update'),
  validate({ body: categoryBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Category');
    const b = req.body as Partial<z.infer<typeof categoryBody>>;

    if (b.skuCode && b.skuCode !== before.skuCode) {
      const clash = await prisma.category.findFirst({
        where: { skuCode: b.skuCode, id: { not: id } },
      });
      if (clash) throw new ConflictError('That SKU is already in use');
    }

    const row = await prisma.category.update({
      where: { id },
      data: {
        ...(b.name ? { name: b.name } : {}),
        ...(b.skuCode ? { skuCode: b.skuCode } : {}),
        ...(b.description !== undefined ? { description: b.description || null } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await audit(req, { action: 'category.update', entityType: 'category', entityId: id, entityLabel: row.name, before, after: row });
    return ok(res, row);
  }),
);

adminCatalogueRouter.delete(
  '/categories/:id',
  requirePermission('category.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const category = await prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new NotFoundError('Category');

    // RESTRICT, not cascade — this is the fix for defect R12. One mis-click
    // must not destroy a swathe of catalogue.
    const children = await prisma.subcategory.count({ where: { categoryId: id, deletedAt: null } });
    if (children > 0) {
      throw new ConflictError(
        `This category still has ${children} subcategor${children === 1 ? 'y' : 'ies'}. ` +
          'Move or delete them first.',
      );
    }
    await prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'category.delete', entityType: 'category', entityId: id, entityLabel: category.name, before: category });
    return ok(res, { deleted: true });
  }),
);

adminCatalogueRouter.patch(
  '/categories/order',
  requirePermission('category.update'),
  validate({ body: z.object({ ids: z.array(z.number().int()).min(1) }) }),
  handler(async (req, res) => {
    const { ids } = req.body as { ids: number[] };
    await prisma.$transaction(
      ids.map((id, index) => prisma.category.update({ where: { id }, data: { position: index } })),
    );
    return ok(res, { reordered: ids.length });
  }),
);

// ════════════════════════════════════════════════════ SUBCATEGORIES ══

const subcategoryBody = z.object({
  categoryId: z.number().int(),
  name: z.string().min(2, 'Name is required').max(140).transform(cleanName),
  skuCode: z.string().regex(/^[0-9]{4}$/, 'SKU must be exactly 4 digits').optional(),
  description: z.string().max(500).optional().or(z.literal('')),
  imageId: z.number().int().nullable().optional(),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

adminCatalogueRouter.get(
  '/subcategories',
  requirePermission('category.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 100);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    const where = {
      deletedAt: null,
      ...(q ? { name: { contains: q } } : {}),
      ...(categoryId ? { categoryId } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.subcategory.count({ where }),
      prisma.subcategory.findMany({
        where,
        orderBy: [{ skuCode: 'asc' }],
        skip,
        take,
        include: { category: true },
      }),
    ]);
    return collection(
      res,
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        skuCode: s.skuCode,
        description: s.description,
        position: s.position,
        productCount: s.productCount,
        isActive: s.isActive,
        category: { id: s.category.id, name: s.category.name, skuCode: s.category.skuCode },
      })),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminCatalogueRouter.post(
  '/subcategories',
  requirePermission('category.create'),
  validate({ body: subcategoryBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof subcategoryBody>;
    const row = await prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({
        where: { id: b.categoryId, deletedAt: null },
      });
      if (!category) throw new ValidationError([
        { field: 'categoryId', code: 'invalid', message: 'Category is required' },
      ]);

      const skuCode = b.skuCode ?? (await nextSubcategoryCode(tx, b.categoryId));
      if (!skuCode.startsWith(category.skuCode)) {
        throw new ValidationError([
          {
            field: 'skuCode',
            code: 'invalid',
            message: `Subcategory SKU must start with the category code ${category.skuCode}`,
          },
        ]);
      }
      const clash = await tx.subcategory.findFirst({ where: { skuCode } });
      if (clash) throw new ConflictError('That SKU is already in use');

      const created = await tx.subcategory.create({
        data: {
          categoryId: b.categoryId,
          name: b.name,
          slug: await uniqueSlug(tx, 'subcategory', b.name),
          skuCode,
          description: b.description || null,
          imageId: b.imageId ?? null,
          position: b.position,
          isActive: b.isActive,
        },
      });
      await refreshTaxonomyCounts(tx, created.id);
      return created;
    });
    await audit(req, { action: 'subcategory.create', entityType: 'subcategory', entityId: row.id, entityLabel: row.name, after: row });
    return created(res, row);
  }),
);

adminCatalogueRouter.patch(
  '/subcategories/:id',
  requirePermission('category.update'),
  validate({ body: subcategoryBody.partial() }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.subcategory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Subcategory');
    const b = req.body as Partial<z.infer<typeof subcategoryBody>>;

    const row = await prisma.subcategory.update({
      where: { id },
      data: {
        ...(b.categoryId ? { categoryId: b.categoryId } : {}),
        ...(b.name ? { name: b.name } : {}),
        ...(b.skuCode ? { skuCode: b.skuCode } : {}),
        ...(b.description !== undefined ? { description: b.description || null } : {}),
        ...(b.imageId !== undefined ? { imageId: b.imageId } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    await prisma.$transaction(async (tx) => refreshTaxonomyCounts(tx, id));
    await audit(req, { action: 'subcategory.update', entityType: 'subcategory', entityId: id, entityLabel: row.name, before, after: row });
    return ok(res, row);
  }),
);

adminCatalogueRouter.delete(
  '/subcategories/:id',
  requirePermission('category.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const sub = await prisma.subcategory.findFirst({ where: { id, deletedAt: null } });
    if (!sub) throw new NotFoundError('Subcategory');

    const children = await prisma.product.count({ where: { subcategoryId: id, deletedAt: null } });
    if (children > 0) {
      throw new ConflictError(
        `This subcategory still holds ${children} product${children === 1 ? '' : 's'}. ` +
          'Move them to another subcategory first.',
      );
    }
    await prisma.subcategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await prisma.$transaction(async (tx) => refreshTaxonomyCounts(tx));
    await audit(req, { action: 'subcategory.delete', entityType: 'subcategory', entityId: id, entityLabel: sub.name, before: sub });
    return ok(res, { deleted: true });
  }),
);

/** Moves every product from one subcategory to another — the supported
 *  alternative to a destructive delete. SKUs are preserved (spec §12.1). */
adminCatalogueRouter.post(
  '/subcategories/:id/move-products',
  requirePermission('category.update', 'product.update'),
  validate({ body: z.object({ targetSubcategoryId: z.number().int() }) }),
  handler(async (req, res) => {
    const from = Number(req.params.id);
    const { targetSubcategoryId } = req.body as { targetSubcategoryId: number };
    if (from === targetSubcategoryId) {
      throw new ValidationError([
        { field: 'targetSubcategoryId', code: 'invalid', message: 'Choose a different subcategory' },
      ]);
    }
    const target = await prisma.subcategory.findFirst({
      where: { id: targetSubcategoryId, deletedAt: null },
    });
    if (!target) throw new NotFoundError('Target subcategory');

    const result = await prisma.product.updateMany({
      where: { subcategoryId: from, deletedAt: null },
      data: { subcategoryId: targetSubcategoryId },
    });
    await prisma.$transaction(async (tx) => refreshTaxonomyCounts(tx));
    await audit(req, {
      action: 'subcategory.move_products',
      entityType: 'subcategory',
      entityId: from,
      entityLabel: `${result.count} products → ${target.name}`,
    });
    return ok(res, { moved: result.count });
  }),
);

// ═════════════════════════════════════════════════════════ PRODUCTS ══

const variantInput = z.object({
  sku: z.string().optional(),
  attributes: z.array(z.object({ name: z.string().min(1), value: z.string().min(1) })).default([]),
  price: z.number().int().positive('Price must be greater than zero'),
  compareAt: z.number().int().positive().nullable().optional(),
  cost: z.number().int().nonnegative().nullable().optional(),
  stock: z.number().int().min(0, 'Stock cannot be negative'),
  lowStockThreshold: z.number().int().min(0).default(5),
  barcode: z.string().max(64).nullable().optional(),
  isActive: z.boolean().default(true),
});

const productBody = z.object({
  subcategoryId: z.number().int({ message: 'Subcategory is required' }),
  name: z.string().min(3, 'Product name is required').max(255).transform(cleanName),
  shortDescription: z.string().max(500).optional().or(z.literal('')),
  descriptionHtml: z.string().min(1, 'Description is required'),
  brand: z.string().max(120).optional().or(z.literal('')),
  manufacturerPartNumber: z.string().max(80).optional().or(z.literal('')),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  isFeatured: z.boolean().default(false),
  metaTitle: z.string().max(70).optional().or(z.literal('')),
  metaDescription: z.string().max(160).optional().or(z.literal('')),
  imageIds: z.array(z.number().int()).default([]),
  specSheetId: z.number().int().nullable().optional(),
  attributeNames: z.array(z.object({ name: z.string().min(1).max(80), unit: z.string().max(20).optional() })).default([]),
  variants: z.array(variantInput).min(1, 'Add at least one price and stock row'),
});

function validateVariants(
  attributeNames: { name: string }[],
  variants: z.infer<typeof variantInput>[],
) {
  const issues: { field: string; code: string; message: string }[] = [];

  const names = attributeNames.map((a) => a.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    issues.push({
      field: 'attributeNames',
      code: 'duplicate',
      message: 'Attribute names must be unique within a product',
    });
  }

  const seen = new Set<string>();
  variants.forEach((v, i) => {
    if (attributeNames.length && v.attributes.length !== attributeNames.length) {
      issues.push({
        field: `variants.${i}.attributes`,
        code: 'incomplete',
        message: 'Every variant needs a value for each attribute',
      });
    }
    if (v.compareAt != null && v.compareAt <= v.price) {
      issues.push({
        field: `variants.${i}.compareAt`,
        code: 'invalid',
        message: 'Compare-at price must be higher than the price',
      });
    }
    const hash = attributeHash(v.attributes);
    if (seen.has(hash)) {
      issues.push({
        field: `variants.${i}`,
        code: 'duplicate',
        message: 'Two variants have the same combination of values',
      });
    }
    seen.add(hash);
  });

  if (issues.length) throw new ValidationError(issues);
}

adminCatalogueRouter.get(
  '/products',
  requirePermission('product.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 25);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const subcategoryId = req.query.subcategoryId ? Number(req.query.subcategoryId) : undefined;

    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(status && status !== 'all' ? { status } : {}),
      ...(subcategoryId ? { subcategoryId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { skuPrefix: { startsWith: q } },
              { brand: { contains: q } },
              { manufacturerPartNumber: { contains: q } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take,
        include: {
          displayImage: true,
          subcategory: { include: { category: true } },
          variants: { where: { deletedAt: null } },
        },
      }),
    ]);

    return collection(
      res,
      rows.map((p) => {
        const prices = p.variants.map((v) => v.priceAmount);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          sku: p.skuPrefix,
          image: p.displayImage ? toMediaDto(p.displayImage) : null,
          subcategory: { id: p.subcategory.id, name: p.subcategory.name },
          category: { id: p.subcategory.category.id, name: p.subcategory.category.name },
          price: money(prices.length ? Math.min(...prices) : 0),
          priceMax: prices.length && Math.max(...prices) !== Math.min(...prices)
            ? money(Math.max(...prices))
            : null,
          variantCount: p.variants.length,
          totalStock: p.totalStock,
          status: p.status,
          orderCount: p.orderCount,
          updatedAt: p.updatedAt,
        };
      }),
      pageMeta(page, pageSize, total),
    );
  }),
);

adminCatalogueRouter.get(
  '/products/:id',
  requirePermission('product.read'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const p = await prisma.product.findFirst({ where: { id }, include: productInclude });
    if (!p) throw new NotFoundError('Product');
    return ok(res, {
      id: p.id,
      subcategoryId: p.subcategoryId,
      name: p.name,
      slug: p.slug,
      sku: p.skuPrefix,
      shortDescription: p.shortDescription,
      descriptionHtml: p.descriptionHtml,
      brand: p.brand,
      manufacturerPartNumber: p.manufacturerPartNumber,
      status: p.status,
      isFeatured: p.isFeatured,
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      images: p.images.map((i) => ({ ...toMediaDto(i.media), position: i.position, altText: i.altText })),
      specSheet: p.specSheet
        ? { id: p.specSheet.id, filename: p.specSheet.originalFilename, url: p.specSheet.urlLg, byteSize: p.specSheet.byteSize }
        : null,
      attributeNames: p.attributes
        .sort((a, b) => a.position - b.position)
        .map((a) => ({ name: a.name, unit: a.unit })),
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        attributes: v.attributeValues.map((a) => ({ name: a.attribute.name, value: a.value })),
        price: v.priceAmount,
        compareAt: v.compareAtAmount,
        cost: v.costAmount,
        stock: v.stockQuantity,
        reserved: v.reservedQuantity,
        lowStockThreshold: v.lowStockThreshold,
        barcode: v.barcode,
        isActive: v.isActive,
      })),
    });
  }),
);

adminCatalogueRouter.post(
  '/products',
  requirePermission('product.create'),
  validate({ body: productBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof productBody>;
    validateVariants(b.attributeNames, b.variants);
    if (!b.imageIds.length) {
      throw new ValidationError([
        { field: 'imageIds', code: 'required', message: 'At least one image is required' },
      ]);
    }

    const html = sanitizeHtml(b.descriptionHtml);

    const product = await prisma.$transaction(async (tx) => {
      const sub = await tx.subcategory.findFirst({
        where: { id: b.subcategoryId, deletedAt: null },
      });
      if (!sub) throw new ValidationError([
        { field: 'subcategoryId', code: 'invalid', message: 'Subcategory is required' },
      ]);

      const skuPrefix = await nextProductSku(tx, b.subcategoryId);
      const p = await tx.product.create({
        data: {
          subcategoryId: b.subcategoryId,
          name: b.name,
          slug: await uniqueSlug(tx, 'product', b.name),
          skuPrefix,
          shortDescription: b.shortDescription || null,
          descriptionHtml: html,
          descriptionText: stripHtml(html),
          brand: b.brand || null,
          manufacturerPartNumber: b.manufacturerPartNumber || null,
          status: b.status,
          isFeatured: b.isFeatured,
          metaTitle: b.metaTitle || null,
          metaDescription: b.metaDescription || null,
          displayImageId: b.imageIds[0] ?? null,
          specSheetId: b.specSheetId ?? null,
          publishedAt: b.status === 'active' ? new Date() : null,
        },
      });

      for (const [i, mediaId] of b.imageIds.entries()) {
        await attachProductImage(tx, p.id, mediaId, i);
      }
      if (b.imageIds[0]) {
        await tx.mediaFile.update({
          where: { id: b.imageIds[0] },
          data: { referenceCount: { increment: 1 } },
        });
      }
      if (b.specSheetId) {
        await tx.mediaFile.update({
          where: { id: b.specSheetId },
          data: { referenceCount: { increment: 1 } },
        });
      }

      const attrRows = [];
      for (const [i, a] of b.attributeNames.entries()) {
        attrRows.push(
          await tx.productAttribute.create({
            data: { productId: p.id, name: a.name.trim(), unit: a.unit || null, position: i },
          }),
        );
      }

      for (const [i, v] of b.variants.entries()) {
        const variant = await tx.productVariant.create({
          data: {
            productId: p.id,
            sku: v.sku || variantSku(skuPrefix, i + 1),
            attributeHash: attributeHash(v.attributes),
            priceAmount: v.price,
            compareAtAmount: v.compareAt ?? null,
            costAmount: v.cost ?? null,
            stockQuantity: v.stock,
            lowStockThreshold: v.lowStockThreshold,
            barcode: v.barcode || null,
            position: i,
            isActive: v.isActive,
          },
        });
        for (const av of v.attributes) {
          const attr = attrRows.find((a) => a.name.toLowerCase() === av.name.trim().toLowerCase());
          if (attr) {
            await tx.variantAttributeValue.create({
              data: { variantId: variant.id, productAttributeId: attr.id, value: av.value.trim() },
            });
          }
        }
        if (v.stock > 0) {
          await tx.stockMovement.create({
            data: {
              productVariantId: variant.id,
              delta: v.stock,
              balanceAfter: v.stock,
              reason: 'purchase',
              actorUserId: req.auth?.uid ?? null,
              note: 'Opening stock',
            },
          });
        }
      }

      await refreshProductAggregates(tx, p.id);
      await refreshTaxonomyCounts(tx, b.subcategoryId);
      return p;
    });

    await audit(req, { action: 'product.create', entityType: 'product', entityId: product.id, entityLabel: product.name, after: { name: product.name, sku: product.skuPrefix } });
    return created(res, { id: product.id, slug: product.slug, sku: product.skuPrefix });
  }),
);

adminCatalogueRouter.patch(
  '/products/:id',
  requirePermission('product.update'),
  validate({ body: productBody.partial({ variants: true, attributeNames: true, imageIds: true }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const before = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError('Product');
    const b = req.body as Partial<z.infer<typeof productBody>>;

    if (b.variants) validateVariants(b.attributeNames ?? [], b.variants);
    const html = b.descriptionHtml ? sanitizeHtml(b.descriptionHtml) : undefined;

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(b.subcategoryId ? { subcategoryId: b.subcategoryId } : {}),
          ...(b.name ? { name: b.name } : {}),
          ...(b.shortDescription !== undefined ? { shortDescription: b.shortDescription || null } : {}),
          ...(html !== undefined ? { descriptionHtml: html, descriptionText: stripHtml(html) } : {}),
          ...(b.brand !== undefined ? { brand: b.brand || null } : {}),
          ...(b.manufacturerPartNumber !== undefined
            ? { manufacturerPartNumber: b.manufacturerPartNumber || null }
            : {}),
          ...(b.status
            ? {
                status: b.status,
                publishedAt:
                  b.status === 'active' && !before.publishedAt ? new Date() : before.publishedAt,
              }
            : {}),
          ...(b.isFeatured !== undefined ? { isFeatured: b.isFeatured } : {}),
          ...(b.metaTitle !== undefined ? { metaTitle: b.metaTitle || null } : {}),
          ...(b.metaDescription !== undefined ? { metaDescription: b.metaDescription || null } : {}),
        },
      });

      // ── images: replace the whole set when supplied ────────────────
      if (b.imageIds) {
        const existing = await tx.productImage.findMany({ where: { productId: id } });
        for (const row of existing) {
          if (!b.imageIds.includes(row.mediaFileId)) await detachProductImage(tx, row.id);
        }
        for (const [i, mediaId] of b.imageIds.entries()) {
          await attachProductImage(tx, id, mediaId, i);
        }
        await tx.product.update({
          where: { id },
          data: { displayImageId: b.imageIds[0] ?? null },
        });
      }

      // ── spec sheet: swap the single reference when supplied ────────
      if (b.specSheetId !== undefined && b.specSheetId !== before.specSheetId) {
        if (before.specSheetId) {
          await tx.mediaFile.update({
            where: { id: before.specSheetId },
            data: { referenceCount: { decrement: 1 } },
          });
        }
        if (b.specSheetId) {
          await tx.mediaFile.update({
            where: { id: b.specSheetId },
            data: { referenceCount: { increment: 1 } },
          });
        }
        await tx.product.update({ where: { id }, data: { specSheetId: b.specSheetId } });
      }

      // ── variants: replace the matrix when supplied ─────────────────
      if (b.variants) {
        const attrNames = b.attributeNames ?? [];
        await tx.variantAttributeValue.deleteMany({
          where: { variant: { productId: id } },
        });
        await tx.productAttribute.deleteMany({ where: { productId: id } });

        const attrRows = [];
        for (const [i, a] of attrNames.entries()) {
          attrRows.push(
            await tx.productAttribute.create({
              data: { productId: id, name: a.name.trim(), unit: a.unit || null, position: i },
            }),
          );
        }

        const keptIds: number[] = [];
        for (const [i, v] of b.variants.entries()) {
          const sku = v.sku || variantSku(before.skuPrefix, i + 1);
          const hash = attributeHash(v.attributes);
          const existing = await tx.productVariant.findFirst({
            where: { productId: id, sku },
          });

          const variant = existing
            ? await tx.productVariant.update({
                where: { id: existing.id },
                data: {
                  attributeHash: hash,
                  priceAmount: v.price,
                  compareAtAmount: v.compareAt ?? null,
                  costAmount: v.cost ?? null,
                  lowStockThreshold: v.lowStockThreshold,
                  barcode: v.barcode || null,
                  position: i,
                  isActive: v.isActive,
                  deletedAt: null,
                },
              })
            : await tx.productVariant.create({
                data: {
                  productId: id,
                  sku,
                  attributeHash: hash,
                  priceAmount: v.price,
                  compareAtAmount: v.compareAt ?? null,
                  costAmount: v.cost ?? null,
                  stockQuantity: v.stock,
                  lowStockThreshold: v.lowStockThreshold,
                  barcode: v.barcode || null,
                  position: i,
                  isActive: v.isActive,
                },
              });

          // Stock changes go through the ledger, never a bare write
          if (existing && existing.stockQuantity !== v.stock) {
            await adjustStock(tx, variant.id, v.stock - existing.stockQuantity, 'adjustment', {
              actorUserId: req.auth?.uid,
              note: 'Edited from the product form',
            });
          }

          for (const av of v.attributes) {
            const attr = attrRows.find(
              (a) => a.name.toLowerCase() === av.name.trim().toLowerCase(),
            );
            if (attr) {
              await tx.variantAttributeValue.create({
                data: {
                  variantId: variant.id,
                  productAttributeId: attr.id,
                  value: av.value.trim(),
                },
              });
            }
          }
          keptIds.push(variant.id);
        }

        await tx.productVariant.updateMany({
          where: { productId: id, id: { notIn: keptIds }, deletedAt: null },
          data: { deletedAt: new Date(), isActive: false },
        });
      }

      await refreshProductAggregates(tx, id);
      await refreshTaxonomyCounts(tx, b.subcategoryId ?? before.subcategoryId);
    });

    const after = await prisma.product.findUnique({ where: { id } });
    await audit(req, { action: 'product.update', entityType: 'product', entityId: id, entityLabel: after?.name, before: { name: before.name, status: before.status }, after: { name: after?.name, status: after?.status } });
    return ok(res, { id, slug: after?.slug });
  }),
);

adminCatalogueRouter.delete(
  '/products/:id',
  requirePermission('product.delete'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const p = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundError('Product');

    const inCarts = await prisma.cartItem.count({ where: { variant: { productId: id } } });
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'archived' },
      });
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await tx.cartItem.deleteMany({ where: { variant: { productId: id } } });
      await refreshTaxonomyCounts(tx, p.subcategoryId);
    });

    await audit(req, { action: 'product.delete', entityType: 'product', entityId: id, entityLabel: p.name, before: { name: p.name, sku: p.skuPrefix } });
    return ok(res, { deleted: true, removedFromCarts: inCarts });
  }),
);

adminCatalogueRouter.post(
  '/products/bulk-delete',
  requirePermission('product.delete'),
  validate({ body: z.object({ ids: z.array(z.number().int()).min(1) }) }),
  handler(async (req, res) => {
    const { ids } = req.body as { ids: number[] };
    await prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date(), status: 'archived' },
      });
      await tx.productVariant.updateMany({
        where: { productId: { in: ids } },
        data: { deletedAt: new Date(), isActive: false },
      });
      await tx.cartItem.deleteMany({ where: { variant: { productId: { in: ids } } } });
      await refreshTaxonomyCounts(tx);
    });
    await audit(req, { action: 'product.bulk_delete', entityType: 'product', entityLabel: `${ids.length} products` });
    return ok(res, { deleted: ids.length });
  }),
);

adminCatalogueRouter.patch(
  '/products/bulk-status',
  requirePermission('product.update'),
  validate({
    body: z.object({
      ids: z.array(z.number().int()).min(1),
      status: z.enum(['draft', 'active', 'archived']),
    }),
  }),
  handler(async (req, res) => {
    const { ids, status } = req.body as { ids: number[]; status: string };
    await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: {
        status,
        ...(status === 'active' ? { publishedAt: new Date() } : {}),
      },
    });
    await prisma.$transaction(async (tx) => refreshTaxonomyCounts(tx));
    await audit(req, { action: 'product.bulk_status', entityType: 'product', entityLabel: `${ids.length} → ${status}` });
    return ok(res, { updated: ids.length });
  }),
);

/** Replaces a product's image set from images already uploaded to the library. */
adminCatalogueRouter.patch(
  '/products/:id/images',
  requirePermission('product.update'),
  validate({ body: z.object({ imageIds: z.array(z.number().int()) }) }),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    const { imageIds } = req.body as { imageIds: number[] };
    const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundError('Product');

    await prisma.$transaction(async (tx) => {
      const existing = await tx.productImage.findMany({ where: { productId: id } });
      for (const row of existing) {
        if (!imageIds.includes(row.mediaFileId)) await detachProductImage(tx, row.id);
      }
      for (const [i, mediaId] of imageIds.entries()) {
        await attachProductImage(tx, id, mediaId, i);
      }
      await tx.product.update({ where: { id }, data: { displayImageId: imageIds[0] ?? null } });
    });

    const updated = await prisma.product.findUnique({
      where: { id },
      include: { images: { include: { media: true }, orderBy: { position: 'asc' } } },
    });
    await audit(req, { action: 'product.update_images', entityType: 'product', entityId: id, entityLabel: product.name });
    return ok(res, {
      images: (updated?.images ?? []).map((i) => ({ ...toMediaDto(i.media), position: i.position })),
    });
  }),
);

// ════════════════════════════════════════════════════════════ STOCK ══

adminCatalogueRouter.get(
  '/stock',
  requirePermission('stock.read', 'product.read'),
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req, 50);
    const lowOnly = req.query.low === 'true';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const where: Record<string, unknown> = {
      deletedAt: null,
      product: { deletedAt: null },
      ...(q ? { OR: [{ sku: { contains: q } }, { product: { name: { contains: q } } }] } : {}),
    };

    const rows = await prisma.productVariant.findMany({
      where,
      orderBy: [{ stockQuantity: 'asc' }],
      skip: lowOnly ? 0 : skip,
      take: lowOnly ? 500 : take,
      include: {
        product: { include: { displayImage: true } },
        supplier: { select: { id: true, name: true } },
        attributeValues: { include: { attribute: true } },
      },
    });
    const total = await prisma.productVariant.count({ where });

    let mapped = rows.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      productId: v.productId,
      productName: v.product.name,
      image: v.product.displayImage ? toMediaDto(v.product.displayImage) : null,
      attributes: v.attributeValues.map((a) => ({ name: a.attribute.name, value: a.value })),
      onHand: v.stockQuantity,
      reserved: v.reservedQuantity,
      available: Math.max(0, v.stockQuantity - v.reservedQuantity),
      threshold: v.lowStockThreshold,
      isLow: v.stockQuantity - v.reservedQuantity <= v.lowStockThreshold,
      price: money(v.priceAmount),
      unitCost: v.costAmount,
      margin: v.costAmount != null && v.priceAmount > 0
        ? Math.round(((v.priceAmount - v.costAmount) / v.priceAmount) * 100)
        : null,
      reorderPoint: v.reorderPoint,
      reorderQuantity: v.reorderQuantity,
      binLocation: v.binLocation,
      supplierId: v.supplier?.id ?? null,
      supplierName: v.supplier?.name ?? null,
    }));
    if (lowOnly) mapped = mapped.filter((m) => m.isLow).slice(skip, skip + take);

    return collection(res, mapped, pageMeta(page, pageSize, lowOnly ? mapped.length : total));
  }),
);

adminCatalogueRouter.post(
  '/stock/adjust',
  requirePermission('stock.adjust'),
  validate({
    body: z.object({
      variantId: z.number().int(),
      mode: z.enum(['delta', 'absolute']).default('delta'),
      value: z.number().int(),
      reason: z.enum(['purchase', 'adjustment', 'return', 'damage', 'stocktake']),
      note: z.string().max(255).optional().or(z.literal('')),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as {
      variantId: number; mode: string; value: number; reason: string; note?: string;
    };
    const variant = await prisma.productVariant.findFirst({ where: { id: b.variantId } });
    if (!variant) throw new NotFoundError('Variant');

    const delta = b.mode === 'absolute' ? b.value - variant.stockQuantity : b.value;
    if (Math.abs(delta) > 10 && !b.note) {
      throw new ValidationError([
        { field: 'note', code: 'required', message: 'A note is required for adjustments over 10 units' },
      ]);
    }

    const balance = await prisma.$transaction((tx) =>
      adjustStock(tx, b.variantId, delta, b.reason, {
        actorUserId: req.auth?.uid,
        note: b.note || undefined,
      }),
    );
    await audit(req, { action: 'stock.adjust', entityType: 'variant', entityId: b.variantId, entityLabel: variant.sku, before: { stock: variant.stockQuantity }, after: { stock: balance } });
    return ok(res, { variantId: b.variantId, onHand: balance });
  }),
);

adminCatalogueRouter.get(
  '/stock/:variantId/movements',
  requirePermission('stock.read'),
  handler(async (req, res) => {
    const rows = await prisma.stockMovement.findMany({
      where: { productVariantId: Number(req.params.variantId) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { username: true } } },
    });
    return ok(
      res,
      rows.map((m) => ({
        id: m.id,
        delta: m.delta,
        balanceAfter: m.balanceAfter,
        reason: m.reason,
        reference: m.referenceType ? `${m.referenceType}#${m.referenceId}` : null,
        actor: m.actor?.username ?? 'system',
        note: m.note,
        at: m.createdAt,
      })),
    );
  }),
);

// ════════════════════════════════════════════════════════ DISCOUNTS ══

const discountBody = z.object({
  scope: z.enum(['variant', 'product', 'subcategory', 'category']),
  scopeId: z.number().int(),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().int().positive(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().default(true),
});

adminCatalogueRouter.get(
  '/discounts',
  requirePermission('discount.read', 'product.read'),
  handler(async (_req, res) => {
    const rows = await prisma.discount.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return ok(res, rows);
  }),
);

adminCatalogueRouter.post(
  '/discounts',
  requirePermission('discount.create', 'product.update'),
  validate({ body: discountBody }),
  handler(async (req, res) => {
    const b = req.body as z.infer<typeof discountBody>;
    if (b.endsAt <= b.startsAt) {
      throw new ValidationError([
        { field: 'endsAt', code: 'invalid', message: 'The end date must be after the start date' },
      ]);
    }
    if (b.type === 'percentage' && (b.value < 1 || b.value > 90)) {
      throw new ValidationError([
        { field: 'value', code: 'range', message: 'A percentage discount must be between 1 and 90' },
      ]);
    }
    const row = await prisma.discount.create({ data: b });
    await audit(req, { action: 'discount.create', entityType: 'discount', entityId: row.id, entityLabel: `${b.scope}#${b.scopeId}`, after: row });
    return created(res, row);
  }),
);

adminCatalogueRouter.delete(
  '/discounts/:id',
  requirePermission('discount.delete', 'product.update'),
  handler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.discount.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(req, { action: 'discount.delete', entityType: 'discount', entityId: id });
    return ok(res, { deleted: true });
  }),
);
