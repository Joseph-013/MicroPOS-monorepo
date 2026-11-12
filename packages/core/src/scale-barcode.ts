import type { ProductUnit } from './catalog.js';

/**
 * Variable-weight ("scale") labels: an EAN-13 with the in-store prefix 2 that carries a product code and a weight.
 * Layout used here: `2 PPPPP 0 WWWWW C` = prefix, 5-digit PLU, a spare 0, weight in grams (5 digits), check digit.
 * Stores differ (some put the price instead of the weight); a store-level layout setting is the way to support
 * others, and is not built.
 */
export interface ScaleLabel {
  /** The PLU as the product stores it: leading zeros dropped (04011 -> "4011"). */
  plu: string;
  grams: number;
}

function checkDigitOk(code: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

/** True for a scale label: 13 digits starting with 2. */
export const isScaleBarcode = (code: string): boolean => /^2\d{12}$/.test(code);

/** Reads a scale label, or returns null when it is not one, its check digit is wrong, or it carries no weight. */
export function parseScaleBarcode(code: string): ScaleLabel | null {
  if (!isScaleBarcode(code) || !checkDigitOk(code)) return null;
  const grams = Number(code.slice(7, 12));
  return grams > 0 ? { plu: String(Number(code.slice(1, 6))), grams } : null;
}

const GRAMS_PER: Record<ProductUnit, number> = { each: 0, kg: 1000, g: 1, lb: 453.59237, oz: 28.349523125 };

/**
 * A weight in grams as a quantity of the product's unit, in thousandths (the label's weight in kg is 1000 per kg,
 * so 8170 g = 8170 thousandths of a kg). Null for counted products: a weight means nothing for them.
 */
export function gramsToQuantityMilli(grams: number, unit: ProductUnit): number | null {
  const per = GRAMS_PER[unit];
  return per ? Math.max(1, Math.round((grams / per) * 1000)) : null;
}
