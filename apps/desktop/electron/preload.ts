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
  checkout: {
    loadDraft: () => ipcRenderer.invoke(CHANNELS.checkout.loadDraft),
    saveDraft: (draft) => ipcRenderer.invoke(CHANNELS.checkout.saveDraft, draft),
    clearDraft: () => ipcRenderer.invoke(CHANNELS.checkout.clearDraft),
  },
};

contextBridge.exposeInMainWorld('micropos', api);
