import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './db';
import { getWindowMode, setWindowMode } from './window-mode';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-window-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('window mode at start', () => {
  it('is windowed until chosen, is remembered, and refuses anything else', () => {
    expect(getWindowMode(db)).toBe('windowed');
    expect(setWindowMode(db, 'fullscreen')).toBe(true);
    expect(getWindowMode(db)).toBe('fullscreen');
    expect(setWindowMode(db, 'maximized')).toBe(true);
    expect(getWindowMode(db)).toBe('maximized');
    expect(setWindowMode(db, 'huge')).toBe(false);
    expect(getWindowMode(db)).toBe('maximized');
  });
});
