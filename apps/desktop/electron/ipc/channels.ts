/**
 * IPC channel names, shared by the main process and the preload script.
 * Convention: `<area>:<action>`. Every channel is a request/response (`invoke`/`handle`).
 */
/** Must equal `DESKTOP_API_VERSION` in @micropos/core (a test checks); bump both when the contract changes. */
export const API_VERSION = 16;

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
  scanner: {
    /** Main to renderer: a barcode scan was detected. */
    scan: 'scanner:scan',
    setEnabled: 'scanner:setEnabled',
  },
  checkout: {
    loadDraft: 'checkout:loadDraft',
    saveDraft: 'checkout:saveDraft',
    clearDraft: 'checkout:clearDraft',
  },
} as const;
