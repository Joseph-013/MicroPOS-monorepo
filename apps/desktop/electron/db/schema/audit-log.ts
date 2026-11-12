import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { id } from './_columns';

/** Append-only record of sensitive actions (voids, refunds, price overrides, employee changes). */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    /** Null for system-initiated actions. */
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    /** Dotted action name, e.g. `order.void`, `price.override`. */
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    detail: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    at: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('audit_log_employee_id_idx').on(t.employeeId),
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_at_idx').on(t.at),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
