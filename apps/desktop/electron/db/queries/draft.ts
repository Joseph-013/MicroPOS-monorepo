import { eq, inArray } from 'drizzle-orm';
import { type CheckoutDraft, type DraftLine, isDiscountSpec, MAX_DISCOUNT_REASON, MAX_ORDER_NOTE } from '@micropos/core';
import { sessionState } from '../../auth/context';
import type { AppDatabase } from '../index';
import { employees, PRODUCT_UNITS, type ProductUnit, settings } from '../schema';
import { claimedKey, draftOwner, ownedKey, splitOwnedKey } from './owned-drafts';

/** The checkout order in progress lives in the settings table, as JSON, under a key made from this one. */
export const DRAFT_KEY = 'checkout.draft';

/**
 * The checkout orders of one device: the till's own window (`checkout.draft`) or a paired phone
 * (`checkout.draft.<device id>`), so a phone and the till (or two phones) never share, overwrite or complete each other's
 * order. Each person has their own under it (`@<employee id>`, see `owned-drafts.ts`).
 */
export function deviceDraftKey(deviceId: string | null = sessionState().deviceId): string {
  return deviceId ? `${DRAFT_KEY}.${deviceId}` : DRAFT_KEY;
}

/** Where the signed-in person's order in progress on this device is kept. */
export function draftKey(deviceId: string | null = sessionState().deviceId, owner: string | null = draftOwner()): string {
  return ownedKey(deviceDraftKey(deviceId), owner);
}
const MAX_LINES = 500;

/** Thousandths of a unit, up to 99,999 units. */
const isQuantity = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 99_999_000;
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000_000_00;

/** Keeps only well-formed lines; anything else (corrupt or hand-edited data, a renderer bug) is dropped. */
export function sanitizeDraft(value: unknown): CheckoutDraft {
  const source = value as { lines?: unknown; orderDiscount?: unknown; discountReason?: unknown; note?: unknown } | null;
  const raw = source?.lines;
  if (!Array.isArray(raw)) return { lines: [] };
  const lines: DraftLine[] = [];
  for (const item of raw.slice(0, MAX_LINES)) {
    const l = item as (Partial<DraftLine> & { quantity?: unknown }) | null;
    // Drafts saved before quantities became decimals stored whole units in `quantity`.
    const quantityMilli = l?.quantityMilli ?? (typeof l?.quantity === 'number' ? l.quantity * 1000 : undefined);
    if (l && typeof l.productId === 'string' && typeof l.name === 'string' && isQuantity(quantityMilli) && isCents(l.unitPrice)) {
      // Drafts saved before units existed have none: they were all counted items.
      const unit = PRODUCT_UNITS.includes(l.unit as ProductUnit) ? (l.unit as ProductUnit) : 'each';
      lines.push({ productId: l.productId, name: l.name.slice(0, 200), quantityMilli, unitPrice: l.unitPrice, unit, ...(isDiscountSpec(l.discount) ? { discount: { mode: l.discount.mode, value: l.discount.value } } : {}) });
    }
  }
  const orderDiscount = isDiscountSpec(source?.orderDiscount) ? { mode: source.orderDiscount.mode, value: source.orderDiscount.value } : null;
  const discountReason = typeof source?.discountReason === 'string' ? source.discountReason.slice(0, MAX_DISCOUNT_REASON) : '';
  const note = typeof source?.note === 'string' ? source.note.slice(0, MAX_ORDER_NOTE) : '';
  return { lines, ...(orderDiscount ? { orderDiscount } : {}), ...(discountReason.trim() ? { discountReason } : {}), ...(note.trim() ? { note } : {}) };
}

export function loadDraft(db: AppDatabase): CheckoutDraft | null {
  const [row] = db.select().from(settings).where(eq(settings.key, claimedKey(db, deviceDraftKey()))).all();
  const draft = sanitizeDraft(row?.value);
  return draft.lines.length ? draft : null;
}

export function clearDraft(db: AppDatabase): void {
  db.delete(settings).where(eq(settings.key, claimedKey(db, deviceDraftKey()))).run();
}

/**
 * The names of the other people who have an order in progress on this device (the till, or this phone), by name, so
 * Checkout can say so: their orders wait for them to sign in again.
 */
export function othersInProgress(db: AppDatabase): string[] {
  const device = deviceDraftKey();
  const me = draftOwner();
  const owners = db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .all()
    .map((row) => ({ ...splitOwnedKey(row.key), value: row.value }))
    .filter((d) => d.plainKey === device && d.owner !== null && d.owner !== me && sanitizeDraft(d.value).lines.length > 0)
    .map((d) => d.owner!);
  if (!owners.length) return [];
  return db
    .select({ name: employees.name })
    .from(employees)
    .where(inArray(employees.id, owners))
    .orderBy(employees.name)
    .all()
    .map((e) => e.name);
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
    .values({ key: claimedKey(db, deviceDraftKey()), value: draft })
    .onConflictDoUpdate({ target: settings.key, set: { value: draft, updatedAt: Date.now() } })
    .run();
}
