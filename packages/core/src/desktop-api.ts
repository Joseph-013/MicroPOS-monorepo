import type { CatalogCategory, CatalogProduct, ProductInput, ProductRecord, RestoreProductsResult, SaveProductResult } from './catalog.js';
import type { CheckoutDraft } from './draft.js';

/**
 * Version of the renderer <-> main process contract. Bump it (here and in `electron/ipc/channels.ts`, which a
 * test keeps in step) whenever a call or payload changes in a way an older main process cannot handle. The page
 * checks it at startup so a dev app that kept running old main-process code says so instead of misbehaving.
 */
export const DESKTOP_API_VERSION = 10;

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
    /** Marks products active (offered at checkout) or inactive; deleted ones are left alone. */
    setActive(ids: string[], active: boolean): Promise<void>;
    /** Puts deleted products back; those whose code a live product now uses are skipped and reported. */
    restore(ids: string[]): Promise<RestoreProductsResult>;
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
  };
}
