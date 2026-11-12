import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, updatedAt } from './_columns';
import { products } from './products';

/**
 * One delivery of a product: stock is received into a batch and sold out of it. Tracking `quantity` keeps a single
 * unnamed batch (batch_number null) per product; `batch` and `expiry` give every delivery its own lot number, and
 * `expiry` also its expiry date. How much is left is not stored: it is the sum of the batch's stock movements.
 */
export const productBatches = sqliteTable(
  'product_batches',
  {
    id: id(),
    productId: text()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    /** Lot number printed on the delivery; null for the single unnamed batch of a quantity-only product. */
    batchNumber: text(),
    /** Epoch ms when the stock arrived; the tie-breaker when picking which batch to sell from. */
    receivedAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    /** Epoch ms; null when the batch does not expire. */
    expiresAt: integer(),
    /** What one unit of this batch cost, in cents (per the product's unit). */
    unitCost: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // First-expiring-first-out picking reads a product's batches in this order.
    index('product_batches_product_expiry_idx').on(t.productId, t.expiresAt, t.receivedAt),
    uniqueIndex('product_batches_lot_unique')
      .on(t.productId, t.batchNumber)
      .where(sql`${t.batchNumber} IS NOT NULL`),
    uniqueIndex('product_batches_unnamed_unique')
      .on(t.productId)
      .where(sql`${t.batchNumber} IS NULL`),
  ],
);

export type ProductBatch = typeof productBatches.$inferSelect;
export type NewProductBatch = typeof productBatches.$inferInsert;
