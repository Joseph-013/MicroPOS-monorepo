import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AUTO_BACKUPS_KEPT, type BackupInfo, type BackupKind } from '@micropos/core';
import { type AppDatabase, createDatabase } from '../db';

/*
 * Backups of the SQLite file. Taking one uses SQLite's own online backup (a consistent copy while the till keeps working,
 * WAL included). Putting one back cannot happen under the open database, so an import is *staged* (checked, and copied
 * next to the database as `<db>.import`) and the app restarts; `applyPendingImport` swaps it in before the database opens.
 * Everything here takes plain paths, so it is tested without Electron.
 */

const FILE = /^micropos-(manual|auto|before-import)-(\d{8}-\d{6})\.db$/;

const pad = (n: number): string => String(n).padStart(2, '0');
function stamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** The file name of a backup: `micropos-<kind>-<yyyymmdd-hhmmss>.db`. */
export const backupFileName = (kind: BackupKind, at: number): string => `micropos-${kind}-${stamp(at)}.db`;

/** Names of this shape only: nothing else in the folder is listed, and no other name is ever opened or deleted (no paths). */
export const isBackupName = (name: unknown): name is string => typeof name === 'string' && FILE.test(name);

function describe(folder: string, name: string): BackupInfo | null {
  const m = FILE.exec(name);
  if (!m) return null;
  try {
    const stat = fs.statSync(path.join(folder, name));
    // The time is the one in the name (local time, to the second), so copying or touching the file does not change it.
    const t = m[2]!;
    const createdAt = new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13), +t.slice(13, 15)).getTime();
    return stat.isFile() ? { name, kind: m[1] as BackupKind, size: stat.size, createdAt } : null;
  } catch {
    return null;
  }
}

/** The backups in the folder, newest first. */
export function listBackups(folder: string): BackupInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .map((name) => describe(folder, name))
    .filter((info): info is BackupInfo => info !== null)
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

/** Makes a backup of the open database in the folder; a second one in the same second gets the next free name. */
export async function createBackup(db: AppDatabase, folder: string, kind: BackupKind, now = Date.now()): Promise<BackupInfo> {
  fs.mkdirSync(folder, { recursive: true });
  let at = now;
  while (fs.existsSync(path.join(folder, backupFileName(kind, at)))) at += 1000;
  const name = backupFileName(kind, at);
  const file = path.join(folder, name);
  try {
    await db.$client.backup(file);
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  const info = describe(folder, name);
  if (!info) throw new Error('The backup was not written');
  return info;
}

/** Saves a copy of the open database at `file` (replacing what is there). */
export async function exportDatabase(db: AppDatabase, file: string): Promise<void> {
  const part = `${file}.part`;
  try {
    await db.$client.backup(part);
    fs.renameSync(part, file);
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw error;
  }
}

/** Tables left out of a CSV export: the schema's bookkeeping, paired-device tokens and settings (drafts, printer and window state). */
const CSV_SKIP_TABLES = new Set(['__drizzle_migrations', 'lan_devices', 'settings']);
/** Columns left out: secrets. */
const CSV_SKIP_COLUMNS = new Set(['pin_hash', 'token_hash']);

/** One CSV cell: quoted when it has a comma, quote or line break; a text that a spreadsheet would run as a formula gets a leading apostrophe. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined || Buffer.isBuffer(value)) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Writes every table of the open database as `<table>.csv` (a header row, then the rows; dates and times are the stored
 * milliseconds, money is cents) in a new folder `micropos-csv-<time>` inside `parent`, and returns that folder. The file
 * starts with a byte-order mark so Excel reads the text as UTF-8.
 */
export function exportCsv(db: AppDatabase, parent: string, now = Date.now()): string {
  const out = path.join(parent, `micropos-csv-${stamp(now)}`);
  fs.mkdirSync(out, { recursive: true });
  const tables = db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  for (const { name } of tables) {
    if (CSV_SKIP_TABLES.has(name)) continue;
    const columns = (db.$client.pragma(`table_info("${name}")`) as { name: string }[]).map((c) => c.name).filter((c) => !CSV_SKIP_COLUMNS.has(c));
    const lines = [columns.map(csvCell).join(',')];
    const select = db.$client.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${name}"`);
    for (const row of select.iterate() as Iterable<Record<string, unknown>>) lines.push(columns.map((c) => csvCell(row[c])).join(','));
    fs.writeFileSync(path.join(out, `${name}.csv`), `﻿${lines.join('\r\n')}\r\n`, 'utf8');
  }
  return out;
}

export function deleteBackup(folder: string, name: unknown): boolean {
  if (!isBackupName(name) || !describe(folder, name)) return false;
  fs.rmSync(path.join(folder, name));
  return true;
}

/** Makes the daily automatic backup when the last backup of any kind is over a day old, then deletes automatic ones beyond the newest `AUTO_BACKUPS_KEPT`. Returns the new backup, if one was made. */
export async function autoBackup(db: AppDatabase, folder: string, now = Date.now()): Promise<BackupInfo | null> {
  const [latest] = listBackups(folder);
  let made: BackupInfo | null = null;
  if (!latest || now - latest.createdAt >= 24 * 60 * 60 * 1000) made = await createBackup(db, folder, 'auto', now);
  for (const old of listBackups(folder).filter((b) => b.kind === 'auto').slice(AUTO_BACKUPS_KEPT)) deleteBackup(folder, old.name);
  return made;
}

/** The migrations the app knows (the journal's entries). */
/** When each migration this app knows was made (the journal's `when`, which the migrator stores as `created_at`), in order. */
function knownMigrations(migrationsFolder: string): number[] {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: { when: number }[] };
  return journal.entries.map((e) => e.when);
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Whether `file` is a MicroPOS database this version can open: a healthy SQLite file with the app's tables whose
 * migration history is the start of this app's own (an older or the same version). A newer version's file has
 * migrations this app does not know; a file whose history differs (another branch, or from before the history was
 * squashed) would be migrated wrongly, so both are refused. Migrations are compared by when they were made, not by
 * their hash, which changes with the line endings of the checkout that built the app. Opens a read-write handle, so
 * give it a copy, never the live file.
 */
export function checkDatabaseFile(file: string, migrationsFolder: string): { ok: true } | { ok: false; error: string } {
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(file, { fileMustExist: true });
    const rows = sqlite.pragma('integrity_check') as { integrity_check: string }[];
    if (rows.length !== 1 || rows[0]!.integrity_check !== 'ok') return { ok: false, error: 'The file is damaged' };
    const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    if (!tables.has('employees') || !tables.has('__drizzle_migrations')) return { ok: false, error: 'This is not a MicroPOS database' };
    const applied = (sqlite.prepare('SELECT created_at AS at FROM __drizzle_migrations ORDER BY created_at').all() as { at: number | string }[]).map((r) => Number(r.at));
    const known = knownMigrations(migrationsFolder);
    const latest = known[known.length - 1] ?? 0;
    if (applied.length > known.length || applied.some((at) => at > latest)) return { ok: false, error: 'This file was made by a newer MicroPOS: update the app first' };
    if (applied.some((at, i) => at !== known[i])) return { ok: false, error: 'This file comes from a MicroPOS version this one cannot read' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'This is not a MicroPOS database' };
  } finally {
    sqlite?.close();
  }
}

