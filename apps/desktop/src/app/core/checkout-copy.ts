import { inject, Service, signal } from '@angular/core';
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
  /** Waiting for Checkout to take it. */
  readonly pending = signal<CopiedOrder | null>(null);

  canCopy(order: Pick<SalesOrderDetail, 'refundOf'>): boolean {
    return !order.refundOf;
  }

  async copy(order: SalesOrderDetail): Promise<void> {
    const lines = order.lines
      .filter((l) => l.productId && l.quantityMilli > 0)
      .map((l) => ({ productId: l.productId!, name: l.name, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice }));
    this.pending.set({ orderNumber: order.orderNumber, lines });
    await this.router.navigateByUrl('/checkout');
  }

  /** Checkout calls this once; the lines are handed over and forgotten. */
  take(): CopiedOrder | null {
    const copied = this.pending();
    this.pending.set(null);
    return copied;
  }
}
