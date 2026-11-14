import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { id } from './_columns';

/**
 * One count-to-count run of the cash drawer. Opened with the counted float, closed with the counted cash; at closing
 * the cash the records say it should hold (`expected_cash`) is fixed beside what was counted, so the difference stays
 * on record whatever is changed later. At most one session is open at a time (checked when opening).
 */
export const cashSessions = sqliteTable(
  'cash_sessions',
  {
    id: id(),
    openedAt: integer().notNull(),
    openedBy: text().references(() => employees.id, { onDelete: 'restrict' }),
    /** Cents counted into the drawer at the start. */
    openingFloat: integer().notNull(),
    /** Null while open. The closing fields below are all null or all set. */
    closedAt: integer(),
    closedBy: text().references(() => employees.id, { onDelete: 'restrict' }),
    countedCash: integer(),
    expectedCash: integer(),
    /** Counted less expected: negative is short, positive is over. */
    variance: integer(),
    note: text(),
  },
  (t) => [
    index('cash_sessions_opened_at_idx').on(t.openedAt),
    check('cash_sessions_float_non_negative', sql`${t.openingFloat} >= 0`),
    check(
      'cash_sessions_closing_complete',
      sql`(${t.closedAt} IS NULL AND ${t.countedCash} IS NULL AND ${t.expectedCash} IS NULL AND ${t.variance} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.countedCash} IS NOT NULL AND ${t.expectedCash} IS NOT NULL AND ${t.variance} IS NOT NULL AND ${t.countedCash} >= 0 AND ${t.variance} = ${t.countedCash} - ${t.expectedCash})`,
    ),
  ],
);

export type CashSession = typeof cashSessions.$inferSelect;
