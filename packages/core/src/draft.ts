import type { ProductUnit } from './catalog.js';
import type { Money } from './index.js';

/** One line of the order being rung up. Name and price are copied from the product when added. */
export interface DraftLine {
  productId: string;
  name: string;
  /** Thousandths of a unit: 1000 = 1, 1250 = 1.25. */
  quantityMilli: number;
  /** Price in cents per `unit` at the time it was added. */
  unitPrice: Money;
  /** How the product is sold; weighed lines show their unit next to the quantity. Drafts saved before units existed read as `each`. */
  unit: ProductUnit;
}

/** The checkout order in progress, saved automatically so it survives navigation and restarts. */
export interface CheckoutDraft {
  lines: DraftLine[];
}
