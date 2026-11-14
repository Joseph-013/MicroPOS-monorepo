import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow, dialog, shell } from 'electron';
import { type BackupList, type BackupResult, type ExportDatabaseResult, type ImportDatabaseResult } from '@micropos/core';
import type { AppDatabase } from '../db';
import { log } from '../logging';
import { cancelImport, createBackup, deleteBackup, exportDatabase, isBackupName, listBackups, stageImport } from './backup';

export interface BackupServiceOptions {
  db: AppDatabase;
  /** The database file in use. */
  dbFile: string;
  /** Where backups are kept. */
  folder: string;
  migrationsFolder: string;
  /** Restarts the app (so the staged file is put in place before the database opens). */
  restart: () => void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What the Backup settings call: backups kept in a folder, export to a chosen file, import from one. */
export class BackupService {
  constructor(private readonly options: BackupServiceOptions) {}

  list(): BackupList {
    return { backups: listBackups(this.options.folder), folder: this.options.folder };
  }

  async create(): Promise<BackupResult> {
    try {
      const backup = await createBackup(this.options.db, this.options.folder, 'manual');
      log.info('backup', `Backed up to ${backup.name}`);
      return { ok: true, backup };
    } catch (error) {
      log.error('backup', 'Could not make a backup', error);
      return { ok: false, error: message(error) };
    }
  }

  remove(name: unknown): boolean {
    return deleteBackup(this.options.folder, name);
  }

  async exportTo(parent: BrowserWindow | null): Promise<ExportDatabaseResult> {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const dialogOptions = { defaultPath: path.join(app.getPath('documents'), `micropos-${stamp}.db`), filters: [{ name: 'MicroPOS database', extensions: ['db'] }] };
      const result = parent ? await dialog.showSaveDialog(parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
      if (result.canceled || !result.filePath) return { ok: false, canceled: true, error: 'Canceled' };
      await exportDatabase(this.options.db, result.filePath);
      log.info('backup', `Exported the database to ${result.filePath}`);
      return { ok: true, savedTo: result.filePath };
    } catch (error) {
      log.error('backup', 'Could not export the database', error);
      return { ok: false, error: message(error) };
    }
  }

  async importFrom(parent: BrowserWindow | null): Promise<ImportDatabaseResult> {
    const dialogOptions = { title: 'Choose a MicroPOS database', properties: ['openFile' as const], filters: [{ name: 'MicroPOS database', extensions: ['db'] }, { name: 'All files', extensions: ['*'] }] };
    const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false, canceled: true, error: 'Canceled' };
    return this.replaceWith(file);
  }

  restore(name: unknown): Promise<ImportDatabaseResult> | ImportDatabaseResult {
    if (!isBackupName(name) || !listBackups(this.options.folder).some((b) => b.name === name)) return { ok: false, error: 'That backup is gone' };
    return this.replaceWith(path.join(this.options.folder, name));
  }

  async openFolder(): Promise<boolean> {
    try {
      const { folder } = this.options;
      fs.mkdirSync(folder, { recursive: true });
      return (await shell.openPath(folder)) === '';
    } catch {
      return false;
    }
  }

  /** Checks and stages the file, backs up what is there now, then restarts: the file becomes the database. */
  private async replaceWith(file: string): Promise<ImportDatabaseResult> {
    const { db, dbFile, folder, migrationsFolder, restart } = this.options;
    const staged = stageImport(file, dbFile, migrationsFolder);
    if (!staged.ok) return staged;
    try {
      await createBackup(db, folder, 'before-import');
    } catch (error) {
      cancelImport(dbFile);
      log.error('backup', 'Could not back up before importing', error);
      return { ok: false, error: `Could not back up the current data first: ${message(error)}` };
    }
    log.info('backup', `Importing ${file}: restarting`);
    setTimeout(restart, 400); // the answer reaches the page first
    return { ok: true };
  }
}
