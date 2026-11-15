import { inject, Service, signal } from '@angular/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { firstValueFrom } from 'rxjs';
import { CheckoutDraftService } from './data/checkout-draft.service';
import { CheckoutCopyConfirm, type CopyChoice, type CopyConfirmContext } from './checkout-copy-confirm';
import { Router } from '@angular/router';
import type { SalesOrderDetail } from '@micropos/core';

/** What is carried to Checkout from a recorded sale: the product and how much of it (names and prices are read again from the catalog). */
export interface CopiedLine {
  productId: string;
  name: string;
  quantityMilli: number;
  /** What the sale charged per unit, to tell the cashier when the price is different now. */
  unitPrice: number;
}

export interface CopiedOrder {
  orderNumber: string;
  /** Add to the order in progress, or start the order over with these items. */
  mode: CopyChoice;
  lines: CopiedLine[];
}

/**
 * Copies the items of a recorded sale into the order in progress at Checkout (a customer buying the same again). The sale
 * dialog hands the lines over with `copy()` and goes to Checkout, which takes them (`take()`) once its catalog and saved
 * order are loaded, so they are added to whatever is already on the order, never replacing it. Not copied: discounts,
 * the customer, the note and payments (they belong to that sale), lines whose product is gone, and refund orders.
 */
@Service()
export class CheckoutCopy {
  private readonly router = inject(Router);
  private readonly dialogs = inject(HlmDialogService);
  private readonly draft = inject(CheckoutDraftService);
  /** Waiting for Checkout to take it. */
  readonly pending = signal<CopiedOrder | null>(null);

  canCopy(order: Pick<SalesOrderDetail, 'refundOf'>): boolean {
    return !order.refundOf;
  }

  /**
   * Hands the sale's items to Checkout and goes there. When Checkout already has an order in progress (the saved draft, after
   * any change still waiting to be saved), asks first whether to add to it or replace it. Returns false when cancelled.
   */
  async copy(order: SalesOrderDetail): Promise<boolean> {
    const lines = order.lines
      .filter((l) => l.productId && l.quantityMilli > 0)
      .map((l) => ({ productId: l.productId!, name: l.name, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice }));
    this.draft.flush();
    const existing = (await this.draft.restore()).lines.length;
    let mode: CopyChoice = 'add';
    if (existing) {
      const ref = this.dialogs.open<CopyChoice, CopyConfirmContext>(CheckoutCopyConfirm, {
        id: 'checkout-copy-confirm',
        contentClass: 'w-[min(28rem,95vw)] max-w-none sm:max-w-none',
        context: { existingItems: existing, orderNumber: order.orderNumber },
      });
      const choice = await firstValueFrom(ref.closed$);
      if (!choice) return false;
      mode = choice;
    }
    this.pending.set({ orderNumber: order.orderNumber, mode, lines });
    await this.router.navigateByUrl('/checkout');
    return true;
  }

  /** Checkout calls this once; the lines are handed over and forgotten. */
  take(): CopiedOrder | null {
    const copied = this.pending();
    this.pending.set(null);
    return copied;
  }
}
