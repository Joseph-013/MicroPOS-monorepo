import { eq } from 'drizzle-orm';
import { isSessionTimeoutMinutes } from '@micropos/core';
import type { AppDatabase } from '../db';
import { settings } from '../db/schema';

const KEY = 'sessionTimeoutMinutes';

/** Minutes of inactivity that end a session, or null (the default) when they never do. */
export function getSessionTimeout(db: AppDatabase): number | null {
  const value = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get()?.value;
  return isSessionTimeoutMinutes(value) ? value : null;
}

/** Saves the limit (null: never); false when it is not a whole number of minutes in range. */
export function setSessionTimeout(db: AppDatabase, minutes: unknown, now = Date.now()): boolean {
  if (minutes !== null && !isSessionTimeoutMinutes(minutes)) return false;
  db.insert(settings).values({ key: KEY, value: minutes, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: minutes, updatedAt: now } }).run();
  return true;
}
