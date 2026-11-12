import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

/**
 * How a product is sold. `each` is counted (the price is per item); the others are weighed, and the price is
 * per that unit with the quantity a decimal weight (stored in thousandths). Keep in step with PRODUCT_UNITS in
 * @micropos/core (a test checks).
 */
export const PRODUCT_UNITS = ['each', 'kg', 'g', 'lb', 'oz'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/**
 * How stock is tracked: not at all, as one quantity, by batch (lot number), or by batch with an expiry date.
 * Keep in step with PRODUCT_TRACKING in @micropos/core (a test checks).
 */
export const PRODUCT_TRACKING = ['none', 'quantity', 'batch', 'expiry'] as const;
export type ProductTracking = (typeof PRODUCT_TRACKING)[number];

export const products = sqliteTable(
  'products',
  {
    id: id(),
    name: text().notNull(),
    sku: text(),
    /** The scannable or keyed code: an EAN/UPC barcode, or a short PLU for loose goods. */
    barcode: text(),
    /** Price in cents per `unit` (per item, or per kg, lb, ... for weighed products). */
    price: integer().notNull(),
    /** Unit cost in cents, if tracked. */
    cost: integer(),
    unit: text({ enum: PRODUCT_UNITS }).notNull().default('each'),
    tracking: text({ enum: PRODUCT_TRACKING }).notNull().default('none'),
    /** Days from receiving to expiry; pre-fills the expiry date when stock arrives (tracking `expiry`). */
    shelfLifeDays: integer(),
    active: integer({ mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Unique among live products only, so a deleted product never blocks reusing its code.
    uniqueIndex('products_sku_unique').on(t.sku).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('products_barcode_unique').on(t.barcode).where(sql`${t.deletedAt} IS NULL`),
    check('products_unit_valid', sql`${t.unit} IN ('each', 'kg', 'g', 'lb', 'oz')`),
    check('products_tracking_valid', sql`${t.tracking} IN ('none', 'quantity', 'batch', 'expiry')`),
    check('products_shelf_life_positive', sql`${t.shelfLifeDays} IS NULL OR ${t.shelfLifeDays} > 0`),
    check('products_price_non_negative', sql`${t.price} >= 0`),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
