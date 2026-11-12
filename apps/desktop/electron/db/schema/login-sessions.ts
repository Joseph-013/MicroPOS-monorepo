import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { id } from './_columns';

/** One row per system sign-in; `loggedOutAt` stays null while the session is active. */
export const loginSessions = sqliteTable(
  'login_sessions',
  {
    id: id(),
    employeeId: text()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    loggedInAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    loggedOutAt: integer(),
  },
  (t) => [index('login_sessions_employee_id_idx').on(t.employeeId, t.loggedInAt)],
);

export type LoginSession = typeof loginSessions.$inferSelect;
export type NewLoginSession = typeof loginSessions.$inferInsert;
