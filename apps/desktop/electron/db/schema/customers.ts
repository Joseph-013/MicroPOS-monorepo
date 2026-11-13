import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

/** A customer who can buy on credit (pay now, or part now, and settle the rest later). The balance lives in `customer_ledger`. */
export const customers = sqliteTable('customers', {
  id: id(),
  name: text().notNull(),
  phone: text(),
  note: text(),
  /** The most this customer may owe at once, in cents; null means no limit. */
  creditLimit: integer(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
