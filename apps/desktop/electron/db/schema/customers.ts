import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { INTEREST_MODES } from '@micropos/core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

/** A customer who can buy on credit (pay now, or part now, and settle the rest later). The balance lives in `customer_ledger`. */
export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    name: text().notNull(),
    phone: text(),
    note: text(),
    /** The most this customer may owe at once, in cents; null means no limit. */
    creditLimit: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Optional interest on what they owe: per credit sale ('order') or on the whole balance ('total'); null for none. */
    interestMode: text({ enum: INTEREST_MODES }),
    /** Monthly rate in basis points (300 = 3%); set exactly when interestMode is. */
    interestRateBp: integer(),
    /** When interest was switched on; it is only charged from then. */
    interestStartedAt: integer(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('customers_interest_valid', sql`(${t.interestMode} IS NULL AND ${t.interestRateBp} IS NULL AND ${t.interestStartedAt} IS NULL) OR (${t.interestMode} IS NOT NULL AND ${t.interestRateBp} BETWEEN 1 AND 10000 AND ${t.interestStartedAt} IS NOT NULL)`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
