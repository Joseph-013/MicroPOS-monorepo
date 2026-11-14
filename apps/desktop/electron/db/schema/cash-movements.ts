import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { cashSessions } from './cash-sessions';
import { employees } from './employees';
import { id } from './_columns';

/** Cash put into or taken out of the drawer by hand while a session is open (paid in, paid out, a drop to the safe). Append-only. */
export const cashMovements = sqliteTable(
  'cash_movements',
  {
    id: id(),
    sessionId: text()
      .notNull()
      .references(() => cashSessions.id, { onDelete: 'restrict' }),
    /** `in` adds to the drawer, `out` takes from it. */
    type: text({ enum: ['in', 'out'] as const }).notNull(),
    /** Cents; always positive. */
    amount: integer().notNull(),
    reason: text().notNull(),
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    at: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('cash_movements_session_id_idx').on(t.sessionId),
    index('cash_movements_at_idx').on(t.at),
    check('cash_movements_type_valid', sql`${t.type} IN ('in', 'out')`),
    check('cash_movements_amount_positive', sql`${t.amount} > 0`),
  ],
);

export type CashMovement = typeof cashMovements.$inferSelect;
