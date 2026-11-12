/**
 * IPC channel names, shared by the main process and the preload script.
 * Convention: `<area>:<action>`. Every channel is a request/response (`invoke`/`handle`).
 */
export const CHANNELS = {
  catalog: {
    listProducts: 'catalog:listProducts',
    listCategories: 'catalog:listCategories',
  },
} as const;
