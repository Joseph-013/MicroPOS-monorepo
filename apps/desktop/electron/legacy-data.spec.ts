import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_MARKER, purgeLegacyData } from './legacy-data';
import { handleSquirrelEvent } from './squirrel';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-userdata-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (file: string, text = 'x'): void => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

describe('purgeLegacyData', () => {
  it('removes everything an earlier install left, once, and claims the folder', () => {
    // What the earlier MicroPOS (same name) kept: database, logs, logo and the browser's storage.
    write('micropos.db');
    write('micropos.db-wal');
    write('micropos.db-shm');
    write('logs/main.log');
    write('user/logo/logo.png');
    write('Local Storage/leveldb/000003.log');
    write('Session Storage/000003.log');
    write('Cache/Cache_Data/f_000001');

    const result = purgeLegacyData(dir);
    expect(result.state).toBe('purged');
    expect(fs.readdirSync(dir)).toEqual([DATA_MARKER]);
    if (result.state === 'purged') {
      expect(result.removed.sort()).toEqual(['Cache', 'Local Storage', 'Session Storage', 'logs', 'micropos.db', 'micropos.db-shm', 'micropos.db-wal', 'user']);
      expect(result.failed).toEqual([]);
    }
  });

  it('leaves the folder alone from then on: the new app\'s own data survives restarts', () => {
    write('micropos.db', 'old');
    purgeLegacyData(dir);
    write('micropos.db', 'new database');
    write('Local Storage/leveldb/000003.log');

    expect(purgeLegacyData(dir)).toEqual({ state: 'current' });
    expect(fs.readFileSync(path.join(dir, 'micropos.db'), 'utf8')).toBe('new database');
    expect(fs.existsSync(path.join(dir, 'Local Storage'))).toBe(true);
  });

  it('claims an empty or missing folder without removing anything', () => {
    expect(purgeLegacyData(dir)).toEqual({ state: 'fresh' });
    expect(fs.existsSync(path.join(dir, DATA_MARKER))).toBe(true);
    const missing = path.join(dir, 'not', 'there', 'yet');
    expect(purgeLegacyData(missing)).toEqual({ state: 'fresh' });
  });

  it('treats an unreadable marker as no marker', () => {
    write('micropos.db');
    write(DATA_MARKER, '{not json');
    expect(purgeLegacyData(dir).state).toBe('purged');
    expect(fs.existsSync(path.join(dir, 'micropos.db'))).toBe(false);
  });
});

describe('handleSquirrelEvent', () => {
  it('ignores ordinary starts and other platforms', () => {
    expect(handleSquirrelEvent(['app.exe'], 'C:\\app\\app.exe', 'win32')).toBe(false);
    expect(handleSquirrelEvent(['app.exe', '--squirrel-firstrun'], 'C:\\app\\app.exe', 'win32')).toBe(false);
    expect(handleSquirrelEvent(['app', '--squirrel-install'], '/usr/bin/app', 'linux')).toBe(false);
  });

  it('answers the obsolete event without side effects', () => {
    expect(handleSquirrelEvent(['app.exe', '--squirrel-obsolete'], 'C:\\app\\app.exe', 'win32')).toBe(true);
  });
});
