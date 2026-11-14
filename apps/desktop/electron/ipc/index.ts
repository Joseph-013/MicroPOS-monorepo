import fs from 'node:fs';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, shell } from 'electron';
import { ALL_PERMISSIONS, isExportFormat, isReportKind, type Permission } from '@micropos/core';
import type { AppDatabase } from '../db';
import { listCategories, listProducts } from '../db/queries/catalog';
import { createProduct, deleteProducts, listProductRecords, restoreProducts, setProductsActive, updateProduct } from '../db/queries/products';
import { createCategory, deleteCategories, listCategoryRecords, restoreCategories, updateCategory } from '../db/queries/categories';
import { returnToSupplier } from '../db/queries/supplier-returns';
import { dashboard } from '../db/queries/dashboard';
import { adjustStock, listBatches, receiveStock, repackageStock, stockConcerns } from '../db/queries/inventory';
import { cancelPurchase, createPurchase, createSupplier, deleteSuppliers, getPurchase, listPurchases, listSuppliers, payPurchase, purchaseConcerns, receivePurchase, restoreSuppliers, updatePurchase, updateSupplier } from '../db/queries/purchases';
import { countCreditAlerts, getCreditAlertSettings, saveCreditAlertSettings } from '../db/queries/credit-alerts';
import { getColumnOrders, saveColumnOrder } from '../table-columns';
import { salesReport } from '../db/queries/reports';
import type { BackupService } from '../backup/service';
import { exportReport } from '../reports/export';
import { getInterestDefaults, saveInterestDefaults } from '../db/queries/credit-interest';
import { createCustomer, deleteCustomers, getCustomerAccount, listCustomers, receivePayment, restoreCustomers, updateCustomer } from '../db/queries/customers';
import { completeOrder, getOrder, orderIdByNumber, listOrders, nextOrderNumber, refundOrder, voidOrder } from '../db/queries/orders';
import { clearDraft, loadDraft, othersInProgress, saveDraft } from '../db/queries/draft';
import { clearRepackageDraft, loadRepackageDraft, saveRepackageDraft } from '../db/queries/repackage-draft';
import { clearProductDraft, loadProductDraft, saveProductDraft } from '../db/queries/product-draft';
import { setScannerEnabled } from '../scanner';
import { setSessionTimeout } from '../auth/session-timeout';
import { changePin, isAllowed, isFreshInstall, recordActivity, signIn, signInChoices, signOut, currentUser } from '../auth/auth';
import { createUser, listUsers, resetPin, signInLog, updateUser } from '../auth/users';
import { getCloseToTray, setCloseToTray } from '../close-to-tray';
import { log, logDirectory } from '../logging';
import { createPrinterService, receiptImagesFolder } from '../printing';
import { getSaveReceiptImages, setSaveReceiptImages } from '../printing/debug-settings';
import { shopLogos } from '../printing/logo';
import { loadPrinterSettings, savePrinterSettings } from '../printing/settings';
import { listUsbPrinters } from '../printing/transports/usb';
import { API_VERSION, CHANNELS } from './channels';
import type { LanService } from '../lan';
import type { RpcHandler } from '../lan/server';
import { givesDiscount } from './discount-gate';
import { emitDataChanged, WRITES, wroteNothing } from './changes';

/**
 * Every call the page can make, by channel: registered with Electron for the till's own window, and kept here so the
 * server for paired devices (`lan/`) runs the very same handlers, with the same permission checks, for a phone.
 */
export const rpcHandlers = new Map<string, RpcHandler>();

function handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, handler);
  rpcHandlers.set(channel, handler as RpcHandler);
}

/**
 * Registers a handler that runs only while someone is signed in who holds one of `needed` (an empty list: anyone
 * signed in). This is the real gate: the pages hide what a user may not do, but only this keeps them out.
 */
function guarded(db: AppDatabase, channel: string, needed: Permission | readonly Permission[], listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  handle(channel, (event, ...args) => {
    if (!isAllowed(db, typeof needed === 'string' ? [needed] : needed)) {
      log.warn(`ipc:${channel}`, 'Not allowed');
      throw new Error('Not allowed');
    }
    // A handler that throws is written to the log (its message and stack, never its arguments, which can hold secrets) and still reaches the page.
    const failed = (error: unknown): never => {
      log.error(`ipc:${channel}`, error instanceof Error ? error.message : String(error), error);
      throw error;
    };
    let result: unknown;
    try {
      result = listener(event, ...args);
    } catch (error) {
      return failed(error);
    }
    const changes = WRITES[channel];
    // A write that went through tells every window which parts of the data changed (see ipc/changes.ts).
    if (changes) void Promise.resolve(result).then((r) => (wroteNothing(r) ? undefined : emitDataChanged(changes)), () => undefined);
    return result instanceof Promise ? result.catch(failed) : result;
  });
}

