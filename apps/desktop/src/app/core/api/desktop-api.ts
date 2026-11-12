import { InjectionToken } from '@angular/core';
import type { DesktopApi } from '@micropos/core';

declare global {
  interface Window {
    /** Exposed by the Electron preload script; absent when the app runs in a plain browser. */
    micropos?: DesktopApi;
  }
}

/** The bridge to the Electron main process (and its SQLite database). Provide a fake in tests. */
export const DESKTOP_API = new InjectionToken<DesktopApi | undefined>('DESKTOP_API', {
  providedIn: 'root',
  factory: () => window.micropos,
});
