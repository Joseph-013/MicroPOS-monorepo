import type { ChangePinInput, ChangePinResult, ResetPinResult, SaveUserResult, SessionUser, SignInBranding, SignInChoice, SignInLogEntry, SignInResult, UserInput, UserRecord } from './auth.js';
import type { AdjustStockInput, BatchRecord, ReceiveStockInput, RepackageDraft, RepackageInput, RepackageResult, StockResult } from './inventory.js';
import type { CatalogCategory, CatalogProduct, CategoryInput, CategoryRecord, RestoreCategoriesResult, SaveCategoryResult, ProductDraft, ProductInput, ProductRecord, RestoreProductsResult, SaveProductResult } from './catalog.js';
import type {
  CancelPurchaseResult,
  PayPurchaseInput,
  PayPurchaseResult,
  PurchaseDetail,
  PurchaseInput,
  PurchaseSummary,
  ReceivePurchaseInput,
  ReceivePurchaseResult,
  RemoveSuppliersResult,
  ReturnToSupplierInput,
  ReturnToSupplierResult,
  SavePurchaseResult,
  SaveSupplierResult,
  SupplierInput,
  SupplierRecord,
} from './purchasing.js';
import type { CustomerDisplayMode, CustomerDisplayState } from './customer-display.js';
import type { PrinterDebug, PrinterSettings, PrintResult, SaveLogoResult, SavePrinterSettingsResult, UsbPrinterInfo } from './printing.js';
import type { TableColumnOrders } from './table-columns.js';
import type { SessionActivity } from './session-timeout.js';
import type { BackupList, BackupResult, ExportDatabaseResult, ImportDatabaseResult } from './backup.js';
import type { LanDevice, LanPairing, LanState } from './lan.js';
import type { DashboardData, DashboardQuery } from './dashboard.js';
import type { SalesReport } from './reports.js';
import type { ExportFormat, ExportResult, ReportKind } from './report-document.js';
import type { DataDomain, PurchaseConcern, StockConcern } from './concerns.js';
import type { CreditAlertSettings } from './credit-alerts.js';
import type { InterestDefaults } from './credit-interest.js';
import type { CustomerAccount, CustomerInput, CustomerRecord, ReceivePaymentInput, ReceivePaymentResult, RemoveCustomersResult, SaveCustomerResult } from './customers.js';
import type { CheckoutDraft, CompleteOrderInput, CompleteOrderResult, OrderActionInput, OrderActionResult, SalesOrderDetail, SalesOrderSummary } from './draft.js';

/**
 * Version of the renderer <-> main process contract. Bump it (here and in `electron/ipc/channels.ts`, which a
 * test keeps in step) whenever a call or payload changes in a way an older main process cannot handle. The page
 * checks it at startup so a dev app that kept running old main-process code says so instead of misbehaving.
 */
export const DESKTOP_API_VERSION = 51;

/**
 * What the Electron preload exposes to the renderer as `window.micropos`.
 * The renderer never touches the database directly; every call here is an IPC request
 * answered by the main process.
 */
