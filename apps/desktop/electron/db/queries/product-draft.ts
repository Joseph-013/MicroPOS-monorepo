import { eq } from 'drizzle-orm';
import type { ProductDraft } from '@micropos/core';
import type { AppDatabase } from '../index';
import { PRODUCT_TRACKING, PRODUCT_UNITS, type ProductTracking, type ProductUnit, settings } from '../schema';
import { claimedKey, deleteDraftForEveryone } from './owned-drafts';

/**
 * A half-filled product form is kept in the settings table so it survives closing the dialog, navigating away or
 * restarting the app: one draft per form and person, under `product.draft.new` (adding) or `product.draft.<product id>`
 * (editing), plus `@<employee id>` (see `owned-drafts.ts`).
 */
const PREFIX = 'product.draft.';
const MAX_CATEGORIES = 100;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** The settings key for a form, or null for a malformed form key. */
function keyFor(form: unknown): string | null {
  return typeof form === 'string' && form.length > 0 && form.length <= 64 ? PREFIX + form : null;
}

/** Keeps only well-formed fields; anything else (corrupt data, a renderer bug) falls back to empty. */
export function sanitizeProductDraft(value: unknown): ProductDraft {
  const v = (value ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(v['categoryIds']) ? v['categoryIds'].filter((id): id is string => typeof id === 'string') : [];
  return {
    name: text(v['name'], 200),
    unit: PRODUCT_UNITS.includes(v['unit'] as ProductUnit) ? (v['unit'] as ProductUnit) : 'each',
    tracking: PRODUCT_TRACKING.includes(v['tracking'] as ProductTracking) ? (v['tracking'] as ProductTracking) : 'none',
    shelfLifeDays: text(v['shelfLifeDays'], 5),
    criticalLevel: text(v['criticalLevel'], 12),
    sku: text(v['sku'], 64),
    barcode: text(v['barcode'], 64),
    price: text(v['price'], 20),
    cost: text(v['cost'], 20),
    active: v['active'] !== false,
    categoryIds: [...new Set(ids)].slice(0, MAX_CATEGORIES),
  };
}

export function loadProductDraft(db: AppDatabase, form: unknown): ProductDraft | null {
  const plain = keyFor(form);
  if (!plain) return null;
  const key = claimedKey(db, plain);
  const [row] = db.select().from(settings).where(eq(settings.key, key)).all();
  return row ? sanitizeProductDraft(row.value) : null;
}

export function saveProductDraft(db: AppDatabase, form: unknown, draft: unknown): void {
  const plain = keyFor(form);
  if (!plain) return;
  const key = claimedKey(db, plain);
  const value = sanitizeProductDraft(draft);
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
    .run();
}

export function clearProductDraft(db: AppDatabase, form: unknown): void {
  const plain = keyFor(form);
  if (plain) db.delete(settings).where(eq(settings.key, claimedKey(db, plain))).run();
}

/** A deleted product cannot be edited, so nobody's draft of its form is any use any more. */
export function clearProductDraftsForEveryone(db: AppDatabase, productId: string): void {
  deleteDraftForEveryone(db, PREFIX + productId);
}
