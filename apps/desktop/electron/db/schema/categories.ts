import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, updatedAt } from './_columns';

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('categories_name_unique')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
