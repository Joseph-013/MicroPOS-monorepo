import type { Money } from './index.js';

/** A discount as the cashier entered it: a fixed amount in cents, or a percent in basis points (1000 = 10%). */
export interface DiscountSpec {
  mode: 'amount' | 'percent';
  value: number;
}

export const MAX_DISCOUNT_REASON = 100;
export const MAX_ORDER_NOTE = 200;

export const isDiscountSpec = (v: unknown): v is DiscountSpec => {
  const s = v as DiscountSpec | null;
  return !!s && (s.mode === 'amount' || s.mode === 'percent') && Number.isInteger(s.value) && s.value > 0 && s.value <= (s.mode === 'percent' ? 10_000 : 100_000_000_00);
};

/** What a discount takes off `base` cents (never more than `base`, rounded to a whole cent). */
export function discountCents(spec: DiscountSpec | null | undefined, base: Money): Money {
  if (!spec || base <= 0) return 0;
  const cents = spec.mode === 'amount' ? spec.value : Math.round((base * spec.value) / 10_000);
  return Math.min(Math.max(cents, 0), base);
}

/**
 * Text typed in the discount field to a discount: "50" or "50.5" pesos, or "10" / "7.5" percent (up to 100%, two
 * decimals); null when it is not a positive amount.
 */
export function parseDiscount(text: string, mode: DiscountSpec['mode']): DiscountSpec | null {
  const clean = text.trim().replace(/%$/, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 100);
  const spec: DiscountSpec = { mode, value };
  return isDiscountSpec(spec) ? spec : null;
}

/** The text shown for a discount: "10%" or "50.00". */
export const formatDiscount = (spec: DiscountSpec): string => (spec.mode === 'percent' ? `${spec.value / 100}%` : (spec.value / 100).toFixed(2));
