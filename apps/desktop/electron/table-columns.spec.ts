import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderColumns } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './db';
import { getColumnOrders, saveColumnOrder } from './table-columns';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-columns-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('table column orders', () => {
  it('starts empty, keeps each table apart and replaces a table when saved again', () => {
    expect(getColumnOrders(db)).toEqual({});
    expect(saveColumnOrder(db, 'products', ['name', 'sku'])).toBe(true);
    expect(saveColumnOrder(db, 'orders', ['total', 'number'])).toBe(true);
    expect(saveColumnOrder(db, 'products', ['sku', 'name'])).toBe(true);
    expect(getColumnOrders(db)).toEqual({ products: ['sku', 'name'], orders: ['total', 'number'] });
  });

  it('refuses anything that is not a table id with distinct keys', () => {
    for (const [id, keys] of [['Products', ['a']], ['', ['a']], ['x', []], ['x', ['a', 'a']], ['x', 'a'], ['x', [1]], [5, ['a']]] as const) expect(saveColumnOrder(db, id, keys)).toBe(false);
    expect(getColumnOrders(db)).toEqual({});
  });

  it('puts a saved order over the defaults without losing or inventing a column', () => {
    expect(orderColumns(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(orderColumns(['gone', 'b', 'b'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
    expect(orderColumns(undefined, ['a', 'b'])).toEqual(['a', 'b']);
  });
});
