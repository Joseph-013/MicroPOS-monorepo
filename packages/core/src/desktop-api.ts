import type { ChangePinInput, ChangePinResult, ResetPinResult, SaveUserResult, SessionUser, SignInChoice, SignInLogEntry, SignInResult, UserInput, UserRecord } from './auth.js';
import type { AdjustStockInput, BatchRecord, InventoryOverview, ReceiveStockInput, RepackageDraft, RepackageInput, RepackageResult, StockResult } from './inventory.js';
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
  SavePurchaseResult,
  SaveSupplierResult,
  SupplierInput,
  SupplierRecord,
} from './purchasing.js';
import type { CustomerDisplayMode, CustomerDisplayState } from './customer-display.js';
import type { CustomerAccount, CustomerInput, CustomerRecord, ReceivePaymentInput, ReceivePaymentResult, RemoveCustomersResult, SaveCustomerResult } from './customers.js';
import type { CheckoutDraft, CompleteOrderInput, CompleteOrderResult, OrderActionInput, OrderActionResult, SalesOrderDetail, SalesOrderSummary } from './draft.js';

/**
 * Version of the renderer <-> main process contract. Bump it (here and in `electron/ipc/channels.ts`, which a
 * test keeps in step) whenever a call or payload changes in a way an older main process cannot handle. The page
 * checks it at startup so a dev app that kept running old main-process code says so instead of misbehaving.
 */
export const DESKTOP_API_VERSION = 29;

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
  inventory: {
    /** Batches that still have stock (`includeEmpty` adds used-up ones), soonest expiry first. */
    listBatches(options?: { includeEmpty?: boolean }): Promise<BatchRecord[]>;
    /** The summary behind the Inventory overview page. */
    overview(): Promise<InventoryOverview>;
    /** Adds stock to a product (a new batch, or the single batch of a quantity-only product). */
    receive(input: ReceiveStockInput): Promise<StockResult>;
    /** Removes stock as waste or expired, or corrects a count. */
    adjust(input: AdjustStockInput): Promise<StockResult>;
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
    /** The people who can sign in (active, with a PIN), by name. */
    choices(): Promise<SignInChoice[]>;
    /** Signs in with a PIN. Too many wrong PINs in a row pause that person's sign-in for a minute. */
    signIn(input: { userId: string; pin: string }): Promise<SignInResult>;
    /** Locks the till and records the sign-out. */
    signOut(): Promise<void>;
    /** Changes the signed-in person's own PIN. */
    changePin(input: ChangePinInput): Promise<ChangePinResult>;
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
