/**
 * IPC channel names, shared by the main process and the preload script.
 * Convention: `<area>:<action>`. Every channel is a request/response (`invoke`/`handle`).
 */
/** Must equal `DESKTOP_API_VERSION` in @micropos/core (a test checks); bump both when the contract changes. */
export const API_VERSION = 3;

export const CHANNELS = {
  app: {
    version: 'app:version',
  },
  catalog: {
    listProducts: 'catalog:listProducts',
    listCategories: 'catalog:listCategories',
  },
  checkout: {
    loadDraft: 'checkout:loadDraft',
    saveDraft: 'checkout:saveDraft',
    clearDraft: 'checkout:clearDraft',
  },
} as const;
