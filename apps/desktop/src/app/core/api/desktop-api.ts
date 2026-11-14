import { InjectionToken } from '@angular/core';
import type { DesktopApi } from '@micropos/core';
import { createRemoteApi, isLanDevice } from './remote-api';

declare global {
  interface Window {
    /** Exposed by the Electron preload script; absent when the app runs in a plain browser. */
    micropos?: DesktopApi;
  }
}

/** The bridge to the Electron main process (and its SQLite database), or to the till over the network on a paired device. Provide a fake in tests. */
export const DESKTOP_API = new InjectionToken<DesktopApi | undefined>('DESKTOP_API', {
  providedIn: 'root',
  // The Electron window's preload, or (opened from the till's address on a phone) the same calls over the network.
  factory: () => window.micropos ?? (isLanDevice() ? createRemoteApi() : undefined),
});
