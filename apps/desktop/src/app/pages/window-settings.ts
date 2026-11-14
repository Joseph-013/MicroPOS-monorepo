import { Component, inject, Injector, signal } from '@angular/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { DESKTOP_API } from '../core/api/desktop-api';
import { SettingRow, SettingsSection } from './settings-section';
import { BannerService } from '../core/banner';
import { nextRender } from '../core/ui/next-render';

/**
 * Settings > Window (needs `settings.manage`): whether closing the window hides it and keeps MicroPOS running in the
 * system tray, for background work (and, later, notifications), instead of quitting. Kept in the main process.
 * Quit MicroPOS closes it for real whatever that setting says (as Quit in the tray icon's menu), after asking.
 */
@Component({
  selector: 'app-window-settings',
  imports: [SettingRow, SettingsSection, HlmAlertDialogImports, HlmButtonImports, HlmSwitchImports],
  template: `
    <app-settings-section title="Window">
      <label appSetting="Keep running in the tray when closed" settingKeywords="background close minimize hide taskbar system tray" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
        <span>Keep running in the tray when closed</span>
        <hlm-switch aria-label="Keep running in the tray when closed" [checked]="closeToTray()" [disabled]="!loaded()" (checkedChange)="set($event)" />
      </label>
      <div appSetting="Quit MicroPOS" settingKeywords="quit exit close shut down stop end tray" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
        <span class="min-w-0">Quit MicroPOS</span>
        <button hlmBtn variant="outline" type="button" class="shrink-0 px-5" (click)="askingQuit.set(true)">Quit</button>
      </div>
    </app-settings-section>

    <hlm-alert-dialog [state]="askingQuit() ? 'open' : 'closed'" (closed)="askingQuit.set(false)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h3 hlmAlertDialogTitle>Quit MicroPOS?</h3>
          <p hlmAlertDialogDescription>MicroPOS closes completely, also from the tray. Phones and tablets connected to this till lose it until it is started again.</p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel type="button">Cancel</button>
          <button hlmAlertDialogAction variant="destructive" type="button" (click)="quit()">Quit</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class WindowSettings {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);
  private readonly injector = inject(Injector);

  protected readonly closeToTray = signal(false);
  protected readonly askingQuit = signal(false);
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

  protected async quit(): Promise<void> {
    try {
      await this.api!.shell.quit();
    } catch (error) {
      console.error('Failed to quit', error);
      this.banner.error('Could not quit MicroPOS', { key: 'quit' });
    }
  }

  protected async set(value: boolean): Promise<void> {
    const before = this.closeToTray();
    this.closeToTray.set(value);
    try {
      if (!(await this.api!.shell.setCloseToTray(value))) throw new Error('refused');
    } catch (error) {
      console.error('Failed to save the window setting', error);
      await nextRender(this.injector); // let the switch show the new value first, so putting it back is seen
      this.closeToTray.set(before);
      this.banner.error('Could not save the setting', { key: 'window-setting' });
    }
  }
}
