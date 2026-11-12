import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orders } from './orders';
import { id } from './_columns';

export const PAYMENT_METHODS = ['cash', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** An order can have several payments (split tender). */
export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    orderId: text()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    /** Amount applied to the order, in cents (negative for refunds). */
    amount: integer().notNull(),
    /** Cash only: money handed over / given back, in cents. */
    tendered: integer(),
    change: integer(),
    /** Card slip or terminal reference. */
    reference: text(),
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index('payments_order_id_idx').on(t.orderId)],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
