import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { employees } from '../db/schema';
import { createDatabase, SOURCE_MIGRATIONS_FOLDER, type AppDatabase } from '../db';
import { applyPendingImport, autoBackup, backupFileName, checkDatabaseFile, createBackup, csvCell, deleteBackup, exportCsv, exportDatabase, finishImport, isBackupName, listBackups, pendingImportFile, replacedFile, rollbackImport, stageImport } from './backup';

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

describe('importing a file from another version', () => {
  interface Journal { entries: { idx: number; when: number; tag: string }[] }
  /** A copy of the app's migrations folder with its journal changed (an older app has fewer; a different history other times). */
  function migrationsCopy(name: string, change: (journal: Journal, folder: string) => void): string {
    const folder = path.join(dir, name);
    fs.cpSync(SOURCE_MIGRATIONS_FOLDER, folder, { recursive: true });
    const file = path.join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
    change(journal, folder);
    fs.writeFileSync(file, JSON.stringify(journal));
    return folder;
  }
  const appliedCount = (file: string): number => {
    const h = createDatabase(file);
    const n = (h.db.$client.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
    h.close();
    return n;
  };
  const known = (): number => (JSON.parse(fs.readFileSync(path.join(SOURCE_MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as Journal).entries.length;

  it('takes a backup made by an older version and brings it up to this one before the restart', () => {
    const older = migrationsCopy('older', (j) => j.entries.splice(Math.max(1, j.entries.length - 3)));
    const file = path.join(dir, 'old-backup.db');
    const old = createDatabase(file, { migrationsFolder: older });
    old.db.insert(employees).values({ name: 'From the old version', employeeNumber: 'o', role: 'cashier', pinHash: 'x' }).run();
    old.close();
    expect(appliedCount(file)).toBeLessThan(known());

    expect(stageImport(file, dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: true });
    const staged = pendingImportFile(dbFile);
    expect(appliedCount(staged)).toBe(known()); // already upgraded: the next start has nothing left to do
    expect(fs.existsSync(`${staged}-wal`)).toBe(false);
    expect(appliedCount(file)).toBeLessThan(known()); // the chosen file itself is untouched
  });

  it('refuses a file whose history is not this version of the app (same number of steps, different steps)', () => {
    const other = migrationsCopy('other', (j) => {
      j.entries[1]!.when += 1; // a step in the middle differs; still older than the next one
    });
    const file = path.join(dir, 'other-history.db');
    createDatabase(file, { migrationsFolder: other }).close();
    expect(stageImport(file, dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: false, error: 'This file comes from a MicroPOS version this one cannot read' });
    expect(fs.existsSync(pendingImportFile(dbFile))).toBe(false);
  });

  it('refuses a file that cannot be upgraded, with the reason, and stages nothing', () => {
    // This version has one more migration than the file, and it fails on the file's data.
    const breaking = migrationsCopy('breaking', (j, folder) => {
      const last = j.entries[j.entries.length - 1]!;
      j.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: '9999_breaks' });
      fs.writeFileSync(path.join(folder, '9999_breaks.sql'), 'CREATE UNIQUE INDEX one_role ON employees (role);');
    });
    const file = path.join(dir, 'two-cashiers.db');
    const h = createDatabase(file, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    for (const n of ['a', 'b']) h.db.insert(employees).values({ name: n, employeeNumber: n, role: 'cashier', pinHash: 'x' }).run();
    h.close();

    const result = stageImport(file, dbFile, breaking);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^This file could not be brought up to this version of MicroPOS: /);
    expect(fs.existsSync(pendingImportFile(dbFile))).toBe(false);
  });

  it('keeps the replaced database until the imported one opens, and can put it back', () => {
    add('Before');
    const file = path.join(dir, 'other.db');
    const other = createDatabase(file, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    other.db.insert(employees).values({ name: 'Imported', employeeNumber: 'i', role: 'cashier', pinHash: 'x' }).run();
    other.close();
    expect(stageImport(file, dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: true });
    handle.close();

    expect(applyPendingImport(dbFile)).toBe(true);
    expect(fs.existsSync(replacedFile(dbFile))).toBe(true);
    expect(rollbackImport(dbFile)).toBe(true); // the imported file would not open: the old data goes back
    handle = createDatabase(dbFile, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    db = handle.db;
    expect(names()).toEqual(['Before']);
    expect(rollbackImport(dbFile)).toBe(false);

    // And the normal path: once the imported file opens, the replaced one is dropped.
    expect(stageImport(file, dbFile, SOURCE_MIGRATIONS_FOLDER)).toEqual({ ok: true });
    handle.close();
    applyPendingImport(dbFile);
    handle = createDatabase(dbFile, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    db = handle.db;
    finishImport(dbFile);
    expect(names()).toEqual(['Imported']);
    expect(fs.existsSync(replacedFile(dbFile))).toBe(false);
  });
});
