import type { DesktopApi } from '@micropos/core';
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './ipc/channels';

// The only surface the renderer sees (`window.micropos`). Typed by DesktopApi in @micropos/core.
// Add IPC wrappers here rather than enabling nodeIntegration.
const api: DesktopApi = {
  platform: process.platform,
  version: () => ipcRenderer.invoke(CHANNELS.app.version),
  catalog: {
    listProducts: () => ipcRenderer.invoke(CHANNELS.catalog.listProducts),
    listCategories: () => ipcRenderer.invoke(CHANNELS.catalog.listCategories),
  },
  products: {
    list: (options) => ipcRenderer.invoke(CHANNELS.products.list, options),
    create: (input) => ipcRenderer.invoke(CHANNELS.products.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.products.update, id, input),
    remove: (ids) => ipcRenderer.invoke(CHANNELS.products.remove, ids),
    restore: (ids) => ipcRenderer.invoke(CHANNELS.products.restore, ids),
    loadDraft: (form) => ipcRenderer.invoke(CHANNELS.products.loadDraft, form),
    saveDraft: (form, draft) => ipcRenderer.invoke(CHANNELS.products.saveDraft, form, draft),
    clearDraft: (form) => ipcRenderer.invoke(CHANNELS.products.clearDraft, form),
    setActive: (ids, active) => ipcRenderer.invoke(CHANNELS.products.setActive, ids, active),
  },
  categories: {
    list: (options) => ipcRenderer.invoke(CHANNELS.categories.list, options),
    create: (input) => ipcRenderer.invoke(CHANNELS.categories.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.categories.update, id, input),
    remove: (ids) => ipcRenderer.invoke(CHANNELS.categories.remove, ids),
    restore: (ids) => ipcRenderer.invoke(CHANNELS.categories.restore, ids),
  },
  inventory: {
    listBatches: (options) => ipcRenderer.invoke(CHANNELS.inventory.listBatches, options),
    overview: () => ipcRenderer.invoke(CHANNELS.inventory.overview),
    receive: (input) => ipcRenderer.invoke(CHANNELS.inventory.receive, input),
    adjust: (input) => ipcRenderer.invoke(CHANNELS.inventory.adjust, input),
    repackage: (input) => ipcRenderer.invoke(CHANNELS.inventory.repackage, input),
    loadRepackageDraft: () => ipcRenderer.invoke(CHANNELS.inventory.loadRepackageDraft),
    saveRepackageDraft: (draft) => ipcRenderer.invoke(CHANNELS.inventory.saveRepackageDraft, draft),
    clearRepackageDraft: () => ipcRenderer.invoke(CHANNELS.inventory.clearRepackageDraft),
  },
  display: {
    show: (options) => ipcRenderer.invoke(CHANNELS.display.show, options),
    hide: () => ipcRenderer.invoke(CHANNELS.display.hide),
    isOpen: () => ipcRenderer.invoke(CHANNELS.display.isOpen),
    onVisibility: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, open: boolean): void => listener(open);
      ipcRenderer.on(CHANNELS.display.visibility, handler);
      return () => ipcRenderer.removeListener(CHANNELS.display.visibility, handler);
    },
    publish: (state) => ipcRenderer.invoke(CHANNELS.display.publish, state),
    getState: () => ipcRenderer.invoke(CHANNELS.display.getState),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]): void => listener(state);
      ipcRenderer.on(CHANNELS.display.state, handler);
      return () => ipcRenderer.removeListener(CHANNELS.display.state, handler);
    },
  },
  scanner: {
    onScan: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, scan: { code: string }): void => listener(scan);
      ipcRenderer.on(CHANNELS.scanner.scan, handler);
      return () => ipcRenderer.removeListener(CHANNELS.scanner.scan, handler);
    },
    setEnabled: (enabled) => ipcRenderer.invoke(CHANNELS.scanner.setEnabled, enabled),
  },
  suppliers: {
    list: (options) => ipcRenderer.invoke(CHANNELS.suppliers.list, options),
    create: (input) => ipcRenderer.invoke(CHANNELS.suppliers.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.suppliers.update, id, input),
    remove: (ids) => ipcRenderer.invoke(CHANNELS.suppliers.remove, ids),
    restore: (ids) => ipcRenderer.invoke(CHANNELS.suppliers.restore, ids),
  },
  purchases: {
    list: () => ipcRenderer.invoke(CHANNELS.purchases.list),
    get: (id) => ipcRenderer.invoke(CHANNELS.purchases.get, id),
    create: (input) => ipcRenderer.invoke(CHANNELS.purchases.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.purchases.update, id, input),
    receive: (input) => ipcRenderer.invoke(CHANNELS.purchases.receive, input),
    pay: (input) => ipcRenderer.invoke(CHANNELS.purchases.pay, input),
    cancel: (id) => ipcRenderer.invoke(CHANNELS.purchases.cancel, id),
  },
  customers: {
    list: (options) => ipcRenderer.invoke(CHANNELS.customers.list, options),
    create: (input) => ipcRenderer.invoke(CHANNELS.customers.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.customers.update, id, input),
    remove: (ids) => ipcRenderer.invoke(CHANNELS.customers.remove, ids),
    restore: (ids) => ipcRenderer.invoke(CHANNELS.customers.restore, ids),
    account: (id) => ipcRenderer.invoke(CHANNELS.customers.account, id),
    receivePayment: (input) => ipcRenderer.invoke(CHANNELS.customers.receivePayment, input),
  },
  orders: {
    list: () => ipcRenderer.invoke(CHANNELS.orders.list),
    get: (id) => ipcRenderer.invoke(CHANNELS.orders.get, id),
    void: (input) => ipcRenderer.invoke(CHANNELS.orders.void, input),
    refund: (input) => ipcRenderer.invoke(CHANNELS.orders.refund, input),
  },
  checkout: {
    loadDraft: () => ipcRenderer.invoke(CHANNELS.checkout.loadDraft),
    saveDraft: (draft) => ipcRenderer.invoke(CHANNELS.checkout.saveDraft, draft),
    clearDraft: () => ipcRenderer.invoke(CHANNELS.checkout.clearDraft),
    nextOrderNumber: () => ipcRenderer.invoke(CHANNELS.checkout.nextOrderNumber),
    completeOrder: (input) => ipcRenderer.invoke(CHANNELS.checkout.completeOrder, input),
  },
};

contextBridge.exposeInMainWorld('micropos', api);
