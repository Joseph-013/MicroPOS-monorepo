import { ipcMain } from 'electron';
import type { AppDatabase } from '../db';
import { listCategories, listProducts } from '../db/queries/catalog';
import { createProduct, deleteProducts, listProductRecords, restoreProducts, setProductsActive, updateProduct } from '../db/queries/products';
import { createCategory, deleteCategories, listCategoryRecords, restoreCategories, updateCategory } from '../db/queries/categories';
import { adjustStock, inventoryOverview, listBatches, receiveStock, repackageStock } from '../db/queries/inventory';
import { cancelPurchase, createPurchase, createSupplier, deleteSuppliers, getPurchase, listPurchases, listSuppliers, payPurchase, receivePurchase, restoreSuppliers, updatePurchase, updateSupplier } from '../db/queries/purchases';
import { createCustomer, deleteCustomers, getCustomerAccount, listCustomers, receivePayment, restoreCustomers, updateCustomer } from '../db/queries/customers';
import { completeOrder, getOrder, listOrders, nextOrderNumber, refundOrder, voidOrder } from '../db/queries/orders';
import { clearDraft, loadDraft, saveDraft } from '../db/queries/draft';
import { clearRepackageDraft, loadRepackageDraft, saveRepackageDraft } from '../db/queries/repackage-draft';
import { clearProductDraft, loadProductDraft, saveProductDraft } from '../db/queries/product-draft';
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
  ipcMain.handle(CHANNELS.products.loadDraft, (_event, form: unknown) => loadProductDraft(db, form));
  ipcMain.handle(CHANNELS.products.saveDraft, (_event, form: unknown, draft: unknown) => saveProductDraft(db, form, draft));
  ipcMain.handle(CHANNELS.products.clearDraft, (_event, form: unknown) => clearProductDraft(db, form));
  ipcMain.handle(CHANNELS.products.setActive, (_event, ids: unknown, active: unknown) => setProductsActive(db, ids, active));
  ipcMain.handle(CHANNELS.products.restore, (_event, ids: unknown) => restoreProducts(db, ids));
  // Category payloads come from the renderer: create/update validate them before writing.
  ipcMain.handle(CHANNELS.categories.list, (_event, options: unknown) =>
    listCategoryRecords(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  ipcMain.handle(CHANNELS.categories.create, (_event, input: unknown) => createCategory(db, input));
  ipcMain.handle(CHANNELS.categories.update, (_event, id: unknown, input: unknown) => updateCategory(db, id, input));
  ipcMain.handle(CHANNELS.categories.remove, (_event, ids: unknown) => deleteCategories(db, ids));
  ipcMain.handle(CHANNELS.categories.restore, (_event, ids: unknown) => restoreCategories(db, ids));
  // Stock calls validate their input (receiveStock / adjustStock) before writing.
  ipcMain.handle(CHANNELS.inventory.listBatches, (_event, options: unknown) =>
    listBatches(db, { includeEmpty: (options as { includeEmpty?: unknown } | undefined)?.includeEmpty === true }),
  );
  ipcMain.handle(CHANNELS.inventory.overview, () => inventoryOverview(db));
  ipcMain.handle(CHANNELS.inventory.receive, (_event, input: unknown) => receiveStock(db, input));
  ipcMain.handle(CHANNELS.inventory.adjust, (_event, input: unknown) => adjustStock(db, input));
  ipcMain.handle(CHANNELS.inventory.repackage, (_event, input: unknown) => repackageStock(db, input));
  ipcMain.handle(CHANNELS.inventory.loadRepackageDraft, () => loadRepackageDraft(db));
  ipcMain.handle(CHANNELS.inventory.saveRepackageDraft, (_event, draft: unknown) => saveRepackageDraft(db, draft));
  ipcMain.handle(CHANNELS.inventory.clearRepackageDraft, () => clearRepackageDraft(db));
  ipcMain.handle(CHANNELS.scanner.setEnabled, (_event, on: unknown) => setScannerEnabled(on !== false));
  // Customer payloads come from the renderer: create/update/receivePayment validate them before writing.
  ipcMain.handle(CHANNELS.suppliers.list, (_event, options: unknown) =>
    listSuppliers(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  ipcMain.handle(CHANNELS.suppliers.create, (_event, input: unknown) => createSupplier(db, input));
  ipcMain.handle(CHANNELS.suppliers.update, (_event, id: unknown, input: unknown) => updateSupplier(db, id, input));
  ipcMain.handle(CHANNELS.suppliers.remove, (_event, ids: unknown) => deleteSuppliers(db, ids));
  ipcMain.handle(CHANNELS.suppliers.restore, (_event, ids: unknown) => restoreSuppliers(db, ids));
  ipcMain.handle(CHANNELS.purchases.list, () => listPurchases(db));
  ipcMain.handle(CHANNELS.purchases.get, (_event, id: unknown) => getPurchase(db, id));
  ipcMain.handle(CHANNELS.purchases.create, (_event, input: unknown) => createPurchase(db, input));
  ipcMain.handle(CHANNELS.purchases.update, (_event, id: unknown, input: unknown) => updatePurchase(db, id, input));
  ipcMain.handle(CHANNELS.purchases.receive, (_event, input: unknown) => receivePurchase(db, input));
  ipcMain.handle(CHANNELS.purchases.pay, (_event, input: unknown) => payPurchase(db, input));
  ipcMain.handle(CHANNELS.purchases.cancel, (_event, id: unknown) => cancelPurchase(db, id));
  ipcMain.handle(CHANNELS.customers.list, (_event, options: unknown) =>
    listCustomers(db, (options as { includeDeleted?: unknown } | undefined)?.includeDeleted === true),
  );
  ipcMain.handle(CHANNELS.customers.create, (_event, input: unknown) => createCustomer(db, input));
  ipcMain.handle(CHANNELS.customers.update, (_event, id: unknown, input: unknown) => updateCustomer(db, id, input));
  ipcMain.handle(CHANNELS.customers.remove, (_event, ids: unknown) => deleteCustomers(db, ids));
  ipcMain.handle(CHANNELS.customers.restore, (_event, ids: unknown) => restoreCustomers(db, ids));
  ipcMain.handle(CHANNELS.customers.account, (_event, id: unknown) => getCustomerAccount(db, id));
  ipcMain.handle(CHANNELS.customers.receivePayment, (_event, input: unknown) => receivePayment(db, input));
  ipcMain.handle(CHANNELS.orders.list, () => listOrders(db));
  ipcMain.handle(CHANNELS.orders.get, (_event, id: unknown) => getOrder(db, id));
  // The renderer sends an order id and a reason; voidOrder / refundOrder validate both and decide whether the order may be reversed.
  ipcMain.handle(CHANNELS.orders.void, (_event, input: unknown) => voidOrder(db, input));
  ipcMain.handle(CHANNELS.orders.refund, (_event, input: unknown) => refundOrder(db, input));
  ipcMain.handle(CHANNELS.checkout.loadDraft, () => loadDraft(db));
  // The payload comes from the renderer, so it is validated (sanitizeDraft) before it is stored.
  ipcMain.handle(CHANNELS.checkout.saveDraft, (_event, draft: unknown) => saveDraft(db, draft));
  ipcMain.handle(CHANNELS.checkout.clearDraft, () => clearDraft(db));
  ipcMain.handle(CHANNELS.checkout.nextOrderNumber, () => nextOrderNumber(db));
  // The order comes from the renderer: completeOrder validates it and takes prices and names from the catalog.
  ipcMain.handle(CHANNELS.checkout.completeOrder, (_event, input: unknown) => completeOrder(db, input));
}
