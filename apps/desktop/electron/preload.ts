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
    setActive: (ids, active) => ipcRenderer.invoke(CHANNELS.products.setActive, ids, active),
  },
  scanner: {
    onScan: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, scan: { code: string }): void => listener(scan);
      ipcRenderer.on(CHANNELS.scanner.scan, handler);
      return () => ipcRenderer.removeListener(CHANNELS.scanner.scan, handler);
    },
    setEnabled: (enabled) => ipcRenderer.invoke(CHANNELS.scanner.setEnabled, enabled),
  },
  checkout: {
    loadDraft: () => ipcRenderer.invoke(CHANNELS.checkout.loadDraft),
    saveDraft: (draft) => ipcRenderer.invoke(CHANNELS.checkout.saveDraft, draft),
    clearDraft: () => ipcRenderer.invoke(CHANNELS.checkout.clearDraft),
  },
};

contextBridge.exposeInMainWorld('micropos', api);
