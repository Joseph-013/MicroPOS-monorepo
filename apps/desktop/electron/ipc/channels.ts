/**
 * IPC channel names, shared by the main process and the preload script.
 * Convention: `<area>:<action>`. Every channel is a request/response (`invoke`/`handle`).
 */
/** Must equal `DESKTOP_API_VERSION` in @micropos/core (a test checks); bump both when the contract changes. */
export const API_VERSION = 46;

export const CHANNELS = {
  app: {
    version: 'app:version',
  },
  catalog: {
    listProducts: 'catalog:listProducts',
    listCategories: 'catalog:listCategories',
  },
  products: {
    list: 'products:list',
    create: 'products:create',
    update: 'products:update',
    remove: 'products:remove',
    restore: 'products:restore',
    setActive: 'products:setActive',
    loadDraft: 'products:loadDraft',
    saveDraft: 'products:saveDraft',
    clearDraft: 'products:clearDraft',
  },
  categories: {
    list: 'categories:list',
    create: 'categories:create',
    update: 'categories:update',
    remove: 'categories:remove',
    restore: 'categories:restore',
  },
  inventory: {
    listBatches: 'inventory:listBatches',
    concerns: 'inventory:concerns',
    receive: 'inventory:receive',
    adjust: 'inventory:adjust',
    repackage: 'inventory:repackage',
    returnToSupplier: 'inventory:returnToSupplier',
    loadRepackageDraft: 'inventory:loadRepackageDraft',
    saveRepackageDraft: 'inventory:saveRepackageDraft',
    clearRepackageDraft: 'inventory:clearRepackageDraft',
  },
  display: {
    show: 'display:show',
    hide: 'display:hide',
    isOpen: 'display:isOpen',
    publish: 'display:publish',
    getState: 'display:getState',
    /** Main to the display window: a new state. */
    state: 'display:state',
    /** Main to the main window: the display window opened or closed. */
    visibility: 'display:visibility',
  },
  printer: {
    settings: 'printer:settings',
    save: 'printer:save',
    getLogo: 'printer:getLogo',
    saveLogo: 'printer:saveLogo',
    removeLogo: 'printer:removeLogo',
    listUsb: 'printer:listUsb',
    testPrint: 'printer:testPrint',
    printOrder: 'printer:printOrder',
  },
  log: {
    write: 'log:write',
  },
  lan: {
    state: 'lan:state',
    setEnabled: 'lan:setEnabled',
    devices: 'lan:devices',
    newPairing: 'lan:newPairing',
    revokeDevice: 'lan:revokeDevice',
  },
  dashboard: {
    get: 'dashboard:get',
  },
  tables: {
    columnOrders: 'tables:columnOrders',
    saveColumnOrder: 'tables:saveColumnOrder',
  },
  reports: {
    sales: 'reports:sales',
    export: 'reports:export',
  },
  debug: {
    get: 'debug:get',
    setSaveImages: 'debug:setSaveImages',
    openReceiptsFolder: 'debug:openReceiptsFolder',
  },
  shell: {
    getCloseToTray: 'shell:getCloseToTray',
    setCloseToTray: 'shell:setCloseToTray',
    getLogsFolder: 'shell:getLogsFolder',
    openLogsFolder: 'shell:openLogsFolder',
  },
  data: {
    /** Main to renderer: these parts of the data changed (`DataDomain[]`). */
    changed: 'data:changed',
  },
  scanner: {
    /** Main to renderer: a barcode scan was detected. */
    scan: 'scanner:scan',
    setEnabled: 'scanner:setEnabled',
  },
  suppliers: {
    list: 'suppliers:list',
    create: 'suppliers:create',
    update: 'suppliers:update',
    remove: 'suppliers:remove',
    restore: 'suppliers:restore',
  },
  purchases: {
    concerns: 'purchases:concerns',
    list: 'purchases:list',
    get: 'purchases:get',
    create: 'purchases:create',
    update: 'purchases:update',
    receive: 'purchases:receive',
    pay: 'purchases:pay',
    cancel: 'purchases:cancel',
  },
  customers: {
    list: 'customers:list',
    create: 'customers:create',
    update: 'customers:update',
    remove: 'customers:remove',
    restore: 'customers:restore',
    account: 'customers:account',
    receivePayment: 'customers:receivePayment',
    interestDefaults: 'customers:interestDefaults',
    saveInterestDefaults: 'customers:saveInterestDefaults',
    alertCount: 'customers:alertCount',
    alertSettings: 'customers:alertSettings',
    saveAlertSettings: 'customers:saveAlertSettings',
  },
  orders: {
    list: 'orders:list',
    get: 'orders:get',
    idByNumber: 'orders:idByNumber',
    void: 'orders:void',
    refund: 'orders:refund',
  },
  auth: {
    status: 'auth:status',
    choices: 'auth:choices',
    signIn: 'auth:signIn',
    signOut: 'auth:signOut',
    changePin: 'auth:changePin',
  },
  users: {
    list: 'users:list',
    create: 'users:create',
    update: 'users:update',
    resetPin: 'users:resetPin',
    signInLog: 'users:signInLog',
  },
  checkout: {
    loadDraft: 'checkout:loadDraft',
    saveDraft: 'checkout:saveDraft',
    clearDraft: 'checkout:clearDraft',
    nextOrderNumber: 'checkout:nextOrderNumber',
    completeOrder: 'checkout:completeOrder',
  },
} as const;
