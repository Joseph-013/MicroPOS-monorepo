import type { CatalogCategory, CatalogProduct } from './catalog.js';
import type { CheckoutDraft } from './draft.js';

/**
 * Version of the renderer <-> main process contract. Bump it (here and in `electron/ipc/channels.ts`, which a
 * test keeps in step) whenever a call or payload changes in a way an older main process cannot handle. The page
 * checks it at startup so a dev app that kept running old main-process code says so instead of misbehaving.
 */
export const DESKTOP_API_VERSION = 3;

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
  checkout: {
    /** The saved order in progress, or null when there is none. */
    loadDraft(): Promise<CheckoutDraft | null>;
    /** Replaces the saved draft; an empty draft removes it. */
    saveDraft(draft: CheckoutDraft): Promise<void>;
    clearDraft(): Promise<void>;
  };
}
