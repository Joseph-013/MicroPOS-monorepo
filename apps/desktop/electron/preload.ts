import type { DataDomain, DesktopApi } from '@micropos/core';
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
  printer: {
    settings: () => ipcRenderer.invoke(CHANNELS.printer.settings),
    save: (settings) => ipcRenderer.invoke(CHANNELS.printer.save, settings),
    getLogo: () => ipcRenderer.invoke(CHANNELS.printer.getLogo),
    saveLogo: (bytes) => ipcRenderer.invoke(CHANNELS.printer.saveLogo, bytes),
    removeLogo: () => ipcRenderer.invoke(CHANNELS.printer.removeLogo),
    listUsb: () => ipcRenderer.invoke(CHANNELS.printer.listUsb),
    testPrint: () => ipcRenderer.invoke(CHANNELS.printer.testPrint),
    printOrder: (orderId) => ipcRenderer.invoke(CHANNELS.printer.printOrder, orderId),
  },
  backup: {
    list: () => ipcRenderer.invoke(CHANNELS.backup.list),
    create: () => ipcRenderer.invoke(CHANNELS.backup.create),
    remove: (name) => ipcRenderer.invoke(CHANNELS.backup.remove, name),
    exportTo: () => ipcRenderer.invoke(CHANNELS.backup.exportTo),
    exportCsv: () => ipcRenderer.invoke(CHANNELS.backup.exportCsv),
    importFrom: () => ipcRenderer.invoke(CHANNELS.backup.importFrom),
    restore: (name) => ipcRenderer.invoke(CHANNELS.backup.restore, name),
    openFolder: () => ipcRenderer.invoke(CHANNELS.backup.openFolder),
    freshInstall: () => ipcRenderer.invoke(CHANNELS.backup.freshInstall),
    importFresh: () => ipcRenderer.invoke(CHANNELS.backup.importFresh),
  },
  lan: {
    state: () => ipcRenderer.invoke(CHANNELS.lan.state),
    setEnabled: (enabled) => ipcRenderer.invoke(CHANNELS.lan.setEnabled, enabled),
    devices: () => ipcRenderer.invoke(CHANNELS.lan.devices),
    newPairing: () => ipcRenderer.invoke(CHANNELS.lan.newPairing),
    revokeDevice: (id) => ipcRenderer.invoke(CHANNELS.lan.revokeDevice, id),
  },
  dashboard: {
    get: (query) => ipcRenderer.invoke(CHANNELS.dashboard.get, query),
  },
  tables: {
    columnOrders: () => ipcRenderer.invoke(CHANNELS.tables.columnOrders),
    saveColumnOrder: (tableId, keys) => ipcRenderer.invoke(CHANNELS.tables.saveColumnOrder, tableId, keys),
  },
  reports: {
    sales: (from, to) => ipcRenderer.invoke(CHANNELS.reports.sales, from, to),
    export: (kind, from, to, format) => ipcRenderer.invoke(CHANNELS.reports.export, kind, from, to, format),
  },
  debug: {
    get: () => ipcRenderer.invoke(CHANNELS.debug.get),
    setSaveImages: (value) => ipcRenderer.invoke(CHANNELS.debug.setSaveImages, value),
    openReceiptsFolder: () => ipcRenderer.invoke(CHANNELS.debug.openReceiptsFolder),
  },
  log: {
    write: (entry) => ipcRenderer.invoke(CHANNELS.log.write, entry),
  },
  shell: {
    getLogsFolder: () => ipcRenderer.invoke(CHANNELS.shell.getLogsFolder),
    openLogsFolder: () => ipcRenderer.invoke(CHANNELS.shell.openLogsFolder),
    getCloseToTray: () => ipcRenderer.invoke(CHANNELS.shell.getCloseToTray),
    setCloseToTray: (value) => ipcRenderer.invoke(CHANNELS.shell.setCloseToTray, value),
  },
  data: {
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, domains: DataDomain[]): void => listener(domains);
      ipcRenderer.on(CHANNELS.data.changed, handler);
      return () => ipcRenderer.removeListener(CHANNELS.data.changed, handler);
    },
  },
  inventory: {
    listBatches: (options) => ipcRenderer.invoke(CHANNELS.inventory.listBatches, options),
    concerns: () => ipcRenderer.invoke(CHANNELS.inventory.concerns),
    receive: (input) => ipcRenderer.invoke(CHANNELS.inventory.receive, input),
    adjust: (input) => ipcRenderer.invoke(CHANNELS.inventory.adjust, input),
    repackage: (input) => ipcRenderer.invoke(CHANNELS.inventory.repackage, input),
    returnToSupplier: (input) => ipcRenderer.invoke(CHANNELS.inventory.returnToSupplier, input),
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
  auth: {
    status: () => ipcRenderer.invoke(CHANNELS.auth.status),
    choices: () => ipcRenderer.invoke(CHANNELS.auth.choices),
    branding: () => ipcRenderer.invoke(CHANNELS.auth.branding),
    signIn: (input) => ipcRenderer.invoke(CHANNELS.auth.signIn, input),
    signOut: () => ipcRenderer.invoke(CHANNELS.auth.signOut),
    changePin: (input) => ipcRenderer.invoke(CHANNELS.auth.changePin, input),
    activity: () => ipcRenderer.invoke(CHANNELS.auth.activity),
    setSessionTimeout: (minutes) => ipcRenderer.invoke(CHANNELS.auth.setSessionTimeout, minutes),
  },
  users: {
    list: () => ipcRenderer.invoke(CHANNELS.users.list),
    create: (input) => ipcRenderer.invoke(CHANNELS.users.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.users.update, id, input),
    resetPin: (id, pin) => ipcRenderer.invoke(CHANNELS.users.resetPin, id, pin),
    signInLog: () => ipcRenderer.invoke(CHANNELS.users.signInLog),
  },
  suppliers: {
    list: (options) => ipcRenderer.invoke(CHANNELS.suppliers.list, options),
    create: (input) => ipcRenderer.invoke(CHANNELS.suppliers.create, input),
    update: (id, input) => ipcRenderer.invoke(CHANNELS.suppliers.update, id, input),
    remove: (ids) => ipcRenderer.invoke(CHANNELS.suppliers.remove, ids),
    restore: (ids) => ipcRenderer.invoke(CHANNELS.suppliers.restore, ids),
  },
  purchases: {
    concerns: () => ipcRenderer.invoke(CHANNELS.purchases.concerns),
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
    interestDefaults: () => ipcRenderer.invoke(CHANNELS.customers.interestDefaults),
    saveInterestDefaults: (input) => ipcRenderer.invoke(CHANNELS.customers.saveInterestDefaults, input),
    alertCount: () => ipcRenderer.invoke(CHANNELS.customers.alertCount),
    alertSettings: () => ipcRenderer.invoke(CHANNELS.customers.alertSettings),
    saveAlertSettings: (input) => ipcRenderer.invoke(CHANNELS.customers.saveAlertSettings, input),
  },
  orders: {
    list: () => ipcRenderer.invoke(CHANNELS.orders.list),
    get: (id) => ipcRenderer.invoke(CHANNELS.orders.get, id),
    idByNumber: (orderNumber) => ipcRenderer.invoke(CHANNELS.orders.idByNumber, orderNumber),
    void: (input) => ipcRenderer.invoke(CHANNELS.orders.void, input),
    refund: (input) => ipcRenderer.invoke(CHANNELS.orders.refund, input),
  },
  checkout: {
    loadDraft: () => ipcRenderer.invoke(CHANNELS.checkout.loadDraft),
    saveDraft: (draft) => ipcRenderer.invoke(CHANNELS.checkout.saveDraft, draft),
    clearDraft: () => ipcRenderer.invoke(CHANNELS.checkout.clearDraft),
    nextOrderNumber: () => ipcRenderer.invoke(CHANNELS.checkout.nextOrderNumber),
    othersInProgress: () => ipcRenderer.invoke(CHANNELS.checkout.othersInProgress),
    completeOrder: (input) => ipcRenderer.invoke(CHANNELS.checkout.completeOrder, input),
  },
};

contextBridge.exposeInMainWorld('micropos', api);
