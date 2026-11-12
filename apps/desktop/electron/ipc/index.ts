import { ipcMain } from 'electron';
import type { AppDatabase } from '../db';
import { listCategories, listProducts } from '../db/queries/catalog';
import { CHANNELS } from './channels';

/**
 * Registers every IPC handler. The renderer only ever reaches the database through these;
 * keep handlers thin (validate input, call a query function, return plain data).
 */
export function registerIpcHandlers(db: AppDatabase): void {
  ipcMain.handle(CHANNELS.catalog.listProducts, () => listProducts(db));
  ipcMain.handle(CHANNELS.catalog.listCategories, () => listCategories(db));
}
