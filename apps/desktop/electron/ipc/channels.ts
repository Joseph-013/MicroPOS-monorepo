/**
 * IPC channel names, shared by the main process and the preload script.
 * Convention: `<area>:<action>`. Every channel is a request/response (`invoke`/`handle`).
 */
/** Must equal `DESKTOP_API_VERSION` in @micropos/core (a test checks); bump both when the contract changes. */
export const API_VERSION = 28;

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
    overview: 'inventory:overview',
    receive: 'inventory:receive',
    adjust: 'inventory:adjust',
    repackage: 'inventory:repackage',
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
  },
  orders: {
    list: 'orders:list',
    get: 'orders:get',
    void: 'orders:void',
    refund: 'orders:refund',
  },
  checkout: {
    loadDraft: 'checkout:loadDraft',
    saveDraft: 'checkout:saveDraft',
    clearDraft: 'checkout:clearDraft',
    nextOrderNumber: 'checkout:nextOrderNumber',
    completeOrder: 'checkout:completeOrder',
  },
} as const;
