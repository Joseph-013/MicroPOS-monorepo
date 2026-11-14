import type { OrderPaymentMethod } from './draft.js';
import type { Money } from './index.js';

/** One payment method's total over the report's days: refunds and voids are taken off. */
export interface MethodTotal {
  method: OrderPaymentMethod;
  amount: Money;
}

/** What was sold, grouped by item name: quantity (thousandths) and money. */
export interface ItemSold {
  name: string;
  unit: string | null;
  quantityMilli: number;
  total: Money;
}

/** The sales summary for whole local days, `from` to `to` inclusive (`YYYY-MM-DD`). */
export interface SalesReport {
  from: string;
  to: string;
  /** Sales rung up in the period, not voided: how many, before discounts, discounts, and what was charged. */
  sales: { count: number; gross: Money; discounts: Money; net: Money };
  /** Orders voided in the period (whenever they were sold). */
  voids: { count: number; total: Money };
  /** Refund orders made in the period: the amount is negative. */
  refunds: { count: number; total: Money };
  /** Net sales less refunds. */
  netAfterRefunds: Money;
  /** Money taken by payment method (refunds and voids taken off). */
  byMethod: MethodTotal[];
  /** Sales left on customers' accounts in the period, the interest charged, and what customers paid back, by method. */
  credit: { given: Money; interest: Money; paymentsReceived: MethodTotal[] };
  items: ItemSold[];
}

export const PAYMENT_METHOD_ORDER: readonly OrderPaymentMethod[] = ['cash', 'card', 'ewallet', 'bank_transfer', 'other'];

/** `YYYY-MM-DD` of a time in local time. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Start (inclusive) and end (exclusive) in epoch ms of the local days `from` to `to` inclusive, or null when either is not a real date or `to` is before `from`. */
export function dayRange(from: string, to: string = from): { from: number; to: number } | null {
  const parse = (text: string): [number, number, number] | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return null;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? [y, m, d] : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return null;
  const start = new Date(a[0], a[1] - 1, a[2]).getTime();
  // The next midnight, not +24 h: a day with a clock change is 23 or 25 hours long.
  const end = new Date(b[0], b[1] - 1, b[2] + 1).getTime();
  return end > start ? { from: start, to: end } : null;
}
