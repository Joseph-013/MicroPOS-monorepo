import { eq } from 'drizzle-orm';
import type { RepackageDraft } from '@micropos/core';
import type { AppDatabase } from '../index';
import { settings } from '../schema';

/** A half-filled Repackage form lives in the settings table (one draft) so it survives closing and restarts. */
const KEY = 'repackage.draft';
const MAX_TARGETS = 10;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const id = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null);

/** Keeps only well-formed fields; anything else (corrupt data, a renderer bug) falls back to empty. */
export function sanitizeRepackageDraft(value: unknown): RepackageDraft {
  const v = (value ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(v['targets']) ? v['targets'].slice(0, MAX_TARGETS) : [];
  const targets = rows.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return { productId: id(r['productId']), quantity: text(r['quantity'], 20), expiry: text(r['expiry'], 10) };
  });
  return {
    productId: id(v['productId']),
    quantity: text(v['quantity'], 20),
    targets: targets.length ? targets : [{ productId: null, quantity: '', expiry: '' }],
    note: text(v['note'], 200),
  };
}

export function loadRepackageDraft(db: AppDatabase): RepackageDraft | null {
  const [row] = db.select().from(settings).where(eq(settings.key, KEY)).all();
  return row ? sanitizeRepackageDraft(row.value) : null;
}

export function saveRepackageDraft(db: AppDatabase, draft: unknown): void {
  const value = sanitizeRepackageDraft(draft);
  db.insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
    .run();
}

export function clearRepackageDraft(db: AppDatabase): void {
  db.delete(settings).where(eq(settings.key, KEY)).run();
}