export interface DesktopApi {
  platform: string;
  /** The main process's `API_VERSION`; compare with `DESKTOP_API_VERSION`. */
  version(): Promise<number>;
  catalog: {
    /** Live (not deleted, active) products, sorted by name. */
    listProducts(): Promise<CatalogProduct[]>;
    /** Live categories, sorted by name. */
    listCategories(): Promise<CatalogCategory[]>;
  };
  products: {
    /** Every product in the catalog, active or not, sorted by name; `includeDeleted` adds deleted ones too. */
    list(options?: { includeDeleted?: boolean }): Promise<ProductRecord[]>;
    create(input: ProductInput): Promise<SaveProductResult>;
    update(id: string, input: ProductInput): Promise<SaveProductResult>;
    /** Removes products from the catalog (kept on file so past orders still resolve). */
    remove(ids: string[]): Promise<void>;
    /** The saved half-filled form: `form` is `new` (adding) or a product id (editing); null when there is none. */
    loadDraft(form: string): Promise<ProductDraft | null>;
    saveDraft(form: string, draft: ProductDraft): Promise<void>;
    clearDraft(form: string): Promise<void>;
    /** Marks products active (offered at checkout) or inactive; deleted ones are left alone. */
    setActive(ids: string[], active: boolean): Promise<void>;
    /** Puts deleted products back; those whose code a live product now uses are skipped and reported. */
    restore(ids: string[]): Promise<RestoreProductsResult>;
  };
  categories: {
    /** Every live category with its product count, sorted by order then name; `includeDeleted` adds deleted ones. */
    list(options?: { includeDeleted?: boolean }): Promise<CategoryRecord[]>;
    create(input: CategoryInput): Promise<SaveCategoryResult>;
    update(id: string, input: CategoryInput): Promise<SaveCategoryResult>;
    /** Removes categories (products keep their other categories; the links are kept in case of a restore). */
    remove(ids: string[]): Promise<void>;
    /** Puts deleted categories back; one whose name is taken meanwhile is skipped and reported. */
    restore(ids: string[]): Promise<RestoreCategoriesResult>;
  };
  printer: {
    /** The receipt printer's connection and paper width, and what the shop prints on receipts. */
    settings(): Promise<PrinterSettings>;
    save(settings: PrinterSettings): Promise<SavePrinterSettingsResult>;
    /** The shop logo printed at the top of receipts, as a data URL for showing it; null when there is none. */
    getLogo(): Promise<string | null>;
    /** Saves a picture (PNG or JPEG file bytes) as the logo, scaled to fit the widest paper. */
    saveLogo(bytes: Uint8Array): Promise<SaveLogoResult>;
    removeLogo(): Promise<void>;
    /** USB devices that look like printers, for choosing one. */
    listUsb(): Promise<UsbPrinterInfo[]>;
    /** Prints a short test page with the saved settings. */
    testPrint(): Promise<PrintResult>;
    /** Prints the receipt of a recorded sale. */
    printOrder(orderId: string): Promise<PrintResult>;
  };
  log: {
    /** The page reports an error to the main process, which writes it to the log files. Nothing comes back. */
    write(entry: { level: 'error' | 'warn'; source: string; message: string; details?: string }): Promise<void>;
  };
  backup: {
    /** The backups kept in the app's backups folder, newest first. */
    list(): Promise<BackupList>;
    /** Makes a backup now. */
    create(): Promise<BackupResult>;
    /** Deletes one backup. */
    remove(name: string): Promise<boolean>;
    /** Saves a copy of the database where the person chooses (a save dialog). */
    exportTo(): Promise<ExportDatabaseResult>;
    /** Saves the data as CSV files, one per table, in a new folder inside the one the person chooses (a folder dialog); `savedTo` is that new folder. PIN hashes, paired-device tokens and settings are left out. */
    exportCsv(): Promise<ExportDatabaseResult>;
    /** Asks for a database file (an export or a backup), checks it, backs up the current data and restarts the app with the file in place. */
    importFrom(): Promise<ImportDatabaseResult>;
    /** The same, from a backup in the backups folder. */
    restore(name: string): Promise<ImportDatabaseResult>;
    /** Opens the backups folder in the system's file manager. */
    openFolder(): Promise<boolean>;
    /** Whether this is a fresh install nobody has signed in to yet (no sign-ins, products or sales): the sign-in screen then offers Restore from backup. Open before sign-in. */
    freshInstall(): Promise<boolean>;
    /** `importFrom` for the sign-in screen: allowed only while `freshInstall` is true, refused afterwards. */
    importFresh(): Promise<ImportDatabaseResult>;
  };
  lan: {
    /** Whether the till is serving other devices, and where. */
    state(): Promise<LanState>;
    /** Turns the server on or off (kept across restarts). */
    setEnabled(enabled: boolean): Promise<LanState>;
    /** The paired devices. */
    devices(): Promise<LanDevice[]>;
    /** A QR code that pairs one device within a few minutes; null while the server is not running. */
    newPairing(): Promise<LanPairing | null>;
    /** Unpairs a device: it is signed out and cannot connect again without a new QR code. */
    revokeDevice(id: string): Promise<boolean>;
  };
  dashboard: {
    /** The figures for the Dashboard page over the days asked for; null when the days are not valid dates in order (or too many). */
    get(query: DashboardQuery): Promise<DashboardData | null>;
  };
  tables: {
    /** The column order an admin saved for each page table (tables never saved are not in it). */
    columnOrders(): Promise<TableColumnOrders>;
    /** Saves one table's column order for everyone; false when the table or keys are not valid. */
    saveColumnOrder(tableId: string, keys: string[]): Promise<boolean>;
  };
  reports: {
    /** The sales summary for the local days `from` to `to` inclusive (`YYYY-MM-DD`), or null when they are not dates in order. */
    sales(from: string, to: string): Promise<SalesReport | null>;
    /** Saves a report as CSV or PDF (the person picks the file) or prints it with the system's print dialog. */
    export(kind: ReportKind, from: string, to: string, format: ExportFormat): Promise<ExportResult>;
  };
  debug: {
    /** Whether receipts are saved as images instead of printed, and where. */
    get(): Promise<PrinterDebug>;
    setSaveImages(value: boolean): Promise<boolean>;
    /** Opens the folder the receipt images go in (made if it is not there yet). */
    openReceiptsFolder(): Promise<boolean>;
  };
  shell: {
    /** Where the log files are (a folder an admin can open and copy). */
    getLogsFolder(): Promise<string | null>;
    /** Opens that folder in the system's file manager; false when it could not be opened. */
    openLogsFolder(): Promise<boolean>;
    /** Whether closing the window hides it (the app keeps running, with an icon in the tray) instead of quitting. */
    getCloseToTray(): Promise<boolean>;
    setCloseToTray(value: boolean): Promise<boolean>;
  };
  data: {
    /**
     * The main process announces which parts of the data changed (after a write, and when time alone makes
     * something a concern, such as a payment falling overdue). Returns a function that stops listening.
     */
    onChanged(listener: (domains: readonly DataDomain[]) => void): () => void;
  };
  inventory: {
    /** Batches that still have stock (`includeEmpty` adds used-up ones), soonest expiry first. */
    listBatches(options?: { includeEmpty?: boolean }): Promise<BatchRecord[]>;
    /** What needs attention: expired and expiring batches, products out of stock or at their critical level (the Inventory badge). */
    concerns(): Promise<StockConcern[]>;
    /** Adds stock to a product (a new batch, or the single batch of a quantity-only product). */
    receive(input: ReceiveStockInput): Promise<StockResult>;
    /** Removes stock as waste or expired, or corrects a count. */
    adjust(input: AdjustStockInput): Promise<StockResult>;
    /** Sends stock from one batch back to its supplier, for a refund that first reduces what is owed on the order it came on. */
    returnToSupplier(input: ReturnToSupplierInput): Promise<ReturnToSupplierResult>;
    /** Opens a pack: takes stock out of one product and puts it into others (a sack into loose kilos). */
    repackage(input: RepackageInput): Promise<RepackageResult>;
    /** The saved half-filled Repackage form, or null. */
    loadRepackageDraft(): Promise<RepackageDraft | null>;
    saveRepackageDraft(draft: RepackageDraft): Promise<void>;
    clearRepackageDraft(): Promise<void>;
  };
  scanner: {
    /**
     * Barcode scans, detected in the main process (it holds the scanner's keystrokes back, so a scan never
     * types into the page). Returns a function that stops listening.
     */
    onScan(listener: (scan: { code: string }) => void): () => void;
    /** Turn scan detection on or off; off lets scanner keys through as ordinary typing. */
    setEnabled(enabled: boolean): Promise<void>;
  };
  display: {
    /**
     * Opens the customer-facing window on the monitor it was on last time, windowed (at the position it had),
     * maximized or full screen (`mode`, windowed when left out). If it is already open it is put into that mode.
     * With `remember: false` it does not use the monitor and position from last time (it opens on a monitor other than
     * the primary, centred) and does not save where it is moved to; left out, it remembers.
     */
    show(options?: { mode?: CustomerDisplayMode; remember?: boolean }): Promise<void>;
    /** Closes it (its monitor and position are remembered). */
    hide(): Promise<void>;
    isOpen(): Promise<boolean>;
    /** Called with `true` when the window opens and `false` when it closes, however that happened. Returns a function that stops listening. */
    onVisibility(listener: (open: boolean) => void): () => void;
    /** Checkout sends what the customer should see; the main process keeps the latest and passes it to the window. */
    publish(state: CustomerDisplayState): Promise<void>;
    /** The latest published state (an idle one before anything was published). */
    getState(): Promise<CustomerDisplayState>;
    /** The display window listens for new states. Returns a function that stops listening. */
    onState(listener: (state: CustomerDisplayState) => void): () => void;
  };
  customers: {
    /** Live customers with what each owes, sorted by name; `includeDeleted` adds deleted ones. */
    list(options?: { includeDeleted?: boolean }): Promise<CustomerRecord[]>;
    create(input: CustomerInput): Promise<SaveCustomerResult>;
    update(id: string, input: CustomerInput): Promise<SaveCustomerResult>;
    /** Removes customers; one who still owes (or is owed) money is left alone and reported. */
    remove(ids: string[]): Promise<RemoveCustomersResult>;
    restore(ids: string[]): Promise<void>;
    /** The customer with their ledger, newest entry first; null when there is no such customer. */
    account(id: string): Promise<CustomerAccount | null>;
    /** Records money received towards what the customer owes (never more than they owe). */
    receivePayment(input: ReceivePaymentInput): Promise<ReceivePaymentResult>;
    /** The monthly rates a customer's interest starts from when it is switched on. */
    interestDefaults(): Promise<InterestDefaults>;
    /** Saves the defaults (new ones only; customers keep their own rate). False when a rate is not valid. */
    saveInterestDefaults(input: InterestDefaults): Promise<boolean>;
    /** How many customers need attention (owe more than the alert amount, or have a sale unpaid for longer than the alert days): the badge on Customers. */
    alertCount(): Promise<number>;
    alertSettings(): Promise<CreditAlertSettings>;
    /** Saves the alert limits (null turns one off). False when a value is not valid. */
    saveAlertSettings(input: CreditAlertSettings): Promise<boolean>;
  };
  suppliers: {
    /** Live suppliers with what is owed to each, sorted by name; `includeDeleted` adds deleted ones. */
    list(options?: { includeDeleted?: boolean }): Promise<SupplierRecord[]>;
    create(input: SupplierInput): Promise<SaveSupplierResult>;
    update(id: string, input: SupplierInput): Promise<SaveSupplierResult>;
    /** Removes suppliers; one still owed money, or with orders on the way, is left alone and reported. */
    remove(ids: string[]): Promise<RemoveSuppliersResult>;
    restore(ids: string[]): Promise<void>;
  };
  purchases: {
    /** Every purchase order, newest first. */
    list(): Promise<PurchaseSummary[]>;
    /** Orders that are late to arrive or overdue for payment (the Purchases badge). */
    concerns(): Promise<PurchaseConcern[]>;
    /** One purchase order with its lines and payments, or null when there is no such order. */
    get(id: string): Promise<PurchaseDetail | null>;
    /** Places an order with a supplier. Nothing is received or paid yet. */
    create(input: PurchaseInput): Promise<SavePurchaseResult>;
    /** Changes an order that has not arrived yet (its lines are replaced); never below what is already paid. */
    update(id: string, input: PurchaseInput): Promise<SavePurchaseResult>;
    /** What has not arrived yet of the order arrives: it goes into inventory as new stock at the ordered cost. All or nothing. */
    receive(input: ReceivePurchaseInput): Promise<ReceivePurchaseResult>;
    /** Records money paid to the supplier towards the order (never more than is owed). */
    pay(input: PayPurchaseInput): Promise<PayPurchaseResult>;
    /** Calls off an order that has not arrived and has nothing paid on it. */
    cancel(id: string): Promise<CancelPurchaseResult>;
  };
  orders: {
    /** Every recorded order, newest first. */
    list(): Promise<SalesOrderSummary[]>;
    /** One recorded order with its lines and payments, or null when there is no such order. */
    get(id: string): Promise<SalesOrderDetail | null>;
    /** The id of the order with this number ("SO-1001", as on its receipt), or null; for opening an order from a scanned receipt code. */
    idByNumber(orderNumber: string): Promise<string | null>;
    /** Cancels a completed sale: the stock goes back to the batches it came from and the order is marked voided. */
    void(input: OrderActionInput): Promise<OrderActionResult>;
    /** Reverses a completed sale: a refund order with negative amounts is recorded, the stock goes back and the sale is marked refunded. */
    refund(input: OrderActionInput): Promise<OrderActionResult>;
  };
  checkout: {
    /** The saved order in progress, or null when there is none. */
    loadDraft(): Promise<CheckoutDraft | null>;
    /** Replaces the saved draft; an empty draft removes it. */
    saveDraft(draft: CheckoutDraft): Promise<void>;
    clearDraft(): Promise<void>;
    /** The number the next order will get (shown while it is being rung up). */
    nextOrderNumber(): Promise<string>;
    /**
     * Completes the order in one transaction: re-checks prices and stock, records the order, its lines, the payment
     * and the stock taken (first-expiring-first-out), and removes the saved draft. Nothing is written if any line fails.
     */
    completeOrder(input: CompleteOrderInput): Promise<CompleteOrderResult>;
  };
  auth: {
    /** Who is signed in, or null when the till is locked. */
    status(): Promise<SessionUser | null>;
    /** The people who can sign in (active, with a PIN): whoever signed in last first, then by name. */
    choices(): Promise<SignInChoice[]>;
    /** The shop's name and logo for the sign-in screen (open before sign-in). */
    branding(): Promise<SignInBranding>;
    /** Signs in with a PIN. Too many wrong PINs in a row pause that person's sign-in for a minute. */
    signIn(input: { userId: string; pin: string }): Promise<SignInResult>;
    /** Locks the till and records the sign-out. */
    signOut(): Promise<void>;
    /** Changes the signed-in person's own PIN. */
    changePin(input: ChangePinInput): Promise<ChangePinResult>;
    /**
     * The page reports that someone is using it (it sends this while there is input, not while idle) and learns whether
     * the session is still open and the shop's inactivity limit. A session that has been idle longer than the limit has ended.
     */
    activity(): Promise<SessionActivity>;
    /** Sets how many minutes of inactivity end a session (null: never). Needs `settings.manage`; false when the number is not valid. */
    setSessionTimeout(minutes: number | null): Promise<boolean>;
  };
  users: {
    list(): Promise<UserRecord[]>;
    create(input: UserInput): Promise<SaveUserResult>;
    /** Changes name, number, permissions and whether the person can sign in. The last user who may manage users cannot lose that. */
    update(id: string, input: UserInput): Promise<SaveUserResult>;
    /** Sets a new PIN for someone else; they must change it when they next sign in. */
    resetPin(id: string, pin: string): Promise<ResetPinResult>;
    /** Sign-ins, newest first (the latest 200). */
    signInLog(): Promise<SignInLogEntry[]>;
  };
}
