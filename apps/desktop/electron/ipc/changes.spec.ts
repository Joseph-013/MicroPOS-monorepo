import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_DOMAINS } from '@micropos/core';

// The handlers register themselves on Electron's ipcMain: capture them instead.
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock('electron', () => {
  const anything: object = new Proxy(function () {}, { get: () => anything, apply: () => anything });
  return { ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) }, BrowserWindow: anything, screen: anything, app: anything, powerMonitor: anything };
});

import { ensureOwner, INITIAL_OWNER_PIN, signIn, signInChoices, signOut } from '../auth/auth';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { CHANNELS } from './channels';
import { onDataChanged, UNRELATED, WRITES } from './changes';
import { registerIpcHandlers } from './index';

const allChannels = (): string[] => Object.values(CHANNELS).flatMap((group) => Object.values(group) as string[]);

describe('change announcements', () => {
  it('classifies every channel, so a new write path cannot be forgotten', () => {
    const unclassified = allChannels().filter((c) => !(c in WRITES) && !UNRELATED.includes(c));
    expect(unclassified).toEqual([]);
    expect(Object.keys(WRITES).filter((c) => UNRELATED.includes(c))).toEqual([]);
    expect([...Object.keys(WRITES), ...UNRELATED].filter((c) => !allChannels().includes(c))).toEqual([]);
  });

  it('only names real data domains', () => {
    for (const domains of Object.values(WRITES)) for (const d of domains) expect(DATA_DOMAINS).toContain(d);
  });

  describe('through the handlers', () => {
    let dir: string;
    let handle: ReturnType<typeof createDatabase>;
    let db: AppDatabase;
    const heard: string[][] = [];
    let stop: () => void;
    beforeEach(() => {
      handlers.clear();
      heard.length = 0;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-changes-'));
      handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
      db = handle.db;
      ensureOwner(db);
      expect(signIn(db, { userId: signInChoices(db)[0]!.id, pin: INITIAL_OWNER_PIN }).ok).toBe(true);
      registerIpcHandlers(db);
      stop = onDataChanged((domains) => heard.push([...domains]));
    });
    afterEach(() => {
      stop();
      signOut(db);
      handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const call = async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const result = await handlers.get(channel)!({}, ...args);
      await new Promise((r) => setTimeout(r, 0));
      return result;
    };

    it('announce the parts a successful write changed', async () => {
      const made = (await call(CHANNELS.customers.create, { name: 'Nena', phone: null, note: null, creditLimit: null, interestMode: null, interestRateBp: null })) as { ok: boolean };
      expect(made.ok).toBe(true);
      expect(heard).toEqual([['customers']]);
    });

    it('stay quiet for a read, and for a write that was refused', async () => {
      await call(CHANNELS.customers.list);
      await call(CHANNELS.inventory.concerns);
      expect(heard).toEqual([]);
      const refused = (await call(CHANNELS.customers.create, { name: ' ' })) as { ok: boolean };
      expect(refused.ok).toBe(false);
      expect(heard).toEqual([]);
    });
  });
});
