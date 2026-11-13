import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { id } from './_columns';
import { orderLines } from './order-lines';
import { productBatches } from './product-batches';
import { products } from './products';
import { purchaseOrderLines } from './purchase-order-lines';

/**
 * Why stock moved. Receipts, refunds, voids and repackaged-in stock add it; sales, waste, expiry, repackaged-out
 * stock and stock returned to a supplier remove it; adjust goes either way.
 */
export const STOCK_MOVEMENT_TYPES = ['receive', 'sale', 'refund', 'void', 'adjust', 'waste', 'expired', 'repack_out', 'repack_in', 'supplier_return'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * Append-only stock ledger. A batch's quantity on hand is the sum of its movements, so every change is on record
 * (who, when, why) and a sale line's movements show exactly which batches it drew from, for recalls and margins.
 */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: id(),
    productId: text()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: text()
      .notNull()
      .references(() => productBatches.id, { onDelete: 'restrict' }),
    type: text({ enum: STOCK_MOVEMENT_TYPES }).notNull(),
    /** Thousandths of the product's unit; positive adds stock, negative removes it. Never zero. */
    quantityMilli: integer().notNull(),
    /** The sale line this movement belongs to (sales, refunds, voids). */
    orderLineId: text().references(() => orderLines.id, { onDelete: 'restrict' }),
    /** The purchase order line a receipt was delivered against (what has arrived of an order is the sum of these). */
    purchaseOrderLineId: text().references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
    /** Who did it; null for system actions or before sign-in exists. */
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    at: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    /** Ties together the movements of one repackage (stock out of the source, stock into the targets). */
    repackageId: text(),
    note: text(),
  },
  (t) => [
    index('stock_movements_batch_id_idx').on(t.batchId),
    index('stock_movements_product_id_idx').on(t.productId),
    index('stock_movements_order_line_id_idx').on(t.orderLineId),
    index('stock_movements_purchase_order_line_id_idx').on(t.purchaseOrderLineId),
    index('stock_movements_employee_id_idx').on(t.employeeId),
    index('stock_movements_at_idx').on(t.at),
    index('stock_movements_repackage_id_idx').on(t.repackageId),
    check('stock_movements_type_valid', sql`${t.type} IN ('receive', 'sale', 'refund', 'void', 'adjust', 'waste', 'expired', 'repack_out', 'repack_in', 'supplier_return')`),
    check(
      'stock_movements_sign_matches_type',
      sql`${t.quantityMilli} <> 0 AND (
        (${t.type} IN ('receive', 'refund', 'void', 'repack_in') AND ${t.quantityMilli} > 0) OR
        (${t.type} IN ('sale', 'waste', 'expired', 'repack_out', 'supplier_return') AND ${t.quantityMilli} < 0) OR
        ${t.type} = 'adjust'
      )`,
    ),
  ],
);

export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;
