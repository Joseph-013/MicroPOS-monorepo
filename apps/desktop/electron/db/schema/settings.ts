import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { updatedAt } from './_columns';

/** Key-value store for store-level settings (name, receipt text...). Values are JSON. */
export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).$type<unknown>(),
  updatedAt: updatedAt(),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