/**
 * Registers every IPC handler. The renderer only ever reaches the database through these;
 * keep handlers thin (validate input, call a query function, return plain data).
 */
export function registerIpcHandlers(db: AppDatabase, lan?: LanService, backup?: BackupService): void {
  handle(CHANNELS.app.version, () => API_VERSION);
  const printer = createPrinterService(db);
  // The page reports its errors here. Open to every window (an error can happen before sign-in), so it is bounded: a few entries a minute, short fields.
  let reported: number[] = [];
  handle(CHANNELS.log.write, (_event, entry: unknown) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const now = Date.now();
    reported = reported.filter((t) => now - t < 60_000);
    if (reported.length >= 50) return;
    reported.push(now);
    const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
    const source = `page:${text(e['source'], 60) || 'unknown'}`;
    const message = text(e['message'], 500) || 'Error';
    const details = text(e['details'], 4000) || undefined;
    if (e['level'] === 'warn') log.warn(source, message, details);
    else log.error(source, message, details);
  });
  guarded(db, CHANNELS.printer.settings, 'settings.manage', () => loadPrinterSettings(db));
  guarded(db, CHANNELS.printer.save, 'settings.manage', (_event, input: unknown) => savePrinterSettings(db, input));
  guarded(db, CHANNELS.printer.getLogo, 'settings.manage', () => shopLogos.dataUrl());
  guarded(db, CHANNELS.printer.saveLogo, 'settings.manage', (_event, bytes: unknown) => shopLogos.save(bytes));
  guarded(db, CHANNELS.printer.removeLogo, 'settings.manage', () => shopLogos.remove());
  guarded(db, CHANNELS.printer.listUsb, 'settings.manage', async () => {
    try {
      return await listUsbPrinters();
    } catch (error) {
      log.warn('printer', 'Could not list USB printers', error);
      return [];
    }
  });
  guarded(db, CHANNELS.printer.testPrint, 'settings.manage', () => printer.printTest());
  guarded(db, CHANNELS.printer.printOrder, ['orders.view', 'checkout.sell'], async (_event, orderId: unknown) => {
    const order = getOrder(db, orderId);
    return order ? printer.printSale(order) : ({ ok: false, code: 'unknown', error: 'Order not found' } as const);
  });
  guarded(db, CHANNELS.tables.columnOrders, ALL_PERMISSIONS, () => getColumnOrders(db));
  guarded(db, CHANNELS.tables.saveColumnOrder, 'settings.manage', (_event, tableId: unknown, keys: unknown) => saveColumnOrder(db, tableId, keys));
  guarded(db, CHANNELS.reports.sales, 'reports.view', (_event, from: unknown, to: unknown) => salesReport(db, from, to));
  guarded(db, CHANNELS.reports.export, 'reports.view', async (event, kind: unknown, from: unknown, to: unknown, format: unknown) => {
    const report = isReportKind(kind) && isExportFormat(format) ? salesReport(db, from, to) : null;
    if (!report || !isReportKind(kind) || !isExportFormat(format)) return { ok: false, error: 'That report cannot be made' } as const;
    return exportReport(kind, report, format, BrowserWindow.fromWebContents(event.sender), loadPrinterSettings(db).shop.name);
  });
  guarded(db, CHANNELS.debug.get, 'settings.manage', () => ({ saveImages: getSaveReceiptImages(db), folder: receiptImagesFolder() }));
  guarded(db, CHANNELS.debug.setSaveImages, 'settings.manage', (_event, value: unknown) => setSaveReceiptImages(db, value));
  guarded(db, CHANNELS.debug.openReceiptsFolder, 'settings.manage', async () => {
    fs.mkdirSync(receiptImagesFolder(), { recursive: true });
    return (await shell.openPath(receiptImagesFolder())) === '';
  });
  guarded(db, CHANNELS.shell.getLogsFolder, 'settings.manage', () => logDirectory());
  guarded(db, CHANNELS.shell.openLogsFolder, 'settings.manage', async () => {
    const dir = logDirectory();
    return dir ? (await shell.openPath(dir)) === '' : false;
  });
  guarded(db, CHANNELS.catalog.listProducts, [], () => listProducts(db));
  guarded(db, CHANNELS.catalog.listCategories, [], () => listCategories(db));
  // Product payloads come from the renderer: createProduct/updateProduct validate them before writing.
  guarded(db, CHANNELS.products.list, ['catalog.view', 'catalog.manage'], (_event, options: unknown) =>
    listProductRecords(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  guarded(db, CHANNELS.products.create, 'catalog.manage', (_event, input: unknown) => createProduct(db, input));
  guarded(db, CHANNELS.products.update, 'catalog.manage', (_event, id: unknown, input: unknown) => updateProduct(db, id, input));
  guarded(db, CHANNELS.products.remove, 'catalog.manage', (_event, ids: unknown) => deleteProducts(db, ids));
  guarded(db, CHANNELS.products.loadDraft, 'catalog.manage', (_event, form: unknown) => loadProductDraft(db, form));
  guarded(db, CHANNELS.products.saveDraft, 'catalog.manage', (_event, form: unknown, draft: unknown) => saveProductDraft(db, form, draft));
  guarded(db, CHANNELS.products.clearDraft, 'catalog.manage', (_event, form: unknown) => clearProductDraft(db, form));
  guarded(db, CHANNELS.products.setActive, 'catalog.manage', (_event, ids: unknown, active: unknown) => setProductsActive(db, ids, active));
  guarded(db, CHANNELS.products.restore, 'catalog.manage', (_event, ids: unknown) => restoreProducts(db, ids));
  // Category payloads come from the renderer: create/update validate them before writing.
  guarded(db, CHANNELS.categories.list, ['catalog.view', 'catalog.manage'], (_event, options: unknown) =>
    listCategoryRecords(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  guarded(db, CHANNELS.categories.create, 'catalog.manage', (_event, input: unknown) => createCategory(db, input));
  guarded(db, CHANNELS.categories.update, 'catalog.manage', (_event, id: unknown, input: unknown) => updateCategory(db, id, input));
  guarded(db, CHANNELS.categories.remove, 'catalog.manage', (_event, ids: unknown) => deleteCategories(db, ids));
  guarded(db, CHANNELS.categories.restore, 'catalog.manage', (_event, ids: unknown) => restoreCategories(db, ids));
  // Stock calls validate their input (receiveStock / adjustStock) before writing.
  guarded(db, CHANNELS.inventory.listBatches, ['inventory.manage', 'catalog.view'], (_event, options: unknown) =>
    listBatches(db, { includeEmpty: (options as { includeEmpty?: unknown } | undefined)?.includeEmpty === true }),
  );
  guarded(db, CHANNELS.dashboard.get, 'dashboard.view', (_event, query: unknown) => dashboard(db, query));
  guarded(db, CHANNELS.inventory.concerns, 'inventory.manage', () => stockConcerns(db));
  guarded(db, CHANNELS.inventory.receive, 'inventory.manage', (_event, input: unknown) => receiveStock(db, input));
  guarded(db, CHANNELS.inventory.adjust, 'inventory.manage', (_event, input: unknown) => adjustStock(db, input));
  guarded(db, CHANNELS.inventory.repackage, 'inventory.manage', (_event, input: unknown) => repackageStock(db, input));
  guarded(db, CHANNELS.inventory.returnToSupplier, 'purchasing.manage', (_event, input: unknown) => returnToSupplier(db, input));
  guarded(db, CHANNELS.inventory.loadRepackageDraft, 'inventory.manage', () => loadRepackageDraft(db));
  guarded(db, CHANNELS.inventory.saveRepackageDraft, 'inventory.manage', (_event, draft: unknown) => saveRepackageDraft(db, draft));
  guarded(db, CHANNELS.inventory.clearRepackageDraft, 'inventory.manage', () => clearRepackageDraft(db));
  ipcMain.handle(CHANNELS.scanner.setEnabled, (_event, on: unknown) => setScannerEnabled(on !== false));
  // Customer payloads come from the renderer: create/update/receivePayment validate them before writing.
  guarded(db, CHANNELS.suppliers.list, ['purchasing.manage', 'inventory.manage'], (_event, options: unknown) =>
    listSuppliers(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  guarded(db, CHANNELS.suppliers.create, 'purchasing.manage', (_event, input: unknown) => createSupplier(db, input));
  guarded(db, CHANNELS.suppliers.update, 'purchasing.manage', (_event, id: unknown, input: unknown) => updateSupplier(db, id, input));
  guarded(db, CHANNELS.suppliers.remove, 'purchasing.manage', (_event, ids: unknown) => deleteSuppliers(db, ids));
  guarded(db, CHANNELS.suppliers.restore, 'purchasing.manage', (_event, ids: unknown) => restoreSuppliers(db, ids));
  guarded(db, CHANNELS.purchases.concerns, 'purchasing.manage', () => purchaseConcerns(db));
  guarded(db, CHANNELS.purchases.list, ['purchasing.manage', 'inventory.manage'], () => listPurchases(db));
  guarded(db, CHANNELS.purchases.get, ['purchasing.manage', 'inventory.manage'], (_event, id: unknown) => getPurchase(db, id));
  guarded(db, CHANNELS.purchases.create, 'purchasing.manage', (_event, input: unknown) => createPurchase(db, input));
  guarded(db, CHANNELS.purchases.update, 'purchasing.manage', (_event, id: unknown, input: unknown) => updatePurchase(db, id, input));
  guarded(db, CHANNELS.purchases.receive, 'purchasing.manage', (_event, input: unknown) => receivePurchase(db, input));
  guarded(db, CHANNELS.purchases.pay, 'purchasing.manage', (_event, input: unknown) => payPurchase(db, input));
  guarded(db, CHANNELS.purchases.cancel, 'purchasing.manage', (_event, id: unknown) => cancelPurchase(db, id));
  guarded(db, CHANNELS.customers.list, ['customers.view', 'customers.manage', 'checkout.sell'], (_event, options: unknown) =>
    listCustomers(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  guarded(db, CHANNELS.customers.create, 'customers.manage', (_event, input: unknown) => createCustomer(db, input));
  guarded(db, CHANNELS.customers.update, 'customers.manage', (_event, id: unknown, input: unknown) => updateCustomer(db, id, input));
  guarded(db, CHANNELS.customers.remove, 'customers.manage', (_event, ids: unknown) => deleteCustomers(db, ids));
  guarded(db, CHANNELS.customers.restore, 'customers.manage', (_event, ids: unknown) => restoreCustomers(db, ids));
  guarded(db, CHANNELS.customers.account, 'customers.view', (_event, id: unknown) => getCustomerAccount(db, id));
  guarded(db, CHANNELS.customers.receivePayment, 'customers.payments', (_event, input: unknown) => receivePayment(db, input));
  guarded(db, CHANNELS.customers.interestDefaults, 'customers.manage', () => getInterestDefaults(db));
  guarded(db, CHANNELS.customers.saveInterestDefaults, 'customers.manage', (_event, input: unknown) => saveInterestDefaults(db, input));
  guarded(db, CHANNELS.customers.alertCount, 'customers.view', () => countCreditAlerts(db));
  guarded(db, CHANNELS.customers.alertSettings, 'customers.manage', () => getCreditAlertSettings(db));
  guarded(db, CHANNELS.customers.saveAlertSettings, 'customers.manage', (_event, input: unknown) => saveCreditAlertSettings(db, input));
  guarded(db, CHANNELS.orders.list, ['orders.view', 'customers.view'], () => listOrders(db));
  guarded(db, CHANNELS.orders.idByNumber, ['orders.view', 'customers.view'], (_event, orderNumber: unknown) => orderIdByNumber(db, orderNumber));
  guarded(db, CHANNELS.orders.get, ['orders.view', 'customers.view'], (_event, id: unknown) => getOrder(db, id));
  // The renderer sends an order id and a reason; voidOrder / refundOrder validate both and decide whether the order may be reversed.
  guarded(db, CHANNELS.orders.void, 'orders.reverse', (_event, input: unknown) => voidOrder(db, input));
  guarded(db, CHANNELS.orders.refund, 'orders.reverse', (_event, input: unknown) => refundOrder(db, input));
  guarded(db, CHANNELS.checkout.loadDraft, 'checkout.sell', () => loadDraft(db));
  // The payload comes from the renderer, so it is validated (sanitizeDraft) before it is stored.
  guarded(db, CHANNELS.checkout.saveDraft, 'checkout.sell', (_event, draft: unknown) => saveDraft(db, draft));
  guarded(db, CHANNELS.checkout.clearDraft, 'checkout.sell', () => clearDraft(db));
  guarded(db, CHANNELS.checkout.nextOrderNumber, 'checkout.sell', () => nextOrderNumber(db));
  guarded(db, CHANNELS.checkout.othersInProgress, 'checkout.sell', () => othersInProgress(db));
  // The order comes from the renderer: completeOrder validates it and takes prices and names from the catalog.
  guarded(db, CHANNELS.checkout.completeOrder, 'checkout.sell', (_event, input: unknown) => {
    // Giving a discount is a permission of its own: a cashier's order that carries one is refused whole.
    if (givesDiscount(input) && !isAllowed(db, ['discounts.give'])) return { ok: false, error: 'You are not allowed to give discounts', lines: [] } as const;
    return completeOrder(db, input);
  });
  // Signing in and out: the sign-in screen can ask who may sign in and try a PIN before anyone is signed in.
  handle(CHANNELS.auth.status, () => currentUser(db));
  handle(CHANNELS.auth.activity, () => recordActivity(db));
  handle(CHANNELS.auth.choices, () => signInChoices(db));
  handle(CHANNELS.auth.branding, () => ({ shopName: loadPrinterSettings(db).shop.name, logo: shopLogos.dataUrl() }));
  handle(CHANNELS.auth.signIn, (_event, input: unknown) => signIn(db, input));
  guarded(db, CHANNELS.auth.signOut, [], () => signOut(db));
  guarded(db, CHANNELS.auth.setSessionTimeout, 'settings.manage', (_event, minutes: unknown) => setSessionTimeout(db, minutes));
  guarded(db, CHANNELS.auth.changePin, [], (_event, input: unknown) => changePin(db, input));
  guarded(db, CHANNELS.shell.getCloseToTray, 'settings.manage', () => getCloseToTray(db));
  guarded(db, CHANNELS.shell.setCloseToTray, 'settings.manage', (_event, value: unknown) => setCloseToTray(db, value));
  guarded(db, CHANNELS.users.list, ['users.manage'], () => listUsers(db));
  guarded(db, CHANNELS.users.create, ['users.manage'], (_event, input: unknown) => createUser(db, input));
  guarded(db, CHANNELS.users.update, ['users.manage'], (_event, id: unknown, input: unknown) => updateUser(db, id, input));
  guarded(db, CHANNELS.users.resetPin, ['users.manage'], (_event, id: unknown, pin: unknown) => resetPin(db, id, pin));
  guarded(db, CHANNELS.users.signInLog, ['users.manage'], () => signInLog(db));
  // Connecting other devices (admins only; the till's own window: a paired device cannot reach these).
  if (backup) {
    guarded(db, CHANNELS.backup.list, 'settings.manage', () => backup.list());
    guarded(db, CHANNELS.backup.create, 'settings.manage', () => backup.create());
    guarded(db, CHANNELS.backup.remove, 'settings.manage', (_event, name: unknown) => backup.remove(name));
    guarded(db, CHANNELS.backup.exportTo, 'settings.manage', (event) => backup.exportTo(BrowserWindow.fromWebContents(event.sender)));
    guarded(db, CHANNELS.backup.exportCsv, 'settings.manage', (event) => backup.exportCsv(BrowserWindow.fromWebContents(event.sender)));
    guarded(db, CHANNELS.backup.importFrom, 'settings.manage', (event) => backup.importFrom(BrowserWindow.fromWebContents(event.sender)));
    guarded(db, CHANNELS.backup.restore, 'settings.manage', (_event, name: unknown) => backup.restore(name));
    guarded(db, CHANNELS.backup.openFolder, 'settings.manage', () => backup.openFolder());
    // A fresh install's sign-in screen may restore a backup before anyone signs in (the `backup` group is never offered
    // to paired devices); the main process re-checks that it is still fresh, so this cannot replace anyone's data.
    handle(CHANNELS.backup.freshInstall, () => isFreshInstall(db));
    handle(CHANNELS.backup.importFresh, (event) =>
      isFreshInstall(db) ? backup.importFrom(BrowserWindow.fromWebContents(event.sender)) : { ok: false as const, error: 'Not allowed: this till is already in use. Restore from Settings > Backup.' },
    );
  }
  if (lan) {
    guarded(db, CHANNELS.lan.state, 'settings.manage', () => lan.state());
    guarded(db, CHANNELS.lan.setEnabled, 'settings.manage', (_event, enabled: unknown) => lan.setEnabled(enabled));
    guarded(db, CHANNELS.lan.devices, 'settings.manage', () => lan.devices());
    guarded(db, CHANNELS.lan.newPairing, 'settings.manage', () => lan.newPairing());
    guarded(db, CHANNELS.lan.revokeDevice, 'settings.manage', (_event, id: unknown) => lan.revoke(id));
  }
}
