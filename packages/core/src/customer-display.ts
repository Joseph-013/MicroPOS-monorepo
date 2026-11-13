import type { Money } from './index.js';

/** One line of the order as the customer sees it. */
export interface CustomerDisplayLine {
  name: string;
  /** `each` or a weight unit; the quantity is in thousandths of it. */
  unit: string;
  quantityMilli: number;
  /** Cents per unit. */
  unitPrice: Money;
  /** Cents for the line. */
  total: Money;
}

/** What a sale that has just been completed shows. */
export interface CustomerDisplayReceipt {
  orderNumber: string;
  total: Money;
  /** Cash handed back; 0 when none. */
  change: Money;
  /** The part put on the customer's account; 0 when none. */
  onAccount: Money;
}

/**
 * What the customer-facing screen shows: nothing yet (a welcome), the order as it is rung up, or a thank-you once it
 * is paid. The checkout page publishes it; the display window only renders it.
 */
export interface CustomerDisplayState {
  phase: 'idle' | 'shopping' | 'paid';
  /** In the order they were added. */
  lines: CustomerDisplayLine[];
  total: Money;
  /** Index in `lines` of the line added or changed last, which both screens keep highlighted and scrolled into view; null when none. */
  highlight: number | null;
  /** Set when `phase` is `paid`. */
  receipt: CustomerDisplayReceipt | null;
}

export const IDLE_DISPLAY_STATE: CustomerDisplayState = { phase: 'idle', lines: [], total: 0, highlight: null, receipt: null };
