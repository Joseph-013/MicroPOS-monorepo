import { contextBridge } from 'electron';

// Expose a minimal, typed API to the renderer. Add IPC wrappers here
// (e.g. database access) rather than enabling nodeIntegration.
contextBridge.exposeInMainWorld('micropos', {
  platform: process.platform,
});
