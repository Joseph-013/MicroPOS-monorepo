import { inject, Service } from '@angular/core';
import { DESKTOP_API_VERSION } from '@micropos/core';
import { BannerService } from '../banner';
import { DESKTOP_API } from './desktop-api';

/**
 * Checks, once at startup, that the Electron main process speaks the same contract version as this page.
 * During development the page hot-reloads but the main process keeps running old code until the app is
 * restarted, which makes calls fail or lose data in confusing ways; this turns that into a clear message.
 */
@Service()
export class DesktopApiGuard {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);

  /** Resolves true when the versions match (or there is no bridge to check, e.g. a plain browser). */
  async check(): Promise<boolean> {
    if (!this.api) return true;
    let version: number | null = null;
    try {
      version = (await this.api.version?.()) ?? null; // an old preload has no `version`; an old main has no handler
    } catch {
      version = null;
    }
    if (version === DESKTOP_API_VERSION) return true;
    console.error(`Desktop API version mismatch: page expects ${DESKTOP_API_VERSION}, main process reports ${version ?? 'none'}`);
    this.banner.error('The app is out of date. Restart it to continue.', { duration: 'persistent', key: 'api-version', dismissible: false });
    return false;
  }
}
