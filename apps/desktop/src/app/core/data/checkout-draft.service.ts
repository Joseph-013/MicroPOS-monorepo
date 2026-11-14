import { inject, Service } from '@angular/core';
import { type CheckoutDraft, type CompleteOrderInput, type CompleteOrderResult, type DraftLine, isDiscountSpec, PRODUCT_UNITS, type ProductUnit } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';

const SAVE_DELAY_MS = 300;

/**
 * Turns whatever came back from storage into a valid line, or null. Drafts saved before quantities became
 * decimals hold whole units in `quantity`; anything malformed is dropped so it can never reach the totals as NaN.
 */
export function normalizeDraftLine(raw: unknown): DraftLine | null {
  const l = raw as (Partial<DraftLine> & { quantity?: unknown }) | null;
  const quantityMilli = l?.quantityMilli ?? (typeof l?.quantity === 'number' ? l.quantity * 1000 : undefined);
  const valid =
    !!l &&
    typeof l.productId === 'string' &&
    typeof l.name === 'string' &&
    typeof quantityMilli === 'number' &&
    Number.isInteger(quantityMilli) &&
    quantityMilli > 0 &&
    typeof l.unitPrice === 'number' &&
    Number.isInteger(l.unitPrice) &&
    l.unitPrice >= 0;
  const unit = PRODUCT_UNITS.includes(l?.unit as ProductUnit) ? (l!.unit as ProductUnit) : 'each';
  return valid ? { productId: l.productId!, name: l.name!, quantityMilli: quantityMilli!, unitPrice: l.unitPrice!, unit, ...(isDiscountSpec(l.discount) ? { discount: { mode: l.discount.mode, value: l.discount.value } } : {}) } : null;
}

/**
 * Keeps the checkout order in progress saved in the local database.
 * `save` is debounced so quick taps on + / - become one write; `flush` writes immediately
 * (call it when the page goes away so the last change is never lost).
 */
@Service()
export class CheckoutDraftService {
  private readonly api = inject(DESKTOP_API);
  private pending: CheckoutDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The saved order (lines, discount, reason and note), or an empty one if there is no draft or it cannot be read. */
  async restore(): Promise<CheckoutDraft> {
    try {
      const saved = await this.api?.checkout.loadDraft();
      const lines = (saved?.lines ?? []).map(normalizeDraftLine).filter((l): l is DraftLine => l !== null);
      return {
        lines,
        ...(isDiscountSpec(saved?.orderDiscount) ? { orderDiscount: saved.orderDiscount } : {}),
        ...(typeof saved?.discountReason === 'string' && saved.discountReason ? { discountReason: saved.discountReason } : {}),
        ...(typeof saved?.note === 'string' && saved.note ? { note: saved.note } : {}),
      };
    } catch (error) {
      console.error('Failed to load the saved order', error);
      return { lines: [] };
    }
  }

  save(draft: CheckoutDraft): void {
    this.pending = draft;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    clearTimeout(this.timer);
    if (!this.pending) return;
    const draft = this.pending;
    this.pending = null;
    this.api?.checkout.saveDraft(draft).catch((error: unknown) => console.error('Failed to save the order', error));
  }

  /** Discards the saved draft right away (and any save still waiting). */
  clear(): void {
    clearTimeout(this.timer);
    this.pending = null;
    this.api?.checkout.clearDraft().catch((error: unknown) => console.error('Failed to clear the saved order', error));
  }

  /** The number the next order will get, or null when it cannot be read. */
  async nextOrderNumber(): Promise<string | null> {
    try {
      return (await this.api?.checkout.nextOrderNumber()) ?? null;
    } catch (error) {
      console.error('Failed to read the next order number', error);
      return null;
    }
  }

  /** Completes the order. A completed order also removes the saved draft (in the same transaction). */
  async completeOrder(input: CompleteOrderInput): Promise<CompleteOrderResult> {
    if (!this.api) return { ok: false, error: 'Not connected to the database', lines: [] };
    // Whatever is waiting to be saved is about to be obsolete: do not let it write the draft back afterwards.
    clearTimeout(this.timer);
    this.pending = null;
    try {
      return await this.api.checkout.completeOrder(input);
    } catch (error) {
      console.error('Could not complete the order', error);
      return { ok: false, error: 'Could not complete the order', lines: [] };
    }
  }
}
