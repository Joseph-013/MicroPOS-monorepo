import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { id } from './_columns';
import { products } from './products';
import { purchaseOrders } from './purchase-orders';

/** One product on a purchase order. While the order is still ordered its lines can be replaced; after that they are fixed. */
export const purchaseOrderLines = sqliteTable(
  'purchase_order_lines',
  {
    id: id(),
    purchaseOrderId: text()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    productId: text()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    /** Thousandths of the product's unit. */
    quantityMilli: integer().notNull(),
    /** What one unit costs, in cents (per the product's unit). */
    unitCost: integer().notNull(),
  },
  (t) => [
    index('purchase_order_lines_purchase_order_id_idx').on(t.purchaseOrderId),
    index('purchase_order_lines_product_id_idx').on(t.productId),
  ],
);

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type NewPurchaseOrderLine = typeof purchaseOrderLines.$inferInsert;
