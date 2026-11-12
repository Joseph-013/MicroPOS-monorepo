import type { Money } from './index.js';

/** Quantities are integers in thousandths of a unit (1000 = 1, 1250 = 1.25 kg), like `order_lines.quantity_milli`. */
export const MILLI = 1000;

/** Most units a single line can hold, and decimals accepted when typing a quantity. */
export const MAX_QUANTITY_UNITS = 99_999;
export const MAX_QUANTITY_DECIMALS = 3;

/** Cents for `unitPrice` x `quantityMilli` thousandths, rounded to the nearest cent. */
export function lineTotal(unitPrice: Money, quantityMilli: number): Money {
  return Math.round((unitPrice * quantityMilli) / MILLI);
}

/**
 * Turns what a person typed ("3", "1.25", ".5") into thousandths, or null when it is not a positive amount
 * with at most 3 decimals and at most 99,999 units. Exact: no floating point involved.
 */
export function parseQuantityMilli(text: string): number | null {
  const match = /^(\d{0,5})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match || (match[1] === '' && match[2] === undefined)) return null;
  const whole = Number(match[1] || '0');
  const fraction = Number((match[2] ?? '').padEnd(MAX_QUANTITY_DECIMALS, '0'));
  const milli = whole * MILLI + fraction;
  return milli > 0 && whole <= MAX_QUANTITY_UNITS ? milli : null;
}

/** 1000 -> "1", 1250 -> "1.25", 500 -> "0.5". */
export function formatQuantity(quantityMilli: number): string {
  const whole = Math.trunc(quantityMilli / MILLI);
  const fraction = String(Math.abs(quantityMilli) % MILLI).padStart(MAX_QUANTITY_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
