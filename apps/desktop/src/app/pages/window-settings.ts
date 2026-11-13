import { Component, inject, signal } from '@angular/core';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';

/**
 * Settings > Window (needs `settings.manage`): whether closing the window hides it and keeps MicroPOS running in the
 * system tray, for background work (and, later, notifications), instead of quitting. Kept in the main process.
 */
@Component({
  selector: 'app-window-settings',
  imports: [HlmCardImports, HlmSwitchImports],
  template: `
    <section hlmCard class="mt-3 max-w-xl">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Window</h2>
      </div>
      <div hlmCardContent>
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>Keep running in the tray when closed</span>
          <hlm-switch aria-label="Keep running in the tray when closed" [checked]="closeToTray()" [disabled]="!loaded()" (checkedChange)="set($event)" />
        </label>
      </div>
    </section>
  `,
})
export class WindowSettings {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);

  protected readonly closeToTray = signal(false);
  protected readonly loaded = signal(false);

  constructor() {
    void this.api?.shell
      .getCloseToTray()
      .then((value) => {
        this.closeToTray.set(value);
        this.loaded.set(true);
      })
      .catch((error) => console.error('Failed to read the window setting', error));
  }

  protected async set(value: boolean): Promise<void> {
    const before = this.closeToTray();
    this.closeToTray.set(value);
    try {
      if (!(await this.api!.shell.setCloseToTray(value))) throw new Error('refused');
    } catch (error) {
      console.error('Failed to save the window setting', error);
      this.closeToTray.set(before);
      this.banner.error('Could not save the setting', { key: 'window-setting' });
    }
  }
}
