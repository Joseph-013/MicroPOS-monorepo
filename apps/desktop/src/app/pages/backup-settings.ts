import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { BACKUP_KIND_LABELS, type BackupInfo, type BackupList } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';
import { SettingRow, SettingsSection } from './settings-section';

/** What a confirmation is about: the whole database is replaced either by a file the person picks or by one of the kept backups. */
type Replacement = { kind: 'file' } | { kind: 'backup'; backup: BackupInfo };

/**
 * Settings > Backup (needs `settings.manage`): back up the database now (copies are kept in the backups folder, and one is
 * made every day), export a copy to a chosen place, and import a database file or restore a kept backup. Importing replaces
 * all data, so it asks first, backs up what is there, and restarts the app.
 */
@Component({
  selector: 'app-backup-settings',
  imports: [DatePipe, SettingRow, SettingsSection, HlmAlertDialogImports, HlmButtonImports],
  template: `
    <app-settings-section title="Backup">
      <div appSetting="Backups" settingKeywords="backup copy restore automatic daily folder database data" class="grid gap-3 py-1">
        <p class="text-muted-foreground text-sm">A backup is made every day and the last 14 are kept. The list below holds them all.</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="!folder()" (click)="openFolder()">Open folder</button>
          <button hlmBtn type="button" class="px-5" [disabled]="busy()" (click)="create()">Back up now</button>
        </div>
        @if (backups().length) {
          <div class="border-border max-h-72 overflow-y-auto border" data-backup-list>
            @for (backup of backups(); track backup.name) {
              <div class="border-border flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2 text-sm last:border-b-0">
                <div class="min-w-0">
                  <div class="truncate">{{ backup.createdAt | date: 'MMM d, y, h:mm a' }}</div>
                  <div class="text-muted-foreground truncate">{{ kindLabel(backup) }} · {{ size(backup.size) }}</div>
                </div>
                <div class="flex shrink-0 gap-2">
                  <button hlmBtn variant="outline" size="sm" type="button" [disabled]="busy()" [attr.aria-label]="'Restore the backup of ' + backup.name" (click)="asking.set({ kind: 'backup', backup })">Restore</button>
                  <button hlmBtn variant="outline" size="sm" type="button" [disabled]="busy()" [attr.aria-label]="'Delete the backup of ' + backup.name" (click)="remove(backup)">Delete</button>
                </div>
              </div>
            }
          </div>
        } @else {
          <p class="text-muted-foreground text-sm">{{ loaded() ? 'No backups yet' : 'Loading…' }}</p>
        }
      </div>

      <div appSetting="Export and import" settingKeywords="export import database file move transfer another computer" class="grid gap-3 py-1">
        <p class="text-muted-foreground text-sm">Export saves a copy of all data as one file, for another computer or safekeeping. Import replaces all data here with such a file (or a backup).</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="busy()" (click)="exportDatabase()">Export database</button>
          <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="busy()" (click)="asking.set({ kind: 'file' })">Import database</button>
        </div>
      </div>
    </app-settings-section>

    <hlm-alert-dialog [state]="asking() ? 'open' : 'closed'" (closed)="asking.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h3 hlmAlertDialogTitle>{{ asking()?.kind === 'file' ? 'Import a database?' : 'Restore this backup?' }}</h3>
          <p hlmAlertDialogDescription>
            All sales, stock, customers, users and settings here are replaced{{ asking()?.kind === 'file' ? ' by the file you choose' : ' by the backup' }}. What is here now is backed up first, and MicroPOS restarts. Everyone is signed out.
          </p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel type="button">Cancel</button>
          <button hlmAlertDialogAction variant="destructive" type="button" (click)="replace()">{{ asking()?.kind === 'file' ? 'Choose a file' : 'Restore' }}</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class BackupSettings implements OnInit {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);

  protected readonly backups = signal<BackupInfo[]>([]);
  protected readonly folder = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly asking = signal<Replacement | null>(null);

  ngOnInit(): void {
    void this.refresh();
  }

  protected kindLabel(backup: BackupInfo): string {
    return BACKUP_KIND_LABELS[backup.kind];
  }

  protected size(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private async refresh(): Promise<void> {
    if (!this.api) {
      this.loaded.set(true);
      return;
    }
    try {
      const list: BackupList = await this.api!.backup.list();
      this.backups.set(list.backups);
      this.folder.set(list.folder);
    } catch (error) {
      console.error('Failed to list the backups', error);
    }
    this.loaded.set(true);
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await this.api!.backup.create();
      if (result.ok) this.banner.success('Backup made', { key: 'backup' });
      else this.banner.error(`Could not back up: ${result.error}`, { key: 'backup' });
    } catch {
      this.banner.error('Could not back up', { key: 'backup' });
    }
    this.busy.set(false);
    await this.refresh();
  }

  protected async remove(backup: BackupInfo): Promise<void> {
    this.busy.set(true);
    try {
      if (!(await this.api!.backup.remove(backup.name))) this.banner.error('Could not delete that backup', { key: 'backup' });
    } catch {
      this.banner.error('Could not delete that backup', { key: 'backup' });
    }
    this.busy.set(false);
    await this.refresh();
  }

  protected async openFolder(): Promise<void> {
    try {
      if (!(await this.api!.backup.openFolder())) throw new Error('not opened');
    } catch {
      this.banner.error('Could not open the backups folder', { key: 'backup' });
    }
  }

  protected async exportDatabase(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await this.api!.backup.exportTo();
      if (result.ok) this.banner.success(`Saved to ${result.savedTo}`, { key: 'backup' });
      else if (!result.canceled) this.banner.error(`Could not export: ${result.error}`, { key: 'backup' });
    } catch {
      this.banner.error('Could not export', { key: 'backup' });
    }
    this.busy.set(false);
  }

  /** After the question: asks for a file (or restores the backup), and when it is good the app restarts by itself. */
  protected async replace(): Promise<void> {
    const what = this.asking();
    this.asking.set(null);
    if (!what) return;
    this.busy.set(true);
    try {
      const result = await (what.kind === 'file' ? this.api!.backup.importFrom() : this.api!.backup.restore(what.backup.name));
      if (result.ok) {
        this.banner.info('Data replaced: restarting…', { key: 'backup', duration: 'persistent', dismissible: false });
        return; // the app restarts: leave the buttons off
      }
      if (!result.canceled) this.banner.error(result.error, { key: 'backup' });
    } catch {
      this.banner.error('Could not import', { key: 'backup' });
    }
    this.busy.set(false);
  }
}
