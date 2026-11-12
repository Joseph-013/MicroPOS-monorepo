import { ipcMain } from 'electron';
import type { AppDatabase } from '../db';
import { listCategories, listProducts } from '../db/queries/catalog';
import { clearDraft, loadDraft, saveDraft } from '../db/queries/draft';
import { API_VERSION, CHANNELS } from './channels';

/**
 * Registers every IPC handler. The renderer only ever reaches the database through these;
 * keep handlers thin (validate input, call a query function, return plain data).
 */
export function registerIpcHandlers(db: AppDatabase): void {
  ipcMain.handle(CHANNELS.app.version, () => API_VERSION);
  ipcMain.handle(CHANNELS.catalog.listProducts, () => listProducts(db));
  ipcMain.handle(CHANNELS.catalog.listCategories, () => listCategories(db));
  ipcMain.handle(CHANNELS.checkout.loadDraft, () => loadDraft(db));
  // The payload comes from the renderer, so it is validated (sanitizeDraft) before it is stored.
  ipcMain.handle(CHANNELS.checkout.saveDraft, (_event, draft: unknown) => saveDraft(db, draft));
  ipcMain.handle(CHANNELS.checkout.clearDraft, () => clearDraft(db));
}
