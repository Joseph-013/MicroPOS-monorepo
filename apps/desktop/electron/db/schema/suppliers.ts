import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

/** Someone the store buys stock from. What is owed to them is worked out from their purchase orders and payments. */
export const suppliers = sqliteTable('suppliers', {
  id: id(),
  name: text().notNull(),
  phone: text(),
  note: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
