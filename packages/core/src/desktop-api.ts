import type { AdjustStockInput, BatchRecord, InventoryOverview, ReceiveStockInput, RepackageDraft, RepackageInput, RepackageResult, StockResult } from './inventory.js';
import type { CatalogCategory, CatalogProduct, CategoryInput, CategoryRecord, RestoreCategoriesResult, SaveCategoryResult, ProductDraft, ProductInput, ProductRecord, RestoreProductsResult, SaveProductResult } from './catalog.js';
import type { CheckoutDraft, CompleteOrderInput, CompleteOrderResult } from './draft.js';

/**
 * Version of the renderer <-> main process contract. Bump it (here and in `electron/ipc/channels.ts`, which a
 * test keeps in step) whenever a call or payload changes in a way an older main process cannot handle. The page
 * checks it at startup so a dev app that kept running old main-process code says so instead of misbehaving.
 */
export const DESKTOP_API_VERSION = 17;

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
}
