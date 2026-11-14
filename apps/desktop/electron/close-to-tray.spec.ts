import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, matchingRole, ROLE_PRESETS } from '@micropos/core';
import { getCloseToTray, onCloseToTrayChanged, setCloseToTray } from './close-to-tray';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './db';
import { employees } from './db/schema';
import { eq } from 'drizzle-orm';
import { hashPin } from './auth/pin';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-tray-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('closing to the tray', () => {
  it('is off until an admin turns it on, remembered, and tells its listeners', () => {
    expect(getCloseToTray(db)).toBe(false);
    const heard: boolean[] = [];
    const stop = onCloseToTrayChanged((v) => heard.push(v));
    expect(setCloseToTray(db, true)).toBe(true);
    expect(getCloseToTray(db)).toBe(true);
    expect(setCloseToTray(db, false)).toBe(true);
    expect(getCloseToTray(db)).toBe(false);
    expect(heard).toEqual([true, false]);
    stop();
    setCloseToTray(db, true);
    expect(heard).toEqual([true, false]);
  });

  it('refuses anything that is not a yes or no', () => {
    for (const bad of ['yes', 1, null, undefined, {}]) expect(setCloseToTray(db, bad)).toBe(false);
    expect(getCloseToTray(db)).toBe(false);
  });
});

describe('the shop settings permission', () => {
  it('is for admins only, by preset', () => {
    expect(ROLE_PRESETS.admin).toContain('settings.manage');
    expect(ROLE_PRESETS.manager).not.toContain('settings.manage');
    expect(ROLE_PRESETS.cashier).not.toContain('settings.manage');
    expect(matchingRole(ALL_PERMISSIONS)).toBe('admin');
  });

  it('is granted by the migration to whoever could manage users, and to nobody else', () => {
    // Rebuild the database as it was before the migration, with three people who had explicit permission lists.
    const old = path.join(dir, 'old.db');
    const folder = fs.mkdtempSync(path.join(dir, 'migrations-'));
    for (const f of fs.readdirSync(SOURCE_MIGRATIONS_FOLDER)) {
      if (/^00(0[89]|[1-9]\d)/.test(f)) continue; // 0008 and later
      fs.cpSync(path.join(SOURCE_MIGRATIONS_FOLDER, f), path.join(folder, f), { recursive: true });
    }
    const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => !/^00(0[89]|[1-9]\d)/.test(e.tag));
    fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
    const before = createDatabase(old, { migrationsFolder: folder });
    const person = (name: string, permissions: string[] | null) =>
      before.db.insert(employees).values({ name, employeeNumber: name, role: 'cashier', permissions: permissions as never, pinHash: hashPin('1234') }).run();
    person('admin', ['checkout.sell', 'users.manage']);
    person('manager', ['checkout.sell', 'customers.manage']);
    person('preset', null);
    before.close();

    const after = createDatabase(old, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    const permissionsOf = (name: string) => after.db.select({ p: employees.permissions }).from(employees).where(eq(employees.name, name)).get()?.p;
    expect(permissionsOf('admin')).toEqual(['checkout.sell', 'users.manage', 'settings.manage']);
    expect(permissionsOf('manager')).toEqual(['checkout.sell', 'customers.manage']);
    expect(permissionsOf('preset')).toBeNull();
    after.close();
  });
});
