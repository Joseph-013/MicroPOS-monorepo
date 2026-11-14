import { Component, inject, signal } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { DESKTOP_API } from '../core/api/desktop-api';
import { SettingRow, SettingsSection } from './settings-section';
import { BannerService } from '../core/banner';

/** Settings > Logs (needs `settings.manage`): where the log files are, and a button that opens that folder to copy or send them. */
@Component({
  selector: 'app-logs-settings',
  imports: [SettingRow, SettingsSection, HlmButtonImports],
  template: `
    <app-settings-section title="Logs">
      <div appSetting="Logs folder" settingKeywords="log errors files open path support" class="grid gap-3">
        <p class="text-muted-foreground min-w-0 text-sm break-all select-text" data-logs-folder>{{ folder() ?? 'Not available' }}</p>
        <div class="flex justify-end">
          <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="!folder()" (click)="open()">Open folder</button>
        </div>
      </div>
    </app-settings-section>
  `,
})
export class LogsSettings {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);
  protected readonly folder = signal<string | null>(null);

  constructor() {
    void this.api?.shell.getLogsFolder().then((dir) => this.folder.set(dir)).catch((error) => console.error('Failed to read the logs folder', error));
  }

  protected async open(): Promise<void> {
    try {
      if (!(await this.api!.shell.openLogsFolder())) throw new Error('not opened');
    } catch {
      this.banner.error('Could not open the logs folder', { key: 'logs-open' });
    }
  }
}
