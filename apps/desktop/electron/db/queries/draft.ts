import { eq } from 'drizzle-orm';
import type { CheckoutDraft, DraftLine } from '@micropos/core';
import type { AppDatabase } from '../index';
import { settings } from '../schema';

/**
 * The checkout draft lives in the settings table under one key (one in-progress order per register).
 * Once employees sign in this should become an `open` order per employee instead.
 */
export const DRAFT_KEY = 'checkout.draft';
const MAX_LINES = 500;

/** Thousandths of a unit, up to 99,999 units. */
const isQuantity = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 99_999_000;
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000_000_00;

/** Keeps only well-formed lines; anything else (corrupt or hand-edited data, a renderer bug) is dropped. */
export function sanitizeDraft(value: unknown): CheckoutDraft {
  const raw = (value as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(raw)) return { lines: [] };
  const lines: DraftLine[] = [];
  for (const item of raw.slice(0, MAX_LINES)) {
    const l = item as (Partial<DraftLine> & { quantity?: unknown }) | null;
    // Drafts saved before quantities became decimals stored whole units in `quantity`.
    const quantityMilli = l?.quantityMilli ?? (typeof l?.quantity === 'number' ? l.quantity * 1000 : undefined);
    if (l && typeof l.productId === 'string' && typeof l.name === 'string' && isQuantity(quantityMilli) && isCents(l.unitPrice)) {
      lines.push({ productId: l.productId, name: l.name.slice(0, 200), quantityMilli, unitPrice: l.unitPrice });
    }
  }
  return { lines };
}

export function loadDraft(db: AppDatabase): CheckoutDraft | null {
  const [row] = db.select().from(settings).where(eq(settings.key, DRAFT_KEY)).all();
  const draft = sanitizeDraft(row?.value);
  return draft.lines.length ? draft : null;
}

export function clearDraft(db: AppDatabase): void {
  db.delete(settings).where(eq(settings.key, DRAFT_KEY)).run();
}

/** Saves the draft (an empty one removes it). */
export function saveDraft(db: AppDatabase, input: unknown): void {
  const draft = sanitizeDraft(input);
  const sent = (input as { lines?: unknown[] } | null)?.lines;
  if (Array.isArray(sent) && sent.length > draft.lines.length) {
    // Never lose lines silently: this means the renderer and this process disagree about the format.
    console.warn(`[draft] dropped ${sent.length - draft.lines.length} of ${sent.length} line(s) that failed validation`);
  }
  if (!draft.lines.length) return clearDraft(db);
  db.insert(settings)
    .values({ key: DRAFT_KEY, value: draft })
    .onConflictDoUpdate({ target: settings.key, set: { value: draft, updatedAt: Date.now() } })
    .run();
}
