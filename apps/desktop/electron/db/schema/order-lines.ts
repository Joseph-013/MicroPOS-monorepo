import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orders } from './orders';
import { products } from './products';
import { id } from './_columns';

/** Lines copy the product's name and price at sale time, so receipts survive later edits. */
export const orderLines = sqliteTable(
  'order_lines',
  {
    id: id(),
    orderId: text()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Null if the product was deleted. */
    productId: text().references(() => products.id, { onDelete: 'set null' }),
    name: text().notNull(),
    /** Unit price in cents at sale time. */
    unitPrice: integer().notNull(),
    /** Thousandths of a unit: 1000 = 1, 1250 = 1.25 kg. Negative on refund lines. */
    quantityMilli: integer().notNull(),
    /** round(unitPrice * quantityMilli / 1000), in cents. */
    lineTotal: integer().notNull(),
  },
  (t) => [
    index('order_lines_order_id_idx').on(t.orderId),
    index('order_lines_product_id_idx').on(t.productId),
    check('order_lines_quantity_non_zero', sql`${t.quantityMilli} <> 0`),
  ],
);

export type OrderLine = typeof orderLines.$inferSelect;
export type NewOrderLine = typeof orderLines.$inferInsert;
