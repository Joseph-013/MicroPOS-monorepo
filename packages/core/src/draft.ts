import type { Money } from './index.js';

/** One line of the order being rung up. Name and price are copied from the product when added. */
export interface DraftLine {
  productId: string;
  name: string;
  /** Thousandths of a unit: 1000 = 1, 1250 = 1.25. */
  quantityMilli: number;
  /** Unit price in cents at the time it was added. */
  unitPrice: Money;
}

/** The checkout order in progress, saved automatically so it survives navigation and restarts. */
export interface CheckoutDraft {
  lines: DraftLine[];
}
