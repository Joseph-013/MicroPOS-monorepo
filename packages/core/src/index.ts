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

export {
  type AdjustStockInput,
  type BatchRecord,
  EXPIRY_WARN_DAYS,
  type ExpiryState,
  type InventoryOverview,
  type MovementRecord,
  expiryState,
  PRODUCT_TRACKING,
  type ProductTracking,
  type ReceiveStockInput,
  type RepackageDraft,
  type RepackageField,
  type RepackageInput,
  type RepackageResult,
  type RepackageTarget,
  STOCK_ADJUSTMENTS,
  type StockAdjustmentType,
  type StockField,
  type StockResult,
  tracksBatches,
  tracksExpiry,
  tracksStock,
} from './inventory.js';
export { isPlu, isWeighed, PRODUCT_UNITS, type ProductUnit } from './catalog.js';
export type {
  CategoryField,
  CategoryInput,
  CategoryRecord,
  RestoreCategoriesResult,
  SaveCategoryResult,
  CatalogCategory,
  CatalogProduct,
  ProductField,
  ProductDraft,
  ProductInput,
  ProductRecord,
  RestoreProductsResult,
  SaveProductResult,
} from './catalog.js';
export { DESKTOP_API_VERSION, type DesktopApi } from './desktop-api.js';
export { ORDER_PAYMENT_METHODS } from './draft.js';
export type { CheckoutDraft, CompleteOrderInput, CompleteOrderResult, DraftLine, OrderLineProblem, OrderPaymentMethod, SalesOrderDetail, SalesOrderSummary } from './draft.js';
export { formatQuantity, lineTotal, MAX_QUANTITY_DECIMALS, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from './quantity.js';
export { gramsToQuantityMilli, isScaleBarcode, parseScaleBarcode, type ScaleLabel } from './scale-barcode.js';
