import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { customers } from './customers';
import { employees } from './employees';
import { createdAt, id, updatedAt } from './_columns';

export const ORDER_STATUSES = ['open', 'completed', 'voided', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** A sale. Orders are never deleted; corrections are voids or refund orders. */
export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    /** Human-readable, sequential, unique (printed on receipts). */
    orderNumber: text().notNull(),
    employeeId: text()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /** The customer a credit sale is on account for (the unpaid part is charged in `customer_ledger`); null for ordinary sales. */
    customerId: text().references(() => customers.id, { onDelete: 'restrict' }),
    /** Set on a refund order: the order it reverses. */
    refundOfOrderId: text().references((): AnySQLiteColumn => orders.id, { onDelete: 'restrict' }),
    status: text({ enum: ORDER_STATUSES }).notNull().default('open'),
    /** All amounts in cents. Refund orders carry negative amounts. */
    subtotal: integer().notNull().default(0),
    discountTotal: integer().notNull().default(0),
    total: integer().notNull().default(0),
    completedAt: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_order_number_unique').on(t.orderNumber),
    index('orders_employee_id_idx').on(t.employeeId),
    index('orders_customer_id_idx').on(t.customerId),
    index('orders_refund_of_order_id_idx').on(t.refundOfOrderId),
    index('orders_created_at_idx').on(t.createdAt),
    index('orders_status_idx').on(t.status),
    check('orders_total_matches', sql`${t.total} = ${t.subtotal} - ${t.discountTotal}`),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
