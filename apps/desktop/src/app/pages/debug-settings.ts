import { Component, inject, Injector, signal } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';
import { nextRender } from '../core/ui/next-render';
import { SettingRow, SettingsSection } from './settings-section';

/**
 * Settings > Debug (needs `settings.manage`): aids for testing without the real hardware. For now, saving each receipt
 * as an image in the Downloads folder instead of sending it to the printer, so the layout can be checked on screen.
 */
@Component({
  selector: 'app-debug-settings',
  imports: [SettingRow, SettingsSection, HlmButtonImports, HlmSwitchImports],
  template: `
    <app-settings-section title="Debug">
      <label appSetting="Save receipts as images" settingKeywords="debug test receipt printer png picture downloads preview no printer" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
        <span class="min-w-0">Save receipts as images</span>
        <hlm-switch aria-label="Save receipts as images" [checked]="saveImages()" [disabled]="!loaded()" (checkedChange)="set($event)" />
      </label>
      <div appSetting="Receipt images folder" settingKeywords="debug downloads open path" class="grid gap-3 py-1">
        <p class="text-muted-foreground min-w-0 text-sm break-all select-text" data-receipts-folder>{{ folder() ?? 'Not available' }}</p>
        <div class="flex justify-end">
          <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="!folder()" (click)="open()">Open folder</button>
        </div>
      </div>
    </app-settings-section>
  `,
})
export class DebugSettings {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);
  private readonly injector = inject(Injector);
  protected readonly saveImages = signal(false);
  protected readonly folder = signal<string | null>(null);
  protected readonly loaded = signal(false);

  constructor() {
    void this.api?.debug
      .get()
      .then((debug) => {
        this.saveImages.set(debug.saveImages);
        this.folder.set(debug.folder);
        this.loaded.set(true);
      })
      .catch((error) => console.error('Failed to read the debug settings', error));
  }

  protected async set(value: boolean): Promise<void> {
    const before = this.saveImages();
    this.saveImages.set(value);
    try {
      if (!(await this.api!.debug.setSaveImages(value))) throw new Error('refused');
    } catch (error) {
      console.error('Failed to save the debug setting', error);
      await nextRender(this.injector); // let the switch show the new value first, so putting it back is seen
      this.saveImages.set(before);
      this.banner.error('Could not save the setting', { key: 'debug-setting' });
    }
  }

  protected async open(): Promise<void> {
    try {
      if (!(await this.api!.debug.openReceiptsFolder())) throw new Error('not opened');
    } catch {
      this.banner.error('Could not open the folder', { key: 'debug-setting' });
    }
  }
}
