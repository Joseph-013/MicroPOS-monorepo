import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { id } from './_columns';
import { productBatches } from './product-batches';
import { products } from './products';
import { purchaseOrders } from './purchase-orders';
import { stockMovements } from './stock-movements';
import { suppliers } from './suppliers';

/**
 * Stock sent back to a supplier (expired bread, a damaged delivery), usually for a partial refund. The stock leaves
 * through a `supplier_return` movement; the refund first reduces what is still owed on the purchase order the batch
 * came from (`credited`), and anything beyond that is simply recorded as refunded. Append-only, like the ledgers.
 */
export const supplierReturns = sqliteTable(
  'supplier_returns',
  {
    id: id(),
    supplierId: text()
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    /** The order the batch was received on, when known; null for stock that did not come through a purchase order. */
    purchaseOrderId: text().references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    productId: text()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: text()
      .notNull()
      .references(() => productBatches.id, { onDelete: 'restrict' }),
    /** The movement that took the stock out. */
    stockMovementId: text()
      .notNull()
      .references(() => stockMovements.id, { onDelete: 'restrict' }),
    /** Thousandths of the product's unit; positive. */
    quantityMilli: integer().notNull(),
    /** What the supplier refunds, in cents (0 for none). */
    refundAmount: integer().notNull(),
    /** The part of the refund that reduced what is owed on the purchase order; never more than the refund. */
    creditedAmount: integer().notNull(),
    note: text(),
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    at: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('supplier_returns_supplier_id_idx').on(t.supplierId),
    index('supplier_returns_purchase_order_id_idx').on(t.purchaseOrderId),
    index('supplier_returns_batch_id_idx').on(t.batchId),
    index('supplier_returns_at_idx').on(t.at),
    check('supplier_returns_quantity_positive', sql`${t.quantityMilli} > 0`),
    check('supplier_returns_refund_valid', sql`${t.refundAmount} >= 0 AND ${t.creditedAmount} >= 0 AND ${t.creditedAmount} <= ${t.refundAmount}`),
  ],
);

export type SupplierReturn = typeof supplierReturns.$inferSelect;
export type NewSupplierReturn = typeof supplierReturns.$inferInsert;
