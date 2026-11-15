import { eq } from 'drizzle-orm';
import { WINDOW_MODES, type WindowMode } from '@micropos/core';
import type { AppDatabase } from './db';
import { settings } from './db/schema';

const KEY = 'windowMode';

/** How the till's window opens at start: windowed unless an admin chose maximized or full screen. */
export function getWindowMode(db: AppDatabase): WindowMode {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
  return WINDOW_MODES.find((mode) => mode === row?.value) ?? 'windowed';
}

/** Saves the choice (used at the next start); false when `value` is not one of the modes. */
export function setWindowMode(db: AppDatabase, value: unknown, now = Date.now()): boolean {
  if (!WINDOW_MODES.some((mode) => mode === value)) return false;
  db.insert(settings).values({ key: KEY, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  return true;
}
