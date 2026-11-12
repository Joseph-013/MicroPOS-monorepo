import { inject, Service } from '@angular/core';
import type { DraftLine } from '@micropos/core';
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
  return valid ? { productId: l.productId!, name: l.name!, quantityMilli: quantityMilli!, unitPrice: l.unitPrice! } : null;
}

/**
 * Keeps the checkout order in progress saved in the local database.
 * `save` is debounced so quick taps on + / - become one write; `flush` writes immediately
 * (call it when the page goes away so the last change is never lost).
 */
@Service()
export class CheckoutDraftService {
  private readonly api = inject(DESKTOP_API);
  private pending: DraftLine[] | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The saved lines, or none if there is no draft or it cannot be read. */
  async restore(): Promise<DraftLine[]> {
    try {
      const saved = (await this.api?.checkout.loadDraft())?.lines ?? [];
      return saved.map(normalizeDraftLine).filter((l): l is DraftLine => l !== null);
    } catch (error) {
      console.error('Failed to load the saved order', error);
      return [];
    }
  }

  save(lines: DraftLine[]): void {
    this.pending = lines;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    clearTimeout(this.timer);
    if (!this.pending) return;
    const lines = this.pending;
    this.pending = null;
    this.api?.checkout.saveDraft({ lines }).catch((error: unknown) => console.error('Failed to save the order', error));
  }

  /** Discards the saved draft right away (and any save still waiting). */
  clear(): void {
    clearTimeout(this.timer);
    this.pending = null;
    this.api?.checkout.clearDraft().catch((error: unknown) => console.error('Failed to clear the saved order', error));
  }
}
