import Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPin, verifyPin } from '../auth/pin';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './index';
import { DUMMY_PIN, seedDatabase } from './factories';
import { DESKTOP_API_VERSION, PRODUCT_UNITS as CORE_UNITS } from '@micropos/core';
import { API_VERSION } from '../ipc/channels';
import { runMigrate } from './migrate';
import {
  auditLog,
  categories,
  employees,
  loginSessions,
  orderLines,
  orders,
  payments,
  productCategories,
  PRODUCT_UNITS,
  products,
  settings,
} from './schema';
import { listCategories, listProducts } from './queries/catalog';
import { createProduct, deleteProducts, listProductRecords, restoreProducts, setProductsActive, updateProduct } from './queries/products';
import { clearDraft, DRAFT_KEY, loadDraft, sanitizeDraft, saveDraft } from './queries/draft';
import { uuid7 } from './uuid';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-db-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('uuid7', () => {
  it('is a valid v7 uuid that sorts by time', () => {
    const a = uuid7(1_000_000);
    const b = uuid7(2_000_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe('pin hashing', () => {
  it('verifies the right PIN only and salts each hash', () => {
    const hash = hashPin('4321');
    expect(verifyPin('4321', hash)).toBe(true);
    expect(verifyPin('1234', hash)).toBe(false);
    expect(verifyPin('4321', 'garbage')).toBe(false);
    expect(hashPin('4321')).not.toBe(hash);
  });
});

describe('migrations', () => {
  it('creates every table and is safe to run again', () => {
    const tables = (name: string) => name;
    const names = handle.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => tables((r as { name: string }).name))
      .sort();
    expect(names).toEqual(
      ['audit_log', 'categories', 'employees', 'login_sessions', 'order_lines', 'orders', 'payments', 'product_categories', 'products', 'settings'].sort(),
    );
    // Opening the same file again must not re-apply or fail.
    expect(() => createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER }).close()).not.toThrow();
  });
});

describe('constraints', () => {
  const employee = () => ({ name: 'A', employeeNumber: '1', pinHash: hashPin('0000') });

  it('allows reusing a barcode only after the first product is soft-deleted', () => {
    db.insert(products).values({ name: 'One', barcode: '123', price: 100 }).run();
    expect(() => db.insert(products).values({ name: 'Two', barcode: '123', price: 100 }).run()).toThrow(/UNIQUE/);
    db.update(products).set({ deletedAt: Date.now() }).where(eq(products.barcode, '123')).run();
    expect(() => db.insert(products).values({ name: 'Two', barcode: '123', price: 100 }).run()).not.toThrow();
  });

  it('rejects negative prices, mismatched order totals and orphan references', () => {
    expect(() => db.insert(products).values({ name: 'Bad', price: -1 }).run()).toThrow(/CHECK/);
    const [e] = db.insert(employees).values(employee()).returning().all();
    expect(() =>
      db.insert(orders).values({ orderNumber: 'X', employeeId: e.id, subtotal: 100, discountTotal: 0, total: 99 }).run(),
    ).toThrow(/CHECK/);
    expect(() => db.insert(orders).values({ orderNumber: 'Y', employeeId: 'missing' }).run()).toThrow(/FOREIGN KEY/);
  });

  it('keeps order lines readable after their product is deleted', () => {
    const [e] = db.insert(employees).values(employee()).returning().all();
    const [p] = db.insert(products).values({ name: 'Milk', price: 429 }).returning().all();
    const [o] = db.insert(orders).values({ orderNumber: 'A', employeeId: e.id, subtotal: 429, total: 429 }).returning().all();
    db.insert(orderLines).values({ orderId: o.id, productId: p.id, name: 'Milk', unitPrice: 429, quantityMilli: 1000, lineTotal: 429 }).run();
    db.delete(products).where(eq(products.id, p.id)).run();
    const [line] = db.select().from(orderLines).all();
    expect(line.productId).toBeNull();
    expect(line.name).toBe('Milk');
  });

  it('does not allow deleting an employee who has orders', () => {
    const [e] = db.insert(employees).values(employee()).returning().all();
    db.insert(orders).values({ orderNumber: 'A', employeeId: e.id }).run();
    expect(() => db.delete(employees).where(eq(employees.id, e.id)).run()).toThrow(/FOREIGN KEY/);
  });
});

describe('seedDatabase', () => {
  it('produces consistent, constraint-valid dummy data', () => {
    const summary = seedDatabase(db, { orders: 60, days: 14 });
    expect(summary.employees).toBeGreaterThanOrEqual(3);

    // Every foreign key resolves.
    expect(handle.db.$client.pragma('foreign_key_check')).toEqual([]);

    const allOrders = db.select().from(orders).all();
    expect(allOrders.length).toBe(summary.orders + summary.refunds);
    expect(new Set(allOrders.map((o) => o.orderNumber)).size).toBe(allOrders.length);

    for (const order of allOrders) {
      const lines = db.select().from(orderLines).where(eq(orderLines.orderId, order.id)).all();
      const paid = db.select().from(payments).where(eq(payments.orderId, order.id)).all();
      expect(lines.reduce((s, l) => s + l.lineTotal, 0), order.orderNumber).toBe(order.subtotal);
      if (order.status === 'voided') expect(paid).toEqual([]);
      else expect(paid.reduce((s, p) => s + p.amount, 0), order.orderNumber).toBe(order.total);
      for (const p of paid.filter((x) => x.tendered !== null)) expect(p.tendered! - p.change!).toBe(p.amount);
    }

    // Refunds mirror the order they reverse, and that order is marked refunded.
    const refunds = allOrders.filter((o) => o.refundOfOrderId);
    expect(refunds.length).toBe(summary.refunds);
    for (const refund of refunds) {
      const original = allOrders.find((o) => o.id === refund.refundOfOrderId)!;
      expect(original.status).toBe('refunded');
      expect(refund.total).toBe(-original.total);
    }
  });

  it('creates sign-ins that work with the documented PIN, and sessions for staff', () => {
    seedDatabase(db, { orders: 20, days: 7 });
    const [admin] = db.select().from(employees).where(and(eq(employees.employeeNumber, '1001'), isNull(employees.deletedAt))).all();
    expect(admin.role).toBe('admin');
    expect(verifyPin(DUMMY_PIN, admin.pinHash)).toBe(true);
    expect(db.select().from(loginSessions).all().some((s) => s.loggedOutAt === null)).toBe(true);
    expect(db.select().from(auditLog).all().length).toBeGreaterThan(0);
    expect(db.select().from(categories).all().length).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const first = seedDatabase(db, { seed: 7, orders: 10, days: 5 });

    const other = createDatabase(path.join(dir, 'other.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    const second = seedDatabase(other.db, { seed: 7, orders: 10, days: 5 });
    expect(second.credentials.map((c) => c.name)).toEqual(first.credentials.map((c) => c.name));
    const names = (d: AppDatabase) => d.select().from(products).all().map((p) => p.name).sort();
    expect(names(other.db)).toEqual(names(db));
    other.close();
    void Database;
  });
});

describe('catalog queries', () => {
  it('lists live, active products with all their categories, sorted by name; ignores deleted and inactive', () => {
    const [produce, dairy, snacks] = db
      .insert(categories)
      .values([{ name: 'Produce' }, { name: 'dairy' }, { name: 'Snacks' }])
      .returning()
      .all();
    const [gone] = db.insert(categories).values({ name: 'Old', deletedAt: Date.now() }).returning().all();
    const [banana, apple, milk, loose] = db
      .insert(products)
      .values([
        { name: 'banana', price: 179, barcode: '1', sku: 'S1' },
        { name: 'Apple', price: 349 },
        { name: 'Milk', price: 429 },
        { name: 'Loose item', price: 100 },
      ])
      .returning()
      .all();
    db.insert(products).values([{ name: 'Gone', price: 1, deletedAt: Date.now() }, { name: 'Hidden', price: 1, active: false }]).run();
    db.insert(productCategories)
      .values([
        { productId: banana.id, categoryId: produce.id },
        { productId: banana.id, categoryId: snacks.id },
        { productId: banana.id, categoryId: gone.id }, // deleted category is ignored
        { productId: apple.id, categoryId: produce.id },
        { productId: milk.id, categoryId: dairy.id },
      ])
      .run();

    const list = listProducts(db);
    expect(list.map((p) => p.name)).toEqual(['Apple', 'banana', 'Loose item', 'Milk']); // case-insensitive order
    expect(list.find((p) => p.id === banana.id)).toMatchObject({ barcode: '1', sku: 'S1', price: 179 });
    expect(list.find((p) => p.id === banana.id)?.categories.map((c) => c.name)).toEqual(['Produce', 'Snacks']); // many, sorted
    expect(list.find((p) => p.id === apple.id)?.categories.map((c) => c.name)).toEqual(['Produce']);
    expect(list.find((p) => p.id === loose.id)?.categories).toEqual([]); // no category is fine

    expect(listCategories(db).map((c) => c.name)).toEqual(['dairy', 'Produce', 'Snacks']); // deleted one excluded
  });

  it('links cannot repeat, and disappear with their product or category', () => {
    const [c] = db.insert(categories).values({ name: 'A' }).returning().all();
    const [p] = db.insert(products).values({ name: 'P', price: 1 }).returning().all();
    db.insert(productCategories).values({ productId: p.id, categoryId: c.id }).run();
    expect(() => db.insert(productCategories).values({ productId: p.id, categoryId: c.id }).run()).toThrow(/UNIQUE|PRIMARY/);
    db.delete(categories).where(eq(categories.id, c.id)).run();
    expect(db.select().from(productCategories).all()).toEqual([]);
  });

  it('returns the seeded catalog, every product in at least one category and some in several', () => {
    const summary = seedDatabase(db, { orders: 5, days: 3 });
    const list = listProducts(db);
    expect(list.length).toBe(summary.products);
    expect(listCategories(db).length).toBe(summary.categories);
    expect(list.every((p) => p.categories.length >= 1)).toBe(true);
    expect(list.some((p) => p.categories.length > 1)).toBe(true);
  });
});

describe('migrating a database that already has data', () => {
  it('turns each single category into a link and keeps order lines and all other data intact', () => {
    // Build a database at the first migration only, as it would exist before this change.
    const folder = path.join(dir, 'migrations-v0');
    fs.cpSync(SOURCE_MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalFile = path.join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    const [first, ...later] = journal.entries;
    for (const entry of later) fs.rmSync(path.join(folder, `${entry.tag}.sql`));
    fs.writeFileSync(journalFile, JSON.stringify({ ...journal, entries: [first] }));

    const file = path.join(dir, 'old.db');
    const old = createDatabase(file, { migrationsFolder: folder });
    old.db.$client.exec(`
      INSERT INTO employees (id, name, employee_number, pin_hash, created_at, updated_at) VALUES ('e1', 'E', '1', 'x', 1, 1);
      INSERT INTO categories (id, name, created_at, updated_at) VALUES ('c1', 'Dairy', 1, 1), ('c2', 'Bakery', 1, 1);
      INSERT INTO products (id, name, price, category_id, barcode, plu, created_at, updated_at) VALUES
        ('p1', 'Milk', 429, 'c1', '590111', '9', 1, 1), ('p2', 'Bread', 299, 'c2', NULL, NULL, 1, 1), ('p3', 'Loose', 100, NULL, NULL, '4011', 1, 1);
      INSERT INTO orders (id, order_number, employee_id, subtotal, total, created_at, updated_at) VALUES ('o1', 'SO-1', 'e1', 429, 429, 1, 1);
      INSERT INTO order_lines (id, order_id, product_id, name, unit_price, quantity_milli, line_total) VALUES ('l1', 'o1', 'p1', 'Milk', 429, 1000, 429);
    `);
    old.close();

    // Now apply every migration, including the many-to-many one.
    const upgraded = createDatabase(file, { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    const q = (sql: string) => upgraded.db.$client.prepare(sql).all();
    expect(q('SELECT product_id, category_id FROM product_categories ORDER BY product_id')).toEqual([
      { product_id: 'p1', category_id: 'c1' },
      { product_id: 'p2', category_id: 'c2' },
    ]); // p3 had no category, so no link
    expect(q("SELECT product_id FROM order_lines WHERE id = 'l1'")).toEqual([{ product_id: 'p1' }]); // not nulled by the rebuild
    expect(q('SELECT id, name, price FROM products ORDER BY id')).toHaveLength(3);
    expect(q('SELECT DISTINCT unit FROM products')).toEqual([{ unit: 'each' }]); // existing products are counted items
    // PLU and barcode became one code: a PLU-only product keeps it as its barcode, a product with both keeps the barcode.
    expect(q('SELECT id, barcode FROM products ORDER BY id')).toEqual([
      { id: 'p1', barcode: '590111' },
      { id: 'p2', barcode: null },
      { id: 'p3', barcode: '4011' },
    ]);
    expect(q('PRAGMA table_info(products)').some((c) => (c as { name: string }).name === 'category_id')).toBe(false);
    expect(upgraded.db.$client.pragma('foreign_key_check')).toEqual([]);
    expect(upgraded.db.$client.pragma('foreign_keys', { simple: true })).toBe(1); // restored afterwards
    upgraded.close();
  });
});

describe('db:migrate command', () => {
  const file = () => path.join(dir, 'cli.db');
  const open = () => createDatabase(file());
  const query = <T>(sql: string): T => {
    const h = open();
    try {
      return h.db.$client.prepare(sql).get() as T;
    } finally {
      h.close();
    }
  };
  const count = (table: string): number => query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).n;

  it('applies pending migrations without creating any data, and is a no-op the second time', () => {
    const first = runMigrate({ file: file() });
    expect(first.applied).toBeGreaterThan(0);
    expect(first.admin).toBeUndefined();
    expect(count('employees')).toBe(0);
    expect(runMigrate({ file: file() }).applied).toBe(0);
  });

  it('--fresh rebuilds from scratch and leaves exactly one admin account and nothing else', () => {
    runMigrate({ file: file(), seed: false });
    const h = open();
    h.db.insert(products).values({ name: 'Stale', price: 1 }).run();
    h.close();

    const result = runMigrate({ file: file(), fresh: true });
    expect(result.applied).toBeGreaterThan(0);
    expect(result.admin).toMatchObject({ employeeNumber: '1001', created: true });
    expect(count('employees')).toBe(1);
    expect(query<{ role: string }>('SELECT role FROM employees').role).toBe('admin');
    expect(count('products')).toBe(0); // old data is gone
    expect(count('orders')).toBe(0);

    // The admin PIN works.
    const { employeeNumber, pin } = result.admin!;
    const row = query<{ pin_hash: string }>(`SELECT pin_hash FROM employees WHERE employee_number = '${employeeNumber}'`);
    expect(verifyPin(pin!, row.pin_hash)).toBe(true);
  });

  it('--fresh --seed gives one admin plus the factory data, with no duplicate admin', () => {
    const result = runMigrate({ file: file(), fresh: true, seed: true });
    expect(result.seeded?.products).toBeGreaterThan(0);
    expect(count('orders')).toBeGreaterThan(0);
    expect(query<{ n: number }>("SELECT COUNT(*) AS n FROM employees WHERE role = 'admin'").n).toBe(1);
    expect(count('employees')).toBe(result.seeded!.employees);
    expect(result.seeded!.credentials[0]).toMatchObject({ employeeNumber: '1001', role: 'admin', pin: result.admin!.pin });
  });

  it('--seed alone seeds an empty database but refuses one that already has data', () => {
    runMigrate({ file: file(), fresh: true });
    expect(runMigrate({ file: file(), seed: true }).seeded?.orders).toBeGreaterThan(0);
    expect(() => runMigrate({ file: file(), seed: true })).toThrow(/already has data/);
    // ...and --fresh --seed is the way back.
    expect(() => runMigrate({ file: file(), fresh: true, seed: true })).not.toThrow();
  });
});

describe('checkout draft', () => {
  const line = (n: number) => ({ productId: `p${n}`, name: `Item ${n}`, quantityMilli: 1000 * n, unitPrice: 100 * n, unit: 'each' as const });

  it('saves, replaces, loads and clears the draft', () => {
    expect(loadDraft(db)).toBeNull();
    saveDraft(db, { lines: [line(1), line(2)] });
    expect(loadDraft(db)?.lines).toEqual([line(1), line(2)]);

    saveDraft(db, { lines: [line(3)] }); // replaces, does not append
    expect(loadDraft(db)?.lines).toEqual([line(3)]);
    expect(db.select().from(settings).where(eq(settings.key, DRAFT_KEY)).all()).toHaveLength(1);

    clearDraft(db);
    expect(loadDraft(db)).toBeNull();
  });

  it('removes the draft when an empty one is saved', () => {
    saveDraft(db, { lines: [line(1)] });
    saveDraft(db, { lines: [] });
    expect(loadDraft(db)).toBeNull();
    expect(db.select().from(settings).where(eq(settings.key, DRAFT_KEY)).all()).toHaveLength(0);
  });

  it('survives closing and reopening the database', () => {
    saveDraft(db, { lines: [line(2)] });
    handle.close();
    handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    db = handle.db;
    expect(loadDraft(db)?.lines).toEqual([line(2)]);
  });

  it('warns when it has to drop lines it was sent, so a format mismatch is never silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    saveDraft(db, { lines: [line(1), { productId: 'x', name: 'old shape', quantity: 'many', unitPrice: 1 }] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 of 2'));
    warn.mockRestore();
    expect(loadDraft(db)?.lines).toEqual([line(1)]);
  });

  it('drops malformed lines instead of storing them', () => {
    const dirty = {
      lines: [
        line(1),
        { productId: 'x', name: 'zero qty', quantityMilli: 0, unitPrice: 1 },
        { productId: 'x', name: 'fractional thousandths', quantityMilli: 1.5, unitPrice: 1 },
        { productId: 'x', name: 'too many units', quantityMilli: 100_000_000, unitPrice: 1 },
        { productId: 'x', name: 'negative price', quantityMilli: 1000, unitPrice: -5 },
        { productId: 7, name: 'wrong id type', quantityMilli: 1000, unitPrice: 1 },
        null,
        'junk',
      ],
    };
    expect(sanitizeDraft(dirty).lines).toEqual([line(1)]);
    expect(sanitizeDraft(null).lines).toEqual([]);
    // A draft written before decimals existed keeps working: whole units become thousandths.
    expect(sanitizeDraft({ lines: [{ productId: 'a', name: 'Old', quantity: 3, unitPrice: 100 }] }).lines).toEqual([
      { productId: 'a', name: 'Old', quantityMilli: 3000, unitPrice: 100, unit: 'each' },
    ]);
    // Decimal quantities are fine.
    expect(sanitizeDraft({ lines: [{ productId: 'a', name: 'Rice', quantityMilli: 1250, unitPrice: 100 }] }).lines).toHaveLength(1);
    expect(sanitizeDraft({ lines: 'nope' }).lines).toEqual([]);
    expect(sanitizeDraft({ lines: Array.from({ length: 900 }, () => line(1)) }).lines).toHaveLength(500);
  });
});

describe('API version', () => {
  it('is the same number in the main process and in the shared contract the page checks against', () => {
    expect(API_VERSION).toBe(DESKTOP_API_VERSION);
  });
});

describe('product management', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    name: 'Tea',
    sku: 'TEA-1',
    barcode: '111',
    price: 250,
    cost: null,
    active: true,
    categoryIds: [] as string[],
    ...over,
  });
  const category = (name: string) => db.insert(categories).values({ name }).returning({ id: categories.id }).get().id;

  it('creates, lists (including inactive) and updates with categories', () => {
    const a = category('Drinks');
    const b = category('Hot');
    const created = createProduct(db, input({ categoryIds: [a, b] }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.product.categories.map((c) => c.name)).toEqual(['Drinks', 'Hot']);

    const updated = updateProduct(db, created.product.id, input({ name: 'Green Tea', active: false, cost: 100, categoryIds: [b] }));
    expect(updated.ok).toBe(true);
    const [row] = listProductRecords(db);
    expect(row).toMatchObject({ name: 'Green Tea', active: false, cost: 100 });
    expect(row?.categories.map((c) => c.name)).toEqual(['Hot']);
    // Inactive products are managed here but not offered at checkout.
    expect(listProducts(db)).toHaveLength(0);
  });

  it('reports invalid input and duplicate codes against the field', () => {
    expect(createProduct(db, input({ name: '  ' }))).toMatchObject({ ok: false, field: 'name' });
    expect(createProduct(db, input({ price: -1 }))).toMatchObject({ ok: false, field: 'price' });
    expect(createProduct(db, input({ price: 1.5 }))).toMatchObject({ ok: false, field: 'price' });
    expect(createProduct(db, input())).toMatchObject({ ok: true });
    expect(createProduct(db, input({ name: 'Other', barcode: '222' }))).toMatchObject({ ok: false, field: 'sku' });
    expect(createProduct(db, input({ name: 'Other', sku: 'X', barcode: '111' }))).toMatchObject({ ok: false, field: 'barcode' });
    // Empty codes never collide with each other.
    expect(createProduct(db, input({ name: 'A', sku: '', barcode: '' })).ok).toBe(true);
    expect(createProduct(db, input({ name: 'B', sku: '', barcode: '' })).ok).toBe(true);
  });

  it('lets a product keep its own codes and rejects unknown categories', () => {
    const created = createProduct(db, input());
    if (!created.ok) throw new Error('create failed');
    expect(updateProduct(db, created.product.id, input({ price: 300 })).ok).toBe(true);
    expect(createProduct(db, input({ name: 'Z', sku: 'Z', barcode: 'Z', categoryIds: ['nope'] }))).toMatchObject({ ok: false });
  });

  it('lists deleted products only when asked, with created and deleted times', () => {
    const created = createProduct(db, input());
    if (!created.ok) throw new Error('create failed');
    expect(created.product.createdAt).toBeGreaterThan(0);
    expect(created.product.deletedAt).toBeNull();
    deleteProducts(db, [created.product.id]);
    expect(listProductRecords(db)).toHaveLength(0);
    const all = listProductRecords(db, true);
    expect(all).toHaveLength(1);
    expect(all[0]?.deletedAt).toBeGreaterThan(0);
  });

  it('deletes and restores many at once, skipping a product whose code was taken meanwhile', () => {
    const make = (name: string, sku: string, barcode: string) => {
      const r = createProduct(db, input({ name, sku, barcode }));
      if (!r.ok) throw new Error('create failed');
      return r.product.id;
    };
    const a = make('A', 'SA', '1');
    const b = make('B', 'SB', '2');
    const c = make('C', 'SC', '3');
    deleteProducts(db, [a, b, c, 'nope', 42]); // unknown or malformed ids are ignored
    expect(listProductRecords(db)).toHaveLength(0);
    make('Taker', 'SB', '9'); // a new live product now uses B's SKU
    expect(restoreProducts(db, [a, b, c])).toEqual({ restored: 2, conflicts: ['B'] });
    expect(listProductRecords(db).map((p) => p.name)).toEqual(['A', 'C', 'Taker']);
    expect(restoreProducts(db, [a, 'nope'])).toEqual({ restored: 0, conflicts: [] }); // already live
    expect(restoreProducts(db, 'not a list')).toEqual({ restored: 0, conflicts: [] });
  });

  it('sets many products active or inactive, ignoring deleted ones and bad input', () => {
    const make = (name: string, barcode: string) => {
      const r = createProduct(db, input({ name, sku: null, barcode }));
      if (!r.ok) throw new Error('create failed');
      return r.product.id;
    };
    const a = make('A', '1');
    const b = make('B', '2');
    setProductsActive(db, [a, b, 'nope'], false);
    expect(listProductRecords(db).map((p) => p.active)).toEqual([false, false]);
    deleteProducts(db, [b]);
    setProductsActive(db, [a, b], true);
    expect(listProductRecords(db, true).map((p) => [p.name, p.active])).toEqual([['A', true], ['B', false]]); // deleted B untouched
    setProductsActive(db, [a], 'yes'); // not a boolean: ignored
    setProductsActive(db, 'not a list', false);
    expect(listProductRecords(db).map((p) => p.active)).toEqual([true]);
  });

  it('soft deletes, freeing the codes', () => {
    const created = createProduct(db, input());
    if (!created.ok) throw new Error('create failed');
    deleteProducts(db, [created.product.id]);
    expect(listProductRecords(db)).toHaveLength(0);
    expect(updateProduct(db, created.product.id, input())).toMatchObject({ ok: false });
    expect(createProduct(db, input()).ok).toBe(true);
  });
});

describe('weighed products', () => {
  it('keeps a weighed draft line unit and reads old lines as each', () => {
    saveDraft(db, { lines: [{ productId: 'a', name: 'Beef', quantityMilli: 350, unitPrice: 899, unit: 'kg' }] });
    expect(loadDraft(db)?.lines[0]?.unit).toBe('kg');
    expect(sanitizeDraft({ lines: [{ productId: 'a', name: 'Milk', quantityMilli: 1000, unitPrice: 100 }] }).lines[0]?.unit).toBe('each');
  });

  const base = { name: 'Beef', sku: null, barcode: null as string | null, price: 899, cost: null, active: true, categoryIds: [] as string[] };

  it('keeps the unit list in step with core', () => {
    expect([...PRODUCT_UNITS]).toEqual([...CORE_UNITS]);
  });

  it('stores the unit and requires a code (PLU) for weighed products', () => {
    expect(createProduct(db, { ...base, unit: 'kg', barcode: null })).toMatchObject({ ok: false, field: 'barcode' });
    expect(createProduct(db, { ...base, unit: 'stone', barcode: '4011' })).toMatchObject({ ok: false, field: 'unit' });
    const ok = createProduct(db, { ...base, unit: 'kg', barcode: '4011' });
    expect(ok.ok && ok.product.unit).toBe('kg');
    // Counted items need no code, and a missing unit means each.
    const each = createProduct(db, { ...base, name: 'Gum', barcode: null });
    expect(each.ok && each.product.unit).toBe('each');
    expect(listProducts(db).find((p) => p.name === 'Beef')?.unit).toBe('kg');
  });

  it('the database itself refuses a weighed product without a code', () => {
    expect(() =>
      db.$client.prepare("INSERT INTO products (id, name, price, unit, created_at, updated_at) VALUES ('x', 'X', 1, 'kg', 1, 1)").run(),
    ).toThrow(/CHECK/);
  });

  it('seeds weighed products with fractional weights and costs below price', () => {
    seedDatabase(db, { orders: 40, extraProducts: 2 });
    const weighed = db.select().from(products).where(eq(products.unit, 'kg')).all();
    expect(weighed.length).toBeGreaterThan(0);
    for (const p of db.select().from(products).all()) {
      expect(p.cost).not.toBeNull();
      expect(p.barcode).not.toBeNull(); // every seeded product has a code: a barcode, or a PLU for weighed ones
    }
    const lines = db.select().from(orderLines).all();
    expect(lines.some((l) => l.quantityMilli % 1000 !== 0)).toBe(true);
  });
});
