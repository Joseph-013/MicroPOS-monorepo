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

/** How an order is paid. */
export const ORDER_PAYMENT_METHODS = ['cash', 'card', 'other'] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** What the cashier sends to complete an order. Prices are what the screen showed: a changed price is refused, not silently charged. */
export interface CompleteOrderInput {
  lines: { productId: string; quantityMilli: number; unitPrice: Money }[];
  /** Order discount in cents. */
  discount: Money;
  payment: {
    method: OrderPaymentMethod;
    /** Cash only: money handed over, in cents; must cover the total. */
    tendered?: Money;
    /** Card slip or terminal reference, or a note for "other". */
    reference?: string;
  };
}

/** Why a line could not be sold. `price` and `unavailable` carry what to do about it. */
export interface OrderLineProblem {
  productId: string;
  kind: 'unavailable' | 'price' | 'stock';
  error: string;
  /** For `price`: the current price in cents (and name and unit) so the line can be refreshed. */
  current?: { name: string; unitPrice: Money; unit: ProductUnit };
}

export type CompleteOrderResult =
  | { ok: true; orderId: string; orderNumber: string; total: Money; change: Money }
  | { ok: false; error: string; lines: OrderLineProblem[] };
