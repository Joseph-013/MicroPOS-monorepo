import type { CatalogCategory, CatalogProduct } from './catalog.js';

/**
 * What the Electron preload exposes to the renderer as `window.micropos`.
 * The renderer never touches the database directly; every call here is an IPC request
 * answered by the main process.
 */
export interface DesktopApi {
  platform: string;
  catalog: {
    /** Live (not deleted, active) products, sorted by name. */
    listProducts(): Promise<CatalogProduct[]>;
    /** Live categories, sorted by name. */
    listCategories(): Promise<CatalogCategory[]>;
  };
}
