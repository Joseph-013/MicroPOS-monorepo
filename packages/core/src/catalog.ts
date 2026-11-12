import type { Money } from './index.js';

/** A sellable item as shown to cashiers (read-only view of the products table). */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  plu: string | null;
  /** Every category the product belongs to (possibly none), sorted by name. */
  categories: CatalogCategory[];
  /** Unit price in cents. */
  price: Money;
}

export interface CatalogCategory {
  id: string;
  name: string;
}
