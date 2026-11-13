import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';
import { employees } from './employees';
import { id } from './_columns';
import { orders } from './orders';
import { PAYMENT_METHODS } from './payments';

/**
 * Why a customer's balance moved. A charge (part of a sale left on account) adds to what they owe; a payment, and the
 * refund or void of a credit sale, take it away; an adjustment corrects it either way (with a note).
 */
export const CUSTOMER_LEDGER_TYPES = ['charge', 'payment', 'refund', 'void', 'adjustment'] as const;
export type CustomerLedgerType = (typeof CUSTOMER_LEDGER_TYPES)[number];

/**
 * Append-only account ledger. What a customer owes is the sum of their entries (positive = they owe the store,
 * negative = the store owes them, for example after a refund of something they had already paid off). Entries are
 * never edited or deleted, so every change to a balance is on record (who, when, why).
 */
export const customerLedger = sqliteTable(
  'customer_ledger',
  {
    id: id(),
    customerId: text()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    type: text({ enum: CUSTOMER_LEDGER_TYPES }).notNull(),
    /** Cents; positive adds to what the customer owes, negative reduces it. Never zero. */
    amount: integer().notNull(),
    /** The credit sale a charge, refund or void belongs to. */
    orderId: text().references(() => orders.id, { onDelete: 'restrict' }),
    /** Payments only: how the customer paid. */
    method: text({ enum: PAYMENT_METHODS }),
    /** Payments only: a receipt, transfer or wallet reference number. */
    reference: text(),
    note: text(),
    /** Who recorded it; null before sign-in exists. */
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    at: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('customer_ledger_customer_id_idx').on(t.customerId),
    index('customer_ledger_order_id_idx').on(t.orderId),
    index('customer_ledger_at_idx').on(t.at),
    check('customer_ledger_type_valid', sql`${t.type} IN ('charge', 'payment', 'refund', 'void', 'adjustment')`),
    check(
      'customer_ledger_sign_matches_type',
      sql`${t.amount} <> 0 AND (
        (${t.type} = 'charge' AND ${t.amount} > 0) OR
        (${t.type} IN ('payment', 'refund', 'void') AND ${t.amount} < 0) OR
        ${t.type} = 'adjustment'
      )`,
    ),
  ],
);

export type CustomerLedgerEntry = typeof customerLedger.$inferSelect;
export type NewCustomerLedgerEntry = typeof customerLedger.$inferInsert;