/**
 * Brings a checked copy up to this version (the migrations an older file lacks, and the foreign key check that follows
 * them) so a file that cannot be upgraded is refused now, with the reason, instead of failing the next start. Leaves a
 * single file (no -wal or -shm).
 */
function upgradeCopy(file: string, migrationsFolder: string): { ok: true } | { ok: false; error: string } {
  try {
    const handle = createDatabase(file, { migrationsFolder });
    try {
      handle.db.$client.pragma('journal_mode = DELETE');
    } finally {
      handle.close();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `This file could not be brought up to this version of MicroPOS: ${message(error)}` };
  }
}

export const pendingImportFile = (dbFile: string): string => `${dbFile}.import`;

/**
 * Checks `source` and stages it to be the database at the next start: copied to `<db>.import` and verified there, so the
 * live database and the source file are never touched. Does nothing but report when the file is not usable.
 */
export function stageImport(source: string, dbFile: string, migrationsFolder: string): { ok: true } | { ok: false; error: string } {
  const staged = pendingImportFile(dbFile);
  try {
    if (path.resolve(source) === path.resolve(dbFile)) return { ok: false, error: 'That is the database in use' };
    fs.copyFileSync(source, staged);
    // A backup copied while the till ran can still ask for its -wal file; a plain copy has none, which is fine.
    let checked = checkDatabaseFile(staged, migrationsFolder);
    if (checked.ok) checked = upgradeCopy(staged, migrationsFolder);
    for (const extra of ['-wal', '-shm']) fs.rmSync(staged + extra, { force: true });
    if (!checked.ok) fs.rmSync(staged, { force: true });
    return checked;
  } catch (error) {
    fs.rmSync(staged, { force: true });
    return { ok: false, error: message(error) };
  }
}

/** Drops a staged import (the app is not restarting after all). */
export function cancelImport(dbFile: string): void {
  fs.rmSync(pendingImportFile(dbFile), { force: true });
}

const DB_PARTS = ['', '-wal', '-shm'];

/** Where the database an import replaced waits until the imported one has opened. */
export const replacedFile = (dbFile: string): string => `${dbFile}.replaced`;

/**
 * At startup, before the database is opened: puts a staged import in place of the database. The database it replaces
 * (with its -wal and -shm) is moved aside, not deleted, until the imported one has opened (`finishImport`), so a file
 * that will not open can be undone (`rollbackImport`). Returns whether it did.
 */
export function applyPendingImport(dbFile: string): boolean {
  const staged = pendingImportFile(dbFile);
  if (!fs.existsSync(staged)) return false;
  const aside = replacedFile(dbFile);
  for (const part of DB_PARTS) fs.rmSync(aside + part, { force: true });
  for (const part of DB_PARTS) if (fs.existsSync(dbFile + part)) fs.renameSync(dbFile + part, aside + part);
  fs.renameSync(staged, dbFile);
  return true;
}

/** The imported database opened: the one it replaced is dropped (a before-import backup of it is kept in the backups folder). */
export function finishImport(dbFile: string): void {
  for (const part of DB_PARTS) fs.rmSync(replacedFile(dbFile) + part, { force: true });
}

/** The imported database would not open: puts back the one it replaced. Returns whether there was one to put back. */
export function rollbackImport(dbFile: string): boolean {
  const aside = replacedFile(dbFile);
  if (!fs.existsSync(aside)) return false;
  for (const part of DB_PARTS) fs.rmSync(dbFile + part, { force: true });
  for (const part of DB_PARTS) if (fs.existsSync(aside + part)) fs.renameSync(aside + part, dbFile + part);
  return true;
}
