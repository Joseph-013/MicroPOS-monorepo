import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

export const products = sqliteTable(
  'products',
  {
    id: id(),
    name: text().notNull(),
    sku: text(),
    barcode: text(),
    plu: text(),
    /** Unit price in cents. */
    price: integer().notNull(),
    /** Unit cost in cents, if tracked. */
    cost: integer(),
    active: integer({ mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Unique among live products only, so a deleted product never blocks reusing its code.
    uniqueIndex('products_sku_unique').on(t.sku).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('products_barcode_unique').on(t.barcode).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('products_plu_unique').on(t.plu).where(sql`${t.deletedAt} IS NULL`),
    check('products_price_non_negative', sql`${t.price} >= 0`),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
