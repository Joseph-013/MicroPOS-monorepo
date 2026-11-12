import { ipcMain } from 'electron';
import type { AppDatabase } from '../db';
import { listCategories, listProducts } from '../db/queries/catalog';
import { createProduct, deleteProducts, listProductRecords, restoreProducts, setProductsActive, updateProduct } from '../db/queries/products';
import { clearDraft, loadDraft, saveDraft } from '../db/queries/draft';
import { setScannerEnabled } from '../scanner';
import { API_VERSION, CHANNELS } from './channels';

/**
 * Registers every IPC handler. The renderer only ever reaches the database through these;
 * keep handlers thin (validate input, call a query function, return plain data).
 */
export function registerIpcHandlers(db: AppDatabase): void {
  ipcMain.handle(CHANNELS.app.version, () => API_VERSION);
  ipcMain.handle(CHANNELS.catalog.listProducts, () => listProducts(db));
  ipcMain.handle(CHANNELS.catalog.listCategories, () => listCategories(db));
  // Product payloads come from the renderer: createProduct/updateProduct validate them before writing.
  ipcMain.handle(CHANNELS.products.list, (_event, options: unknown) =>
    listProductRecords(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  ipcMain.handle(CHANNELS.products.create, (_event, input: unknown) => createProduct(db, input));
  ipcMain.handle(CHANNELS.products.update, (_event, id: unknown, input: unknown) => updateProduct(db, id, input));
  ipcMain.handle(CHANNELS.products.remove, (_event, ids: unknown) => deleteProducts(db, ids));
  ipcMain.handle(CHANNELS.products.setActive, (_event, ids: unknown, active: unknown) => setProductsActive(db, ids, active));
  ipcMain.handle(CHANNELS.products.restore, (_event, ids: unknown) => restoreProducts(db, ids));
  ipcMain.handle(CHANNELS.scanner.setEnabled, (_event, on: unknown) => setScannerEnabled(on !== false));
  ipcMain.handle(CHANNELS.checkout.loadDraft, () => loadDraft(db));
  // The payload comes from the renderer, so it is validated (sanitizeDraft) before it is stored.
  ipcMain.handle(CHANNELS.checkout.saveDraft, (_event, draft: unknown) => saveDraft(db, draft));
  ipcMain.handle(CHANNELS.checkout.clearDraft, () => clearDraft(db));
}
