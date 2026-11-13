import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { Permission } from '@micropos/core';
import type { AppDatabase } from '../db';
import { listCategories, listProducts } from '../db/queries/catalog';
import { createProduct, deleteProducts, listProductRecords, restoreProducts, setProductsActive, updateProduct } from '../db/queries/products';
import { createCategory, deleteCategories, listCategoryRecords, restoreCategories, updateCategory } from '../db/queries/categories';
import { adjustStock, inventoryOverview, listBatches, receiveStock, repackageStock } from '../db/queries/inventory';
import { cancelPurchase, createPurchase, createSupplier, deleteSuppliers, getPurchase, listPurchases, listSuppliers, payPurchase, receivePurchase, restoreSuppliers, updatePurchase, updateSupplier } from '../db/queries/purchases';
import { getInterestDefaults, saveInterestDefaults } from '../db/queries/credit-interest';
import { createCustomer, deleteCustomers, getCustomerAccount, listCustomers, receivePayment, restoreCustomers, updateCustomer } from '../db/queries/customers';
import { completeOrder, getOrder, listOrders, nextOrderNumber, refundOrder, voidOrder } from '../db/queries/orders';
import { clearDraft, loadDraft, saveDraft } from '../db/queries/draft';
import { clearRepackageDraft, loadRepackageDraft, saveRepackageDraft } from '../db/queries/repackage-draft';
import { clearProductDraft, loadProductDraft, saveProductDraft } from '../db/queries/product-draft';
import { setScannerEnabled } from '../scanner';
import { changePin, isAllowed, signIn, signInChoices, signOut, currentUser } from '../auth/auth';
import { createUser, listUsers, resetPin, signInLog, updateUser } from '../auth/users';
import { API_VERSION, CHANNELS } from './channels';

/**
 * Registers a handler that runs only while someone is signed in who holds one of `needed` (an empty list: anyone
 * signed in). This is the real gate: the pages hide what a user may not do, but only this keeps them out.
 */
function guarded(db: AppDatabase, channel: string, needed: Permission | readonly Permission[], listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAllowed(db, typeof needed === 'string' ? [needed] : needed)) throw new Error('Not allowed');
    return listener(event, ...args);
  });
}

/**
 * Registers every IPC handler. The renderer only ever reaches the database through these;
 * keep handlers thin (validate input, call a query function, return plain data).
 */
export function registerIpcHandlers(db: AppDatabase): void {
  ipcMain.handle(CHANNELS.app.version, () => API_VERSION);
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
  guarded(db, CHANNELS.inventory.overview, 'catalog.view', () => inventoryOverview(db));
  guarded(db, CHANNELS.inventory.receive, 'inventory.manage', (_event, input: unknown) => receiveStock(db, input));
  guarded(db, CHANNELS.inventory.adjust, 'inventory.manage', (_event, input: unknown) => adjustStock(db, input));
  guarded(db, CHANNELS.inventory.repackage, 'inventory.manage', (_event, input: unknown) => repackageStock(db, input));
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
  guarded(db, CHANNELS.orders.list, ['orders.view', 'customers.view'], () => listOrders(db));
  guarded(db, CHANNELS.orders.get, ['orders.view', 'customers.view'], (_event, id: unknown) => getOrder(db, id));
  // The renderer sends an order id and a reason; voidOrder / refundOrder validate both and decide whether the order may be reversed.
  guarded(db, CHANNELS.orders.void, 'orders.reverse', (_event, input: unknown) => voidOrder(db, input));
  guarded(db, CHANNELS.orders.refund, 'orders.reverse', (_event, input: unknown) => refundOrder(db, input));
  guarded(db, CHANNELS.checkout.loadDraft, 'checkout.sell', () => loadDraft(db));
  // The payload comes from the renderer, so it is validated (sanitizeDraft) before it is stored.
  guarded(db, CHANNELS.checkout.saveDraft, 'checkout.sell', (_event, draft: unknown) => saveDraft(db, draft));
  guarded(db, CHANNELS.checkout.clearDraft, 'checkout.sell', () => clearDraft(db));
  guarded(db, CHANNELS.checkout.nextOrderNumber, 'checkout.sell', () => nextOrderNumber(db));
  // The order comes from the renderer: completeOrder validates it and takes prices and names from the catalog.
  guarded(db, CHANNELS.checkout.completeOrder, 'checkout.sell', (_event, input: unknown) => completeOrder(db, input));
  // Signing in and out: the sign-in screen can ask who may sign in and try a PIN before anyone is signed in.
  ipcMain.handle(CHANNELS.auth.status, () => currentUser(db));
  ipcMain.handle(CHANNELS.auth.choices, () => signInChoices(db));
  ipcMain.handle(CHANNELS.auth.signIn, (_event, input: unknown) => signIn(db, input));
  guarded(db, CHANNELS.auth.signOut, [], () => signOut(db));
  guarded(db, CHANNELS.auth.changePin, [], (_event, input: unknown) => changePin(db, input));
  guarded(db, CHANNELS.users.list, ['users.manage'], () => listUsers(db));
  guarded(db, CHANNELS.users.create, ['users.manage'], (_event, input: unknown) => createUser(db, input));
  guarded(db, CHANNELS.users.update, ['users.manage'], (_event, id: unknown, input: unknown) => updateUser(db, id, input));
  guarded(db, CHANNELS.users.resetPin, ['users.manage'], (_event, id: unknown, pin: unknown) => resetPin(db, id, pin));
  guarded(db, CHANNELS.users.signInLog, ['users.manage'], () => signInLog(db));
}
