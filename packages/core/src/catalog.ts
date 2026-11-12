import type { Money } from './index.js';

/** How a product is sold: counted (`each`) or weighed (the price is per kg, g, lb or oz). */
export const PRODUCT_UNITS = ['each', 'kg', 'g', 'lb', 'oz'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** True for products sold by weight: they take a decimal quantity and need a code (a PLU) in `barcode`. */
export const isWeighed = (unit: ProductUnit): boolean => unit !== 'each';

/**
 * Barcode and PLU share one field. A PLU is a short numeric code (4 or 5 digits, like 4011); anything else
 * (EAN-8, UPC-A, EAN-13, ...) is a barcode. Used to show them differently.
 */
export const isPlu = (code: string | null): boolean => !!code && /^\d{4,5}$/.test(code);

/** A sellable item as shown to cashiers (read-only view of the products table). */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  /** Barcode, or a short PLU for loose goods: one field, matched exactly when scanned or keyed. */
  barcode: string | null;
  /** Every category the product belongs to (possibly none), sorted by name. */
  categories: CatalogCategory[];
  /** Price in cents per `unit`. */
  price: Money;
  unit: ProductUnit;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

/** A product as managed on the Products page: every live product, including inactive ones, with cost. */
export interface ProductRecord extends Omit<CatalogProduct, 'price'> {
  price: Money;
  /** Unit cost in cents (per `unit`), or null when not tracked. */
  cost: Money | null;
  /** Inactive products stay on file but are not offered at checkout. */
  active: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds when it was deleted, or null while it is in the catalog. */
  deletedAt: number | null;
}

/** What the Products form sends. Empty codes are null; money is integer cents. */
export interface ProductInput {
  name: string;
  unit: ProductUnit;
  sku: string | null;
  barcode: string | null;
  price: Money;
  cost: Money | null;
  active: boolean;
  categoryIds: string[];
}

export type ProductField = 'name' | 'unit' | 'sku' | 'barcode' | 'price' | 'cost';

/** Outcome of restoring deleted products. Ones whose SKU or barcode a live product now uses are skipped. */
export interface RestoreProductsResult {
  restored: number;
  /** Names of the products that could not be restored because their code is in use. */
  conflicts: string[];
}

/** Result of creating or updating a product: a rule violation comes back as data, not a thrown error. */
export type SaveProductResult =
  | { ok: true; product: ProductRecord }
  | { ok: false; field: ProductField | null; error: string };
