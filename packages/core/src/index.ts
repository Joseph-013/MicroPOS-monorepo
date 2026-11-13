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
export type {
  CustomerAccount,
  CustomerField,
  CustomerInput,
  CustomerLedgerType,
  CustomerRecord,
  LedgerEntryRecord,
  ReceivePaymentInput,
  ReceivePaymentResult,
  RemoveCustomersResult,
  SaveCustomerResult,
} from './customers.js';
export { CUSTOMER_LEDGER_TYPES } from './customers.js';
export type {
  CancelPurchaseResult,
  PayPurchaseInput,
  PayPurchaseResult,
  PurchaseDetail,
  PurchaseField,
  PurchaseInput,
  PurchaseLineInput,
  PurchaseLineRecord,
  PurchasePaymentRecord,
  PurchaseStatus,
  PurchaseSummary,
  ReceiveLineInput,
  ReceivePurchaseInput,
  ReceivePurchaseResult,
  RemoveSuppliersResult,
  SavePurchaseResult,
  SaveSupplierResult,
  SupplierField,
  SupplierInput,
  SupplierRecord,
} from './purchasing.js';
export { PURCHASE_STATUSES } from './purchasing.js';
export type { CustomerDisplayLine, CustomerDisplayMode, CustomerDisplayReceipt, CustomerDisplayState } from './customer-display.js';
export { CUSTOMER_DISPLAY_MODES, IDLE_DISPLAY_STATE } from './customer-display.js';
export { DESKTOP_API_VERSION, type DesktopApi } from './desktop-api.js';
export { canReverseOrder, ORDER_PAYMENT_METHODS } from './draft.js';
export type { CheckoutDraft, CompleteOrderInput, CompleteOrderResult, DraftLine, OrderLineProblem, OrderPaymentMethod, OrderActionInput, OrderActionResult, SalesOrderDetail, SalesOrderSummary } from './draft.js';
export { formatQuantity, lineTotal, MAX_QUANTITY_DECIMALS, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from './quantity.js';
export { gramsToQuantityMilli, isScaleBarcode, parseScaleBarcode, type ScaleLabel } from './scale-barcode.js';

export {
  ALL_PERMISSIONS,
  type ChangePinInput,
  type ChangePinResult,
  isPermission,
  isValidPin,
  matchingRole,
  MAX_FAILED_SIGN_INS,
  normalizePermissions,
  PAGE_PERMISSIONS,
  type Permission,
  type PermissionInfo,
  PERMISSIONS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  PIN_RULE,
  type ResetPinResult,
  ROLE_LABELS,
  ROLE_PRESETS,
  type SaveUserResult,
  type SessionUser,
  SIGN_IN_PAUSE_MS,
  type SignInChoice,
  type SignInLogEntry,
  type SignInResult,
  USER_ROLES,
  type UserField,
  type UserInput,
  type UserRecord,
  type UserRole,
  validateUserInput,
} from './auth.js';
