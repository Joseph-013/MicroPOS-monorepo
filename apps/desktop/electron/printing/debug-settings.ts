import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { settings } from '../db/schema';

const KEY = 'printerDebugSaveImages';

/** Whether receipts are saved as images instead of printed (off unless an admin turned it on). */
export function getSaveReceiptImages(db: AppDatabase): boolean {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get()?.value === true;
}

/** Saves the choice; false when `value` is not a boolean. */
export function setSaveReceiptImages(db: AppDatabase, value: unknown, now = Date.now()): boolean {
  if (typeof value !== 'boolean') return false;
  db.insert(settings).values({ key: KEY, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  return true;
}
