import type { ProductUnit } from './catalog.js';
import type { DiscountSpec } from './discount.js';
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
  /** A discount on this line, as entered (an amount or a percent of the line). Saved with the draft. */
  discount?: DiscountSpec;
}

/** The checkout order in progress, saved automatically so it survives navigation and restarts. */
export interface CheckoutDraft {
  lines: DraftLine[];
  /** The discount on the whole order as entered, why a discount was given, and the sale note (each only when set). */
  orderDiscount?: DiscountSpec;
  discountReason?: string;
  note?: string;
}

/** How an order is paid. */
export const ORDER_PAYMENT_METHODS = ['cash', 'card', 'ewallet', 'bank_transfer', 'other'] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** What the cashier sends to complete an order. Prices are what the screen showed: a changed price is refused, not silently charged. */
export interface CompleteOrderInput {
  /** `discount` is the cents taken off this line (at most its price times quantity). */
  lines: { productId: string; quantityMilli: number; unitPrice: Money; discount?: Money }[];
  /** Order discount in cents, on top of the line discounts (at most what is left after them). */
  discount: Money;
  /** Why a discount was given (optional, at most `MAX_DISCOUNT_REASON` characters). */
  discountReason?: string;
  /** A remark on the sale (optional, at most `MAX_ORDER_NOTE` characters). */
  note?: string;
  /** A credit sale: the customer whose account takes whatever part of the total is not paid now. */
  customerId?: string;
  /** Cents paid now (cash handed over is `tendered`, which may be more). Defaults to the whole total; less than the total needs a `customerId`. */
  amountPaid?: Money;
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
  | { ok: true; orderId: string; orderNumber: string; total: Money; change: Money; /** The part put on the customer's account. */ onAccount: Money }
  | { ok: false; error: string; lines: OrderLineProblem[] };

/** A recorded sales order as shown when viewing it. */
export interface SalesOrderDetail {
  id: string;
  orderNumber: string;
  status: 'open' | 'completed' | 'voided' | 'refunded';
  /** Who rang it up. */
  employeeName: string;
  subtotal: Money;
  /** Line discounts and the order discount together. */
  discountTotal: Money;
  total: Money;
  /** Why a discount was given, and a remark on the sale. */
  discountReason: string | null;
  note: string | null;
  createdAt: number;
  completedAt: number | null;
  lines: { id: string; /** Null when the product was removed for good. */ productId: string | null; name: string; unitPrice: Money; quantityMilli: number; lineTotal: Money; /** Cents taken off this line (lineTotal stays the price times quantity). Negative on a refund. */ discount: Money; unit: ProductUnit | null }[];
  /** The customer a credit sale is on account for. */
  customer: { id: string; name: string } | null;
  /** Cents of this order that went on the customer's account (negative on a refund order). */
  onAccount: Money;
  /** On a refund order: the sale it reverses. */
  refundOf: { id: string; orderNumber: string } | null;
  /** On a refunded sale: the refund order that reversed it. */
  refundedBy: { id: string; orderNumber: string } | null;
  payments: { method: OrderPaymentMethod; amount: Money; tendered: Money | null; change: Money | null; reference: string | null }[];
}

/** One row of the Sales Orders list. */
export interface SalesOrderSummary {
  id: string;
  orderNumber: string;
  status: SalesOrderDetail['status'];
  employeeName: string;
  total: Money;
  createdAt: number;
  customerName: string | null;
  /** Cents on the customer's account (negative on a refund order). */
  onAccount: Money;
  /** A refund order: negative amounts, reverses another order. */
  isRefund: boolean;
  /** Number of lines. */
  itemCount: number;
  /** Payment methods used, in order ("cash", or "cash, card" for a split). */
  methods: OrderPaymentMethod[];
}

/** Voiding or refunding a recorded order. A reason is required and goes in the audit log. */
export interface OrderActionInput {
  orderId: string;
  reason: string;
}

export type OrderActionResult =
  | { ok: true; orderId: string; orderNumber: string; /** A refund creates a new order; its id and number. */ refundOrderId?: string; refundOrderNumber?: string }
  | { ok: false; error: string };

/** Only a completed sale can be voided or refunded: not one already voided or refunded, and not a refund order. */
export const canReverseOrder = (order: { status: SalesOrderDetail['status']; isRefund: boolean }): boolean =>
  order.status === 'completed' && !order.isRefund;
