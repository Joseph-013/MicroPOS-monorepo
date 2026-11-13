import { eq } from 'drizzle-orm';
import type { AppDatabase } from './db';
import { settings } from './db/schema';

const KEY = 'closeToTray';

/** Whether closing the window hides it and keeps the app running in the tray (off unless an admin turned it on). */
export function getCloseToTray(db: AppDatabase): boolean {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
  return row?.value === true;
}

const listeners = new Set<(value: boolean) => void>();
/** Listens for the setting changing (the main process adds or removes the tray icon). Returns a function that stops. */
export function onCloseToTrayChanged(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Saves the setting and tells the listeners; false when `value` is not a boolean. */
export function setCloseToTray(db: AppDatabase, value: unknown, now = Date.now()): boolean {
  if (typeof value !== 'boolean') return false;
  db.insert(settings).values({ key: KEY, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  for (const listener of [...listeners]) listener(value);
  return true;
}
