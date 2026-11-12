// Pure business logic only: no Node, DOM, Electron or React Native imports.
// Money is integer minor units (cents) to avoid float errors.
export type Money = number;

export interface LineItem {
  sku: string;
  unitPrice: Money;
  qty: number;
}

export function subtotal(items: LineItem[]): Money {
  return items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
}

export { isPlu, isWeighed, PRODUCT_UNITS, type ProductUnit } from './catalog.js';
export type {
  CatalogCategory,
  CatalogProduct,
  ProductField,
  ProductInput,
  ProductRecord,
  RestoreProductsResult,
  SaveProductResult,
} from './catalog.js';
export { DESKTOP_API_VERSION, type DesktopApi } from './desktop-api.js';
export type { CheckoutDraft, DraftLine } from './draft.js';
export { formatQuantity, lineTotal, MAX_QUANTITY_DECIMALS, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from './quantity.js';
