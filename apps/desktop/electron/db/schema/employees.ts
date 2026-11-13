import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { USER_ROLES, type Permission, type UserRole } from '@micropos/core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

export const EMPLOYEE_ROLES = USER_ROLES;
export type EmployeeRole = UserRole;

export const employees = sqliteTable(
  'employees',
  {
    id: id(),
    name: text().notNull(),
    /** Sign-in identifier; unique among live employees. */
    employeeNumber: text().notNull(),
    /** scrypt hash of the PIN (see electron/auth/pin.ts). Never store the PIN itself. */
    pinHash: text().notNull(),
    /** The preset the user started from (a label: what they may do is `permissions`). */
    role: text({ enum: EMPLOYEE_ROLES }).notNull().default('cashier'),
    /** What the user may do, switched on one by one. Null (rows from before permissions existed) means the role's preset. */
    permissions: text({ mode: 'json' }).$type<Permission[]>(),
    /** The PIN is a starting one (the first admin's, or set by someone else): it must be changed at the next sign-in. */
    pinChangeRequired: integer({ mode: 'boolean' }).notNull().default(false),
    active: integer({ mode: 'boolean' }).notNull().default(true),
    failedAttempts: integer().notNull().default(0),
    /** Epoch ms until which sign-in is locked, or null. */
    lockedUntil: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('employees_employee_number_unique')
      .on(t.employeeNumber)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
