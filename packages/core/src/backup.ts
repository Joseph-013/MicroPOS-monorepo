/** Backing up, exporting and importing the till's database. */

/** Why a backup was made: by hand, by the daily schedule, or automatically just before an import replaced the data. */
export type BackupKind = 'manual' | 'auto' | 'before-import';

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  manual: 'Manual',
  auto: 'Automatic',
  'before-import': 'Before an import',
};

/** A backup kept in the app's backups folder. */
export interface BackupInfo {
  /** The file's name; what the other calls take. */
  name: string;
  kind: BackupKind;
  /** Size in bytes. */
  size: number;
  /** When it was made (milliseconds since 1970). */
  createdAt: number;
}

export interface BackupList {
  /** Newest first. */
  backups: BackupInfo[];
  /** Where they are kept. */
  folder: string;
}

export type BackupResult = { ok: true; backup: BackupInfo } | { ok: false; error: string };

/** Exporting asks for a place to save the file; closing that dialog is `canceled`, not an error. */
export type ExportDatabaseResult = { ok: true; savedTo: string } | { ok: false; canceled?: boolean; error: string };

/** Importing or restoring checks the file, makes a backup of the current data, then restarts the app with the file in place. */
export type ImportDatabaseResult = { ok: true } | { ok: false; canceled?: boolean; error: string };

/** One automatic backup a day, and this many of them are kept (older ones are deleted). */
export const AUTO_BACKUPS_KEPT = 14;
