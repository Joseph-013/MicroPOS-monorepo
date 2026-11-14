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
export {
  DATA_DOMAINS,
  purchaseConcern,
  purchaseConcernDueAt,
  type DataDomain,
  STOCK_CONCERN_KINDS,
  STOCK_CONCERN_LABELS,
  type PurchaseConcern,
  type StockConcern,
  type StockConcernKind,
} from './concerns.js';
export {
  creditAlert,
  creditAlertDueAt,
  DEFAULT_CREDIT_ALERTS,
  isAlertAmount,
  isAlertDays,
  MAX_ALERT_AMOUNT,
  MAX_ALERT_DAYS,
  type CreditAlertSettings,
  type CustomerAlert,
} from './credit-alerts.js';
export {
  addMonths,
  balanceAt,
  DEFAULT_INTEREST_DEFAULTS,
  FIRST_PERIOD_DAYS,
  formatRate,
  INTEREST_MODE_LABELS,
  INTEREST_MODES,
  interestOn,
  isRateBp,
  MAX_INTEREST_RATE_BP,
  orderInterestDueAt,
  parseRate,
  totalInterestDueAt,
  unpaidByOrder,
  type InterestDefaults,
  type InterestEntry,
  type InterestMode,
} from './credit-interest.js';
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
  ReturnToSupplierField,
  ReturnToSupplierInput,
  ReturnToSupplierResult,
  SupplierReturnRecord,
} from './purchasing.js';
export { PURCHASE_STATUSES } from './purchasing.js';
export type { CustomerDisplayLine, CustomerDisplayMode, CustomerDisplayReceipt, CustomerDisplayState } from './customer-display.js';
export { CUSTOMER_DISPLAY_MODES, IDLE_DISPLAY_STATE } from './customer-display.js';
export { DESKTOP_API_VERSION, type DesktopApi } from './desktop-api.js';
export { canReverseOrder, ORDER_PAYMENT_METHODS } from './draft.js';
export type { CheckoutDraft, CompleteOrderInput, CompleteOrderResult, DraftLine, OrderLineProblem, OrderPaymentMethod, OrderActionInput, OrderActionResult, SalesOrderDetail, SalesOrderSummary } from './draft.js';
export { formatQuantity, lineTotal, MAX_QUANTITY_DECIMALS, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from './quantity.js';
export { gramsToQuantityMilli, isScaleBarcode, parseScaleBarcode, productCodeOf, type ScaleLabel } from './scale-barcode.js';

export {
  ALL_PERMISSIONS,
  type ChangePinInput,
  type ChangePinResult,
  isPermission,
  isValidPin,
  EMPLOYEE_NUMBER_PREFIX,
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
  suggestEmployeeNumber,
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
export {
  columnsFor,
  buildSaleReceipt,
  buildTestReceipt,
  DEFAULT_PAPER_WIDTH_MM,
  dotsFor,
  EMPTY_RECEIPT_SHOP,
  formatReceiptMoney,
  PAPER_WIDTHS_MM,
  wrapText,
  type PaperWidthMm,
  type ReceiptAlign,
  type ReceiptDocument,
  type ReceiptLine,
  type ReceiptShop,
} from './receipt.js';
export {
  DEFAULT_PRINTER_PORT,
  DEFAULT_PRINTER_SETTINGS,
  isPaperWidth,
  MAX_LOGO_BYTES,
  MAX_SHOP_ADDRESS,
  MAX_SHOP_FOOTER,
  MAX_SHOP_NAME,
  PRINTER_ERROR_CODES,
  type PrinterConfig,
  type PrinterConnection,
  type PrinterDebug,
  type PrinterErrorCode,
  type PrinterSettings,
  type PrinterSettingsField,
  type PrintResult,
  type ReceiptShopSettings,
  type SaveLogoResult,
  type SavePrinterSettingsResult,
  type UsbPrinterInfo,
} from './printing.js';
export { layoutReceipt, type ReceiptRow } from './receipt-layout.js';
export { ORDER_QR_PREFIX, orderQrPayload, parseOrderQr } from './order-qr.js';
export { dayOf, dayRange, PAYMENT_METHOD_ORDER, type ItemSold, type MethodTotal, type SalesReport } from './reports.js';
export {
  buildReportDocument,
  EXPORT_FORMATS,
  isExportFormat,
  isReportKind,
  methodName,
  REPORT_KINDS,
  REPORT_LABELS,
  reportToCsv,
  reportToHtml,
  type ExportFormat,
  type ExportResult,
  type ReportDocument,
  type ReportKind,
  type ReportSection,
} from './report-document.js';
export { isColumnKeys, isTableId, MAX_COLUMNS, MAX_TABLE_ID, orderColumns, type TableColumnOrders } from './table-columns.js';
export {
  chartBuckets,
  DASHBOARD_PERIOD_LABELS,
  DASHBOARD_PERIODS,
  daysInRange,
  granularityFor,
  isDashboardPeriod,
  MAX_DASHBOARD_DAYS,
  periodRange,
  previousRange,
  shiftDay,
  type ChartBar,
  type ChartGranularity,
  type DashboardData,
  type DashboardPeriod,
  type DashboardQuery,
  type PeriodTotals,
} from './dashboard.js';
export { discountCents, formatDiscount, isDiscountSpec, MAX_DISCOUNT_REASON, MAX_ORDER_NOTE, parseDiscount, type DiscountSpec } from './discount.js';
export { deviceNameFromAgent, LAN_DEFAULT_PORT, LAN_PAIRING_MS, MAX_DEVICE_NAME, type LanDevice, type LanPairing, type LanState } from './lan.js';
export { isSessionTimeoutMinutes, MAX_SESSION_TIMEOUT_MINUTES, MIN_SESSION_TIMEOUT_MINUTES, type SessionActivity } from './session-timeout.js';
