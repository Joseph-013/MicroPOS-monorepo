import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { id } from './_columns';
import { PAYMENT_METHODS } from './payments';
import { purchaseOrders } from './purchase-orders';

/** Money paid to a supplier towards a purchase order, in full or in parts. Append-only: never edited or deleted. */
export const purchasePayments = sqliteTable(
  'purchase_payments',
  {
    id: id(),
    purchaseOrderId: text()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    /** Cents paid; always positive. */
    amount: integer().notNull(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    /** A receipt, transfer or wallet reference number. */
    reference: text(),
    note: text(),
    /** Who recorded it; null before sign-in exists. */
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    at: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('purchase_payments_purchase_order_id_idx').on(t.purchaseOrderId),
    index('purchase_payments_at_idx').on(t.at),
    check('purchase_payments_amount_positive', sql`${t.amount} > 0`),
  ],
);

export type PurchasePayment = typeof purchasePayments.$inferSelect;
export type NewPurchasePayment = typeof purchasePayments.$inferInsert;
