import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

export const EMPLOYEE_ROLES = ['admin', 'manager', 'cashier'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const employees = sqliteTable(
  'employees',
  {
    id: id(),
    name: text().notNull(),
    /** Sign-in identifier; unique among live employees. */
    employeeNumber: text().notNull(),
    /** scrypt hash of the PIN (see electron/auth/pin.ts). Never store the PIN itself. */
    pinHash: text().notNull(),
    role: text({ enum: EMPLOYEE_ROLES }).notNull().default('cashier'),
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
