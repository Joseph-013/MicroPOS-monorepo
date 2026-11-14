import { eq } from 'drizzle-orm';
import { isColumnKeys, isTableId, type TableColumnOrders } from '@micropos/core';
import type { AppDatabase } from './db';
import { settings } from './db/schema';

const KEY = 'tableColumns';

/** The saved column order of every page table (an admin's choice for the whole till). */
export function getColumnOrders(db: AppDatabase): TableColumnOrders {
  const value = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get()?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, keys]) => isTableId(id) && isColumnKeys(keys))) as TableColumnOrders;
}

/** Saves one table's column order; false when the table id or the keys are not valid. */
export function saveColumnOrder(db: AppDatabase, tableId: unknown, keys: unknown, now = Date.now()): boolean {
  if (!isTableId(tableId) || !isColumnKeys(keys)) return false;
  const value = { ...getColumnOrders(db), [tableId]: keys };
  db.insert(settings).values({ key: KEY, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  return true;
}
