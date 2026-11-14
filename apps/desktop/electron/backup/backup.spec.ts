import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { employees } from '../db/schema';
import { createDatabase, SOURCE_MIGRATIONS_FOLDER, type AppDatabase } from '../db';
import { applyPendingImport, autoBackup, backupFileName, checkDatabaseFile, createBackup, csvCell, deleteBackup, exportCsv, exportDatabase, isBackupName, listBackups, pendingImportFile, stageImport } from './backup';

let dir: string;
let dbFile: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;

const folder = (): string => path.join(dir, 'backups');
const names = (): string[] => db.select().from(employees).all().map((e) => e.name).sort();
const add = (name: string): void => {
  db.insert(employees).values({ name, employeeNumber: name, role: 'cashier', pinHash: 'x' }).run();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-backup-'));
  dbFile = path.join(dir, 'micropos.db');
  handle = createDatabase(dbFile, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  try {
    handle.close();
  } catch {
    /* already closed */
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('backups', () => {
  it('names a backup by kind and time, and only such names are accepted', () => {
    const at = new Date(2026, 10, 14, 9, 5, 7).getTime();
    expect(backupFileName('manual', at)).toBe('micropos-manual-20261114-090507.db');
    expect(isBackupName('micropos-auto-20261114-090507.db')).toBe(true);
    for (const bad of ['../micropos-manual-20261114-090507.db', 'micropos.db', 'micropos-other-20261114-090507.db', 5, null]) expect(isBackupName(bad)).toBe(false);
  });

  it('makes a backup that holds the data, lists it, and deletes it', async () => {
    add('Ana');
    const info = await createBackup(db, folder(), 'manual', 1_700_000_000_000);
    expect(info).toMatchObject({ kind: 'manual' });
    expect(info.size).toBeGreaterThan(0);
    expect(listBackups(folder()).map((b) => b.name)).toEqual([info.name]);
    expect(checkDatabaseFile(path.join(folder(), info.name), SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: true });
    expect(deleteBackup(folder(), info.name)).toBe(true);
    expect(listBackups(folder())).toEqual([]);
    expect(deleteBackup(folder(), '../micropos.db')).toBe(false);
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  it('gives a second backup in the same second its own name', async () => {
    const a = await createBackup(db, folder(), 'manual', 1_700_000_000_000);
    const b = await createBackup(db, folder(), 'manual', 1_700_000_000_000);
    expect(a.name).not.toBe(b.name);
    expect(listBackups(folder())).toHaveLength(2);
  });

  it('ignores other files in the folder', async () => {
    fs.mkdirSync(folder(), { recursive: true });
    fs.writeFileSync(path.join(folder(), 'notes.txt'), 'hi');
    expect(listBackups(folder())).toEqual([]);
    expect(listBackups(path.join(dir, 'missing'))).toEqual([]);
  });

  it('makes one automatic backup a day and keeps the newest 14 automatic ones', async () => {
    const day = 24 * 60 * 60 * 1000;
    const start = 1_700_000_000_000;
    expect(await autoBackup(db, folder(), start)).not.toBeNull();
    expect(await autoBackup(db, folder(), start + day / 2)).toBeNull(); // too soon
    for (let i = 1; i <= 16; i += 1) await autoBackup(db, folder(), start + i * day);
    const auto = listBackups(folder()).filter((b) => b.kind === 'auto');
    expect(auto).toHaveLength(14);
    await createBackup(db, folder(), 'manual', start + 40 * day);
    expect(listBackups(folder()).filter((b) => b.kind === 'manual')).toHaveLength(1); // manual ones are never pruned
  });
});

describe('CSV export', () => {
  it('quotes cells, and defuses text a spreadsheet would run as a formula', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(1250)).toBe('1250');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes a file per table with a header, leaving out secrets, settings and device tokens', () => {
    add('Ana, the "boss"');
    const out = exportCsv(db, path.join(dir, 'csv'), new Date(2026, 10, 14, 9, 5, 7).getTime());
    expect(path.basename(out)).toBe('micropos-csv-20261114-090507');
    const files = fs.readdirSync(out);
    expect(files).toContain('employees.csv');
    expect(files).toContain('orders.csv');
    for (const skipped of ['settings.csv', 'lan_devices.csv', '__drizzle_migrations.csv']) expect(files).not.toContain(skipped);
    const text = fs.readFileSync(path.join(out, 'employees.csv'), 'utf8');
    expect(text.startsWith('﻿id,')).toBe(true);
    expect(text.split('\r\n')[0]).not.toContain('pin_hash');
    expect(text).toContain('"Ana, the ""boss"""');
  });
});

describe('export and import', () => {
  it('exports a copy that opens as a database with the same data', async () => {
    add('Ana');
    const out = path.join(dir, 'export.db');
    await exportDatabase(db, out);
    expect(fs.existsSync(`${out}.part`)).toBe(false);
    const copy = createDatabase(out);
    expect(copy.db.select().from(employees).all().map((e) => e.name)).toEqual(['Ana']);
    copy.close();
  });

  it('refuses a file that is not a MicroPOS database, and leaves nothing staged', () => {
    const junk = path.join(dir, 'junk.db');
    fs.writeFileSync(junk, 'not a database at all');
    expect(stageImport(junk, dbFile, SOURCE_MIGRATIONS_FOLDER)).toMatchObject({ ok: false });
    expect(fs.existsSync(pendingImportFile(dbFile))).toBe(false);

    const other = createDatabase(path.join(dir, 'other.db')); // a SQLite file without the app's tables
    other.db.$client.exec('CREATE TABLE t (a)');
    other.close();
    expect(stageImport(path.join(dir, 'other.db'), dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: false, error: 'This is not a MicroPOS database' });
    expect(stageImport(path.join(dir, 'missing.db'), dbFile, SOURCE_MIGRATIONS_FOLDER)).toMatchObject({ ok: false });
    expect(stageImport(dbFile, dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: false, error: 'That is the database in use' });
  });

  it('refuses a file from a newer version', () => {
    const newer = createDatabase(path.join(dir, 'newer.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    newer.db.$client.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('future', 9_999_999_999_999);
    newer.close();
    expect(stageImport(path.join(dir, 'newer.db'), dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: false, error: 'This file was made by a newer MicroPOS: update the app first' });
  });

  it('stages a good file, and puts it in place at the next start, replacing the old data', async () => {
    add('Old');
    const other = createDatabase(path.join(dir, 'other.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    other.db.insert(employees).values({ name: 'New', employeeNumber: 'n', role: 'cashier', pinHash: 'x' }).run();
    other.close();

    expect(stageImport(path.join(dir, 'other.db'), dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: true });
    expect(names()).toEqual(['Old']); // nothing changes until the restart
    expect(fs.existsSync(path.join(dir, 'other.db'))).toBe(true); // the source is left alone

    handle.close();
    expect(applyPendingImport(dbFile)).toBe(true);
    expect(fs.existsSync(pendingImportFile(dbFile))).toBe(false);
    handle = createDatabase(dbFile, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    db = handle.db;
    expect(names()).toEqual(['New']);
    expect(applyPendingImport(dbFile)).toBe(false);
  });
});
