import Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPin, verifyPin } from '../auth/pin';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './index';
import { DUMMY_PIN, seedDatabase } from './factories';
import { DESKTOP_API_VERSION, ORDER_PAYMENT_METHODS, PRODUCT_TRACKING as CORE_TRACKING, PRODUCT_UNITS as CORE_UNITS } from '@micropos/core';
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
  PAYMENT_METHODS,
  PRODUCT_TRACKING,
  PRODUCT_UNITS,
  products,
  settings,
  stockMovements,
} from './schema';
import { listCategories, listProducts } from './queries/catalog';
import { createProduct, deleteProducts, listProductRecords, restoreProducts, setProductsActive, updateProduct } from './queries/products';
import { createCategory, deleteCategories, listCategoryRecords, restoreCategories, updateCategory } from './queries/categories';
import { clearRepackageDraft, loadRepackageDraft, saveRepackageDraft } from './queries/repackage-draft';
import { adjustStock, allocateSale, inventoryOverview, listBatches, receiveStock, repackageStock, restockSale } from './queries/inventory';
import { clearProductDraft, loadProductDraft, sanitizeProductDraft, saveProductDraft } from './queries/product-draft';
import {
  cancelPurchase,
  createPurchase,
  createSupplier,
  deleteSuppliers,
  getPurchase,
  listPurchases,
  listSuppliers,
  payPurchase,
  receivePurchase,
  restoreSuppliers,
  updatePurchase,
  updateSupplier,
} from './queries/purchases';
import { createCustomer, deleteCustomers, getCustomerAccount, listCustomers, receivePayment, restoreCustomers, updateCustomer } from './queries/customers';
import { completeOrder, getOrder, listOrders, nextOrderNumber, refundOrder, voidOrder } from './queries/orders';
import { clearDraft, DRAFT_KEY, loadDraft, sanitizeDraft, saveDraft } from './queries/draft';
import { isScaleBarcode, KNOWN_BARCODES, scalePlu, scaleWeightGrams } from './factories/known-barcodes';
import { ean13CheckDigit } from './factories/ean13';
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
      ['audit_log', 'cash_movements', 'cash_sessions', 'categories', 'customer_ledger', 'customers', 'employees', 'login_sessions', 'order_lines', 'orders', 'payments', 'product_batches', 'product_categories', 'products', 'purchase_order_lines', 'purchase_orders', 'purchase_payments', 'settings', 'stock_movements', 'supplier_returns', 'suppliers'].sort(),
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
  it('seeds customers with credit sales and payments: balances are never negative or past a limit', () => {
    const summary = seedDatabase(db, { orders: 200, days: 30 });
    expect(summary.customers).toBe(6);
    expect(summary.ledgerEntries).toBeGreaterThan(0);
    const customersNow = listCustomers(db);
    expect(customersNow).toHaveLength(6);
    for (const c of customersNow) {
      expect(c.balance, c.name).toBeGreaterThanOrEqual(0); // payments never exceed what is owed
      if (c.creditLimit !== null) expect(c.balance, c.name).toBeLessThanOrEqual(c.creditLimit);
    }
    expect(customersNow.some((c) => c.balance > 0)).toBe(true);
    // Credit sales are linked to their customer, and every charge belongs to a completed sale.
    const linked = db.select().from(orders).all().filter((o) => o.customerId);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every((o) => o.status === 'completed')).toBe(true);
    expect(handle.db.$client.pragma('foreign_key_check')).toEqual([]);
  });

  it('seeds suppliers and purchase orders that add up: totals, payments, receipts and stock', () => {
    const summary = seedDatabase(db, { orders: 60, days: 30 });
    expect(summary.suppliers).toBe(4);
    expect(summary.purchaseOrders).toBe(10);
    const pos = listPurchases(db);
    expect(pos).toHaveLength(10);
    expect(new Set(pos.map((p) => p.number)).size).toBe(10);
    for (const po of pos) {
      const detail = getPurchase(db, po.id)!;
      expect(detail.lines.reduce((sum, l) => sum + l.total, 0), po.number).toBe(po.total);
      expect(po.paid, po.number).toBeLessThanOrEqual(po.total);
      if (po.status === 'cancelled') expect(po.paid).toBe(0);
      if (po.status === 'received') expect(po.receivedAt).not.toBeNull();
      else expect(po.receivedAt).toBeNull();
    }
    expect(pos.some((p) => p.status === 'received')).toBe(true);
    expect(pos.some((p) => p.owed > 0)).toBe(true);
    // Receiving never takes a batch below zero.
    expect(listBatches(db, { includeEmpty: true }).every((b) => b.onHandMilli >= 0)).toBe(true);
    expect(handle.db.$client.pragma('foreign_key_check')).toEqual([]);
  });

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
      else {
        // A credit sale pays part now; the rest is charged to the customer's account.
        const charged = (handle.db.$client.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM customer_ledger WHERE order_id = ? AND type = 'charge'").get(order.id) as { t: number }).t;
        expect(paid.reduce((s, p) => s + p.amount, 0) + charged, order.orderNumber).toBe(order.total);
      }
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

describe('product form drafts', () => {
  const draft = { name: 'Tea', unit: 'kg' as const, tracking: 'expiry' as const, shelfLifeDays: '7', criticalLevel: '5', sku: 'T-1', barcode: '4011', price: '12.5', cost: '', active: false, categoryIds: ['c1'] };

  it('saves, replaces, loads and clears a draft per form', () => {
    expect(loadProductDraft(db, 'new')).toBeNull();
    saveProductDraft(db, 'new', draft);
    saveProductDraft(db, 'p-1', { ...draft, name: 'Other' });
    expect(loadProductDraft(db, 'new')).toEqual(draft);
    expect(loadProductDraft(db, 'p-1')?.name).toBe('Other');
    saveProductDraft(db, 'new', { ...draft, name: 'Tea 2' });
    expect(loadProductDraft(db, 'new')?.name).toBe('Tea 2');
    clearProductDraft(db, 'new');
    expect(loadProductDraft(db, 'new')).toBeNull();
    expect(loadProductDraft(db, 'p-1')).not.toBeNull(); // the other form's draft is untouched
  });

  it('sanitizes what the renderer sends and ignores malformed form keys', () => {
    expect(sanitizeProductDraft({ name: 5, unit: 'stone', categoryIds: ['a', 'a', 7], active: 'x' })).toEqual({
      name: '', unit: 'each', tracking: 'none', shelfLifeDays: '', criticalLevel: '', sku: '', barcode: '', price: '', cost: '', active: true, categoryIds: ['a'],
    });
    saveProductDraft(db, 42, draft);
    saveProductDraft(db, '', draft);
    expect(loadProductDraft(db, 42)).toBeNull();
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

  it('stores the unit; a weighed product may be saved without a code', () => {
    expect(createProduct(db, { ...base, name: 'Loose rice', unit: 'kg', barcode: null })).toMatchObject({ ok: true });
    expect(createProduct(db, { ...base, unit: 'stone', barcode: '4011' })).toMatchObject({ ok: false, field: 'unit' });
    const ok = createProduct(db, { ...base, unit: 'kg', barcode: '4011' });
    expect(ok.ok && ok.product.unit).toBe('kg');
    // Counted items need no code, and a missing unit means each.
    const each = createProduct(db, { ...base, name: 'Gum', barcode: null });
    expect(each.ok && each.product.unit).toBe('each');
    expect(listProducts(db).find((p) => p.name === 'Beef')?.unit).toBe('kg');
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

describe('seeding known barcodes', () => {
  it('starts the catalog with a product for every known barcode, then adds the dummy data', () => {
    expect(new Set(KNOWN_BARCODES).size).toBe(KNOWN_BARCODES.length);
    for (const code of KNOWN_BARCODES) expect(ean13CheckDigit(code.slice(0, 12))).toBe(Number(code[12]));

    const summary = seedDatabase(db, { orders: 10, extraProducts: 3 });
    const rows = db.select().from(products).all();
    const byCode = new Map(rows.map((p) => [p.barcode, p]));
    for (const code of KNOWN_BARCODES.filter((c) => !isScaleBarcode(c))) expect(byCode.get(code)).toMatchObject({ unit: 'each' });
    // A scale label becomes a weighed product known by its PLU, not by the whole label.
    const scale = KNOWN_BARCODES.filter(isScaleBarcode);
    expect(scale).toHaveLength(12);
    for (const code of scale) {
      expect(byCode.get(code)).toBeUndefined();
      expect(byCode.get(scalePlu(code))).toMatchObject({ unit: 'kg' });
    }
    expect(summary.products).toBe(KNOWN_BARCODES.length + 18 + 3); // known, the 18 sample products, extras
    expect(new Set(rows.map((p) => p.sku)).size).toBe(rows.length);
    expect(new Set(rows.map((p) => p.barcode)).size).toBe(rows.length);
  });

  it('reads the PLU and weight out of a scale label', () => {
    expect(scalePlu('2459550081706')).toBe('45955');
    expect(scalePlu('2089890075709')).toBe('8989'); // leading zero dropped
    expect(scaleWeightGrams('2459550081706')).toBe(8170);
    expect(isScaleBarcode('4801520204635')).toBe(false);
  });
});

describe('inventory: batches, expiry and the stock ledger', () => {
  const DAY = 86_400_000;
  const product = (tracking: string, over: Record<string, unknown> = {}) => {
    const r = createProduct(db, {
      name: `P-${tracking}-${Math.random().toString(36).slice(2, 6)}`,
      unit: 'each',
      tracking,
      shelfLifeDays: null,
      sku: null,
      barcode: null,
      price: 100,
      cost: 60,
      active: true,
      categoryIds: [],
      ...over,
    });
    if (!r.ok) throw new Error(r.error);
    return r.product;
  };
  const SOON_ISH = Date.now() + 5 * DAY;
  const receive = (productId: string, over: Record<string, unknown> = {}) =>
    receiveStock(db, { productId, batchNumber: 'L1', expiresAt: SOON_ISH, quantityMilli: 10_000, unitCost: 50, note: null, ...over });
  /** A sale line to attach stock movements to (they reference real order lines). */
  const saleLine = (id: string): string => {
    db.$client.exec(`
      INSERT OR IGNORE INTO employees (id, name, employee_number, pin_hash, created_at, updated_at) VALUES ('emp', 'E', '9', 'x', 1, 1);
      INSERT OR IGNORE INTO orders (id, order_number, employee_id, subtotal, total, created_at, updated_at) VALUES ('ord', 'SO-1', 'emp', 0, 0, 1, 1);
      INSERT INTO order_lines (id, order_id, name, unit_price, quantity_milli, line_total) VALUES ('${id}', 'ord', 'x', 1, 1000, 1);`);
    return id;
  };
  const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r as Extract<T, { ok: true }>;
  };

  it('keeps the tracking list in step with core and stores it on the product', () => {
    expect([...PRODUCT_TRACKING]).toEqual([...CORE_TRACKING]);
    const milk = product('expiry', { shelfLifeDays: 7 });
    expect(milk).toMatchObject({ tracking: 'expiry', shelfLifeDays: 7, onHandMilli: 0, nextExpiry: null });
    // Shelf life only means something for expiring products.
    expect(product('batch', { shelfLifeDays: 7 }).shelfLifeDays).toBeNull();
    expect(product('none').onHandMilli).toBeNull();
    expect(createProduct(db, { name: 'X', unit: 'each', tracking: 'weekly', price: 1, cost: null, active: true, categoryIds: [] })).toMatchObject({ ok: false, field: 'tracking' });
    expect(createProduct(db, { name: 'X', unit: 'each', tracking: 'expiry', shelfLifeDays: 0, price: 1, cost: null, active: true, categoryIds: [] })).toMatchObject({ ok: false, field: 'shelfLifeDays' });
  });

  it('receiving creates a batch with its stock, and the same lot again tops it up', () => {
    const milk = product('expiry');
    const first = ok(receive(milk.id));
    expect(first.batch).toMatchObject({ batchNumber: 'L1', onHandMilli: 10_000, receivedMilli: 10_000, unitCost: 50 });
    const again = ok(receive(milk.id, { quantityMilli: 2_000 }));
    expect(again.batch.id).toBe(first.batch.id);
    expect(again.batch.onHandMilli).toBe(12_000);
    expect(listProductRecords(db).find((p) => p.id === milk.id)).toMatchObject({ onHandMilli: 12_000 });
    // A same-named lot with another expiry is a mistake.
    expect(receive(milk.id, { expiresAt: Date.now() + 9 * DAY })).toMatchObject({ ok: false, field: 'expiresAt' });
  });

  it('asks for what the tracking level needs and nothing else', () => {
    const milk = product('expiry');
    expect(receive(milk.id, { batchNumber: '' })).toMatchObject({ ok: false, field: 'batchNumber' });
    expect(receive(milk.id, { expiresAt: null })).toMatchObject({ ok: false, field: 'expiresAt' });
    expect(receive(milk.id, { quantityMilli: 0 })).toMatchObject({ ok: false, field: 'quantity' });
    expect(receive(milk.id, { quantityMilli: 1.5 })).toMatchObject({ ok: false, field: 'quantity' });
    expect(receive('nope')).toMatchObject({ ok: false, field: 'product' });
    expect(receive(product('none').id)).toMatchObject({ ok: false, field: 'product' });

    const lot = product('batch');
    const b = ok(receive(lot.id, { expiresAt: Date.now() + DAY }));
    expect(b.batch.expiresAt).toBeNull(); // no expiry kept for a product that does not expire

    const loose = product('quantity');
    const q1 = ok(receive(loose.id, { batchNumber: 'ignored', expiresAt: 5 }));
    const q2 = ok(receive(loose.id, { quantityMilli: 3_000 }));
    expect(q1.batch.batchNumber).toBeNull();
    expect(q2.batch.id).toBe(q1.batch.id); // one unnamed batch
    expect(q2.batch.onHandMilli).toBe(13_000);
  });

  it('adjusts, wastes and expires stock but never below zero', () => {
    const milk = product('expiry');
    const batch = ok(receive(milk.id)).batch;
    expect(ok(adjustStock(db, { batchId: batch.id, type: 'waste', quantityMilli: 2_000, note: 'dropped' })).batch.onHandMilli).toBe(8_000);
    expect(ok(adjustStock(db, { batchId: batch.id, type: 'expired', quantityMilli: -1_000, note: null })).batch.onHandMilli).toBe(7_000); // sign ignored
    expect(ok(adjustStock(db, { batchId: batch.id, type: 'adjust', quantityMilli: 500, note: 'recount' })).batch.onHandMilli).toBe(7_500);
    expect(ok(adjustStock(db, { batchId: batch.id, type: 'adjust', quantityMilli: -500, note: null })).batch.onHandMilli).toBe(7_000);
    expect(adjustStock(db, { batchId: batch.id, type: 'waste', quantityMilli: 99_000, note: null })).toMatchObject({ ok: false, field: 'quantity' });
    expect(adjustStock(db, { batchId: batch.id, type: 'adjust', quantityMilli: 0, note: null })).toMatchObject({ ok: false, field: 'quantity' });
    expect(adjustStock(db, { batchId: batch.id, type: 'oops', quantityMilli: 1, note: null })).toMatchObject({ ok: false });
    expect(adjustStock(db, { batchId: 'nope', type: 'waste', quantityMilli: 1, note: null })).toMatchObject({ ok: false });
    // Quantities on hand always equal the ledger's sum.
    const sum = db.$client.prepare('SELECT SUM(quantity_milli) AS s FROM stock_movements WHERE batch_id = ?').get(batch.id) as { s: number };
    expect(sum.s).toBe(7_000);
  });

  it('the ledger itself refuses a movement whose sign does not match its type', () => {
    const milk = product('quantity');
    const batch = ok(receive(milk.id)).batch;
    const insert = (type: string, qty: number) =>
      db.$client
        .prepare("INSERT INTO stock_movements (id, product_id, batch_id, type, quantity_milli, at) VALUES (?, ?, ?, ?, ?, 1)")
        .run(`m-${type}-${qty}`, milk.id, batch.id, type, qty);
    expect(() => insert('receive', -5)).toThrow(/CHECK/);
    expect(() => insert('sale', 5)).toThrow(/CHECK/);
    expect(() => insert('waste', 0)).toThrow(/CHECK/);
    expect(() => insert('adjust', -5)).not.toThrow();
  });

  it('sells first-expiring-first-out, skips expired batches, and costs the line from the batches used', () => {
    const milk = product('expiry');
    const now = Date.now();
    ok(receive(milk.id, { batchNumber: 'OLD', expiresAt: now - DAY, quantityMilli: 5_000, unitCost: 10 })); // already expired
    ok(receive(milk.id, { batchNumber: 'LATE', expiresAt: now + 20 * DAY, quantityMilli: 5_000, unitCost: 40 }));
    ok(receive(milk.id, { batchNumber: 'SOON', expiresAt: now + 2 * DAY, quantityMilli: 3_000, unitCost: 20 }));

    const sale = allocateSale(db, { productId: milk.id, orderLineId: saleLine('line-1'), quantityMilli: 4_000, at: now });
    expect(sale.allocations.map((a) => [a.quantityMilli, a.unitCost])).toEqual([[3_000, 20], [1_000, 40]]); // SOON first, then LATE
    expect(sale.shortfallMilli).toBe(0);
    expect(sale.unitCost).toBe(25); // (3 x 20 + 1 x 40) / 4

    const byLot = Object.fromEntries(listBatches(db, { includeEmpty: true }).filter((b) => b.productId === milk.id).map((b) => [b.batchNumber, b.onHandMilli]));
    expect(byLot).toEqual({ OLD: 5_000, LATE: 4_000, SOON: 0 }); // the expired lot was left alone
    expect(listBatches(db).some((b) => b.batchNumber === 'SOON')).toBe(false); // emptied batches are hidden

    const more = allocateSale(db, { productId: milk.id, orderLineId: saleLine('line-2'), quantityMilli: 9_000, at: now });
    expect(more.shortfallMilli).toBe(5_000); // only 4 left that may be sold
  });

  it('restocking a sale returns the stock to the same batches, once', () => {
    const milk = product('expiry');
    ok(receive(milk.id, { quantityMilli: 4_000 }));
    allocateSale(db, { productId: milk.id, orderLineId: saleLine('line-9'), quantityMilli: 3_000 });
    expect(listBatches(db)[0]?.onHandMilli).toBe(1_000);
    expect(restockSale(db, 'line-9', 'refund')).toBe(1);
    expect(listBatches(db)[0]?.onHandMilli).toBe(4_000);
    expect(restockSale(db, 'line-9', 'refund')).toBe(0); // already put back
    expect(restockSale(db, 'unknown-line', 'void')).toBe(0);
  });

  describe('completing an order', () => {
    const cash = (lines: { productId: string; quantityMilli: number; unitPrice: number }[], tendered = 100_000, discount = 0) =>
      completeOrder(db, { lines, discount, payment: { method: 'cash', tendered } });
    const onHand = (productId: string): number => listBatches(db).filter((b) => b.productId === productId).reduce((n, b) => n + b.onHandMilli, 0);

    it('numbers orders SO-1001, SO-1002, ...', () => {
      expect(nextOrderNumber(db)).toBe('SO-1001');
      const item = product('none');
      expect(ok(cash([{ productId: item.id, quantityMilli: 1_000, unitPrice: 100 }]))).toMatchObject({ orderNumber: 'SO-1001' });
      expect(nextOrderNumber(db)).toBe('SO-1002');
    });

    it('records the order, lines, payment and stock, and removes the saved draft', () => {
      const milk = product('expiry', { price: 250 });
      ok(receive(milk.id, { quantityMilli: 10_000, unitCost: 100 }));
      saveDraft(db, { lines: [{ productId: milk.id, name: 'Milk', quantityMilli: 2_000, unitPrice: 250, unit: 'each' }] });

      const result = ok(cash([{ productId: milk.id, quantityMilli: 2_000, unitPrice: 250 }], 1_000, 50));
      expect(result).toMatchObject({ total: 450, change: 550 });

      expect(db.select().from(orders).where(eq(orders.id, result.orderId)).get()).toMatchObject({ status: 'completed', subtotal: 500, discountTotal: 50, total: 450 });
      const [line] = db.select().from(orderLines).where(eq(orderLines.orderId, result.orderId)).all();
      expect(line).toMatchObject({ name: milk.name, unitPrice: 250, quantityMilli: 2_000, lineTotal: 500, unitCost: 100 });
      expect(db.select().from(payments).where(eq(payments.orderId, result.orderId)).all()).toMatchObject([{ method: 'cash', amount: 450, tendered: 1_000, change: 550 }]);
      expect(onHand(milk.id)).toBe(8_000);
      expect(loadDraft(db)).toBeNull();
    });

    it('reads an order back with its lines, payments and who sold it, and lists orders newest first', () => {
      const beef = product('none', { unit: 'kg', price: 899 });
      const bread = product('none', { price: 300 });
      const first = ok(completeOrder(db, { lines: [{ productId: bread.id, quantityMilli: 1_000, unitPrice: 300 }], discount: 0, payment: { method: 'cash', tendered: 500 } }, 1_000));
      const second = ok(completeOrder(db, { lines: [{ productId: beef.id, quantityMilli: 1_500, unitPrice: 899 }, { productId: bread.id, quantityMilli: 2_000, unitPrice: 300 }], discount: 100, payment: { method: 'card', reference: 'S1' } }, 2_000));

      const detail = getOrder(db, second.orderId)!;
      expect(detail).toMatchObject({ orderNumber: 'SO-1002', status: 'completed', employeeName: 'Register', subtotal: 1_949, discountTotal: 100, total: 1_849, completedAt: 2_000 });
      expect(detail.lines.map((l) => [l.name, l.quantityMilli, l.lineTotal, l.unit])).toEqual(
        expect.arrayContaining([[beef.name, 1_500, 1_349, 'kg'], [bread.name, 2_000, 600, 'each']]),
      );
      expect(detail.payments).toEqual([{ method: 'card', amount: 1_849, tendered: null, change: null, reference: 'S1' }]);
      expect(detail.lines.map((l) => l.productId).sort()).toEqual([beef.id, bread.id].sort());
      expect(getOrder(db, 'nope')).toBeNull();
      expect(getOrder(db, 42)).toBeNull();

      const list = listOrders(db);
      expect(list.map((o) => o.orderNumber)).toEqual(['SO-1002', 'SO-1001']);
      expect(list[0]).toMatchObject({ id: second.orderId, employeeName: 'Register', total: 1_849, itemCount: 2, methods: ['card'] });
      expect(list[1]).toMatchObject({ id: first.orderId, itemCount: 1, methods: ['cash'] });
    });

    describe('void and refund', () => {
      const sell = (productId: string, quantityMilli = 4_000) => ok(cash([{ productId, quantityMilli, unitPrice: 100 }]));

      it('a void puts the stock back, marks the order voided and writes an audit entry with the reason', () => {
        const milk = product('expiry');
        ok(receive(milk.id, { quantityMilli: 10_000 }));
        const sale = sell(milk.id);
        expect(onHand(milk.id)).toBe(6_000);

        const result = ok(voidOrder(db, { orderId: sale.orderId, reason: '  Wrong item  ' }));
        expect(result).toMatchObject({ orderId: sale.orderId, orderNumber: sale.orderNumber });
        expect(onHand(milk.id)).toBe(10_000);
        expect(db.select().from(orders).where(eq(orders.id, sale.orderId)).get()).toMatchObject({ status: 'voided' });
        const [entry] = db.select().from(auditLog).where(eq(auditLog.entityId, sale.orderId)).all();
        expect(entry).toMatchObject({ action: 'order.void', entity: 'order', detail: { orderNumber: sale.orderNumber, reason: 'Wrong item' } });
        expect(entry.employeeId).toBeTruthy();
        // The ledger shows the sale and its reversal.
        const types = db.$client.prepare("SELECT type FROM stock_movements WHERE product_id = ? ORDER BY at, rowid").all(milk.id).map((r) => (r as { type: string }).type);
        expect(types).toEqual(['receive', 'sale', 'void']);
      });

      it('a refund records a negative order linked to the sale, reverses its payment and returns the stock', () => {
        const milk = product('quantity');
        ok(receive(milk.id, { quantityMilli: 10_000 }));
        const sale = sell(milk.id);
        const result = ok(refundOrder(db, { orderId: sale.orderId, reason: 'Spoiled' }));
        expect(result).toMatchObject({ orderId: sale.orderId, refundOrderNumber: 'SO-1002' });

        expect(onHand(milk.id)).toBe(10_000);
        expect(db.select().from(orders).where(eq(orders.id, sale.orderId)).get()?.status).toBe('refunded');
        const refund = db.select().from(orders).where(eq(orders.id, result.refundOrderId!)).get()!;
        expect(refund).toMatchObject({ refundOfOrderId: sale.orderId, status: 'completed', subtotal: -400, discountTotal: 0, total: -400 });
        expect(db.select().from(orderLines).where(eq(orderLines.orderId, refund.id)).all()).toMatchObject([{ quantityMilli: -4_000, lineTotal: -400, unitPrice: 100 }]);
        expect(db.select().from(payments).where(eq(payments.orderId, refund.id)).all()).toMatchObject([{ method: 'cash', amount: -400, tendered: null, change: null }]);

        expect(getOrder(db, sale.orderId)).toMatchObject({ status: 'refunded', refundOf: null, refundedBy: { id: refund.id, orderNumber: 'SO-1002' } });
        expect(getOrder(db, refund.id)).toMatchObject({ refundOf: { id: sale.orderId, orderNumber: sale.orderNumber }, refundedBy: null, total: -400 });
        expect(listOrders(db).map((o) => [o.orderNumber, o.isRefund])).toEqual([['SO-1002', true], ['SO-1001', false]]);
        expect(db.select().from(auditLog).where(eq(auditLog.entityId, sale.orderId)).get()).toMatchObject({ action: 'order.refund', detail: { reason: 'Spoiled', refundOrderNumber: 'SO-1002' } });
      });

      it('only a completed sale can be reversed, once, and a reason is required', () => {
        const item = product('none');
        const sale = sell(item.id, 1_000);
        expect(voidOrder(db, { orderId: sale.orderId, reason: '' })).toMatchObject({ ok: false, error: 'Give a reason' });
        expect(voidOrder(db, { orderId: sale.orderId, reason: '   ' })).toMatchObject({ ok: false });
        expect(voidOrder(db, { orderId: 7, reason: 'x' })).toMatchObject({ ok: false });
        expect(voidOrder(db, { orderId: 'nope', reason: 'x' })).toMatchObject({ ok: false, error: 'Order not found' });
        expect(db.select().from(orders).where(eq(orders.id, sale.orderId)).get()?.status).toBe('completed'); // nothing changed

        ok(voidOrder(db, { orderId: sale.orderId, reason: 'x' }));
        expect(voidOrder(db, { orderId: sale.orderId, reason: 'x' })).toMatchObject({ ok: false, error: `${sale.orderNumber} is already voided` });
        expect(refundOrder(db, { orderId: sale.orderId, reason: 'x' })).toMatchObject({ ok: false, error: `${sale.orderNumber} is already voided` });

        const other = sell(item.id, 1_000);
        const refunded = ok(refundOrder(db, { orderId: other.orderId, reason: 'x' }));
        expect(refundOrder(db, { orderId: other.orderId, reason: 'x' })).toMatchObject({ ok: false, error: `${other.orderNumber} is already refunded` });
        // A refund order is not a sale: it cannot be voided or refunded itself.
        expect(voidOrder(db, { orderId: refunded.refundOrderId, reason: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('is a refund') });
        expect(refundOrder(db, { orderId: refunded.refundOrderId, reason: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('is a refund') });
      });

      it('a sale whose stock was already put back is not put back twice', () => {
        const milk = product('quantity');
        ok(receive(milk.id, { quantityMilli: 10_000 }));
        const sale = sell(milk.id);
        ok(voidOrder(db, { orderId: sale.orderId, reason: 'x' }));
        expect(onHand(milk.id)).toBe(10_000);
        voidOrder(db, { orderId: sale.orderId, reason: 'x' });
        expect(onHand(milk.id)).toBe(10_000);
      });
    });

    it('keeps the payment methods in step with core; e-wallet and bank transfer keep a reference and no cash fields, and refund with the same method', () => {
      expect([...PAYMENT_METHODS]).toEqual([...ORDER_PAYMENT_METHODS]);
      expect(ORDER_PAYMENT_METHODS).toEqual(expect.arrayContaining(['ewallet', 'bank_transfer']));
      const item = product('none');
      const line = { productId: item.id, quantityMilli: 1_000, unitPrice: 100 };
      for (const method of ['ewallet', 'bank_transfer'] as const) {
        const result = ok(completeOrder(db, { lines: [line], discount: 0, payment: { method, tendered: 5_000, reference: `REF-${method}` } }));
        expect(result.change).toBe(0); // only cash gives change
        expect(db.select().from(payments).where(eq(payments.orderId, result.orderId)).get()).toMatchObject({ method, amount: 100, tendered: null, change: null, reference: `REF-${method}` });
        const refund = ok(refundOrder(db, { orderId: result.orderId, reason: 'x' }));
        expect(db.select().from(payments).where(eq(payments.orderId, refund.refundOrderId!)).get()).toMatchObject({ method, amount: -100, reference: `REF-${method}` });
      }
      expect(completeOrder(db, { lines: [line], discount: 0, payment: { method: 'crypto' } })).toMatchObject({ ok: false });
    });

    it('prices a weighed line from its weight', () => {
      const beef = product('none', { unit: 'kg', price: 899 });
      const result = ok(cash([{ productId: beef.id, quantityMilli: 1_250, unitPrice: 899 }]));
      expect(result.total).toBe(1_124); // 8.99 x 1.25 = 11.2375
    });

    it('rolls everything back when one line is short of stock', () => {
      const milk = product('quantity');
      const eggs = product('quantity');
      ok(receive(milk.id, { quantityMilli: 5_000 }));
      ok(receive(eggs.id, { quantityMilli: 1_000 }));
      const result = cash([
        { productId: milk.id, quantityMilli: 2_000, unitPrice: 100 },
        { productId: eggs.id, quantityMilli: 3_000, unitPrice: 100 },
      ]);
      expect(result).toMatchObject({ ok: false, lines: [{ productId: eggs.id, kind: 'stock' }] });
      expect(onHand(milk.id)).toBe(5_000); // the milk that was already allocated is back
      expect(onHand(eggs.id)).toBe(1_000);
      expect(db.select().from(orders).all()).toHaveLength(0);
      expect(nextOrderNumber(db)).toBe('SO-1001');
    });

    it('does not sell expired stock', () => {
      const milk = product('expiry');
      ok(receive(milk.id, { expiresAt: Date.now() - DAY, quantityMilli: 5_000 }));
      expect(cash([{ productId: milk.id, quantityMilli: 1_000, unitPrice: 100 }])).toMatchObject({ ok: false, lines: [{ kind: 'stock' }] });
    });

    it('refuses a changed price, handing back the current one, and an item that is gone', () => {
      const a = product('none', { price: 100 });
      const b = product('none');
      updateProduct(db, a.id, { ...a, price: 120, categoryIds: [] });
      deleteProducts(db, [b.id]);
      const result = cash([
        { productId: a.id, quantityMilli: 1_000, unitPrice: 100 },
        { productId: b.id, quantityMilli: 1_000, unitPrice: 100 },
      ]);
      expect(result).toMatchObject({
        ok: false,
        lines: [
          { productId: a.id, kind: 'price', current: { unitPrice: 120 } },
          { productId: b.id, kind: 'unavailable' },
        ],
      });
      expect(db.select().from(orders).all()).toHaveLength(0);
    });

    it('validates the order and payment', () => {
      const item = product('none');
      const line = { productId: item.id, quantityMilli: 1_000, unitPrice: 100 };
      expect(cash([])).toMatchObject({ ok: false });
      expect(cash([{ ...line, quantityMilli: 0 }])).toMatchObject({ ok: false });
      expect(cash([{ ...line, unitPrice: 1.5 }])).toMatchObject({ ok: false });
      expect(cash([line], 50)).toMatchObject({ ok: false, error: expect.stringContaining('cash') }); // does not cover 1.00
      expect(cash([line], 1_000, 500)).toMatchObject({ ok: false, error: expect.stringContaining('discount') });
      expect(completeOrder(db, { lines: [line], discount: 0, payment: { method: 'barter' } })).toMatchObject({ ok: false });
      const card = ok(completeOrder(db, { lines: [line], discount: 0, payment: { method: 'card', reference: ' SLIP-1 ' } }));
      expect(db.select().from(payments).where(eq(payments.orderId, card.orderId)).get()).toMatchObject({ method: 'card', amount: 100, tendered: null, reference: 'SLIP-1' });
      expect(card.change).toBe(0);
    });

    it('sells in the name of the first active employee, or a Register employee on a fresh database', () => {
      const item = product('none');
      const first = ok(cash([{ productId: item.id, quantityMilli: 1_000, unitPrice: 100 }]));
      const register = db.select().from(employees).all();
      expect(register).toMatchObject([{ name: 'Register', pinHash: '!' }]);
      expect(verifyPin('0000', register[0].pinHash)).toBe(false);
      ok(cash([{ productId: item.id, quantityMilli: 1_000, unitPrice: 100 }]));
      expect(db.select().from(employees).all()).toHaveLength(1); // reused
      expect(db.select().from(orders).where(eq(orders.id, first.orderId)).get()?.employeeId).toBe(register[0].id);
    });
  });

  it('untracked products are not allocated', () => {
    const plain = product('none');
    expect(allocateSale(db, { productId: plain.id, orderLineId: 'l', quantityMilli: 1_000 })).toEqual({ allocations: [], shortfallMilli: 0, unitCost: null });
  });

  it('summarises stock for the overview: values, expiry, out of stock, waste and recent activity', () => {
    const now = Date.now();
    const milk = product('expiry', { price: 200 });
    const eggs = product('quantity', { price: 100 });
    product('quantity'); // tracked, never received: out of stock
    product('none'); // not tracked: not counted
    ok(receive(milk.id, { batchNumber: 'OLD', expiresAt: now - DAY, quantityMilli: 2_000, unitCost: 50 }));
    ok(receive(milk.id, { batchNumber: 'SOON', expiresAt: now + DAY, quantityMilli: 3_000, unitCost: 60 }));
    ok(receive(milk.id, { batchNumber: 'FINE', expiresAt: now + 30 * DAY, quantityMilli: 4_000, unitCost: 70 }));
    ok(receive(eggs.id, { quantityMilli: 5_000, unitCost: 20 }));
    const old = listBatches(db).find((b) => b.batchNumber === 'OLD')!;
    ok(adjustStock(db, { batchId: old.id, type: 'expired', quantityMilli: 500, note: 'bin' })); // 0.5 x 50 = 25

    const o = inventoryOverview(db, now);
    expect(o.trackedProducts).toBe(3);
    expect(o.outOfStockCount).toBe(1);
    expect(o.outOfStockProducts).toHaveLength(1);
    // Cost: OLD 1.5 x 50 + SOON 3 x 60 + FINE 4 x 70 + eggs 5 x 20 = 75 + 180 + 280 + 100
    expect(o.stockValueCost).toBe(635);
    // Retail: milk (1.5 + 3 + 4) x 200 + eggs 5 x 100
    expect(o.stockValueRetail).toBe(1700 + 500);
    expect(o.expired).toEqual({ batches: 1, valueCost: 75 });
    expect(o.expiringSoon).toEqual({ batches: 1, valueCost: 180 });
    expect(o.wasteLast30Days).toEqual({ entries: 1, valueCost: 25 });
    expect(o.attention.map((b) => b.batchNumber)).toEqual(['OLD', 'SOON']); // expired first, then soonest
    expect(o.recentMovements[0]).toMatchObject({ type: 'expired', quantityMilli: -500, note: 'bin' }); // newest first
    expect(o.recentMovements[1]).toMatchObject({ type: 'receive', productName: eggs.name });
  });

  describe('repackaging (opening a pack)', () => {
    const sack = () => product('expiry', { name: `Rice sack ${Math.random()}`, price: 2_000_00, cost: 1_500_00 });
    const loose = (over: Record<string, unknown> = {}) =>
      product('expiry', { unit: 'kg', barcode: String(1000 + Math.floor(Math.random() * 8999)), price: 50_00, cost: null, ...over });
    const onHand = (id: string) => listBatches(db, { includeEmpty: true }).filter((b) => b.productId === id);

    it('moves a sack into loose kilos, carrying lot, expiry and cost, and ties the movements together', () => {
      const rice = sack();
      const kilos = loose();
      ok(receive(rice.id, { batchNumber: 'S1', quantityMilli: 3_000, unitCost: 1_500_00 }));
      ok(receive(kilos.id, { batchNumber: 'OLD', quantityMilli: 25_500, unitCost: 30_00 }));

      const r = ok(repackageStock(db, { productId: rice.id, quantityMilli: 1_000, targets: [{ productId: kilos.id, quantityMilli: 50_000, expiresAt: null }], note: null }));
      expect(onHand(rice.id)[0]!.onHandMilli).toBe(2_000);
      const batches = onHand(kilos.id);
      expect(batches.reduce((sum, b) => sum + b.onHandMilli, 0)).toBe(75_500); // 25.5 kg became 75.5 kg
      const made = batches.find((b) => b.batchNumber === 'S1')!;
      expect(made).toMatchObject({ onHandMilli: 50_000, expiresAt: SOON_ISH, unitCost: 30_00 }); // 1 500 / 50 kg
      const rows = db.$client.prepare('SELECT type, quantity_milli AS q FROM stock_movements WHERE repackage_id = ? ORDER BY quantity_milli').all(r.repackageId);
      expect(rows).toEqual([
        { type: 'repack_out', q: -1_000 },
        { type: 'repack_in', q: 50_000 },
      ]);
    });

    it('splits one sack into smaller bags and loose rice, sharing the cost by retail value', () => {
      const rice = sack();
      const bags = product('expiry', { name: `Rice 10 kg ${Math.random()}`, price: 500_00, cost: null });
      const kilos = loose();
      ok(receive(rice.id, { quantityMilli: 1_000, unitCost: 1_000_00 }));
      ok(repackageStock(db, {
        productId: rice.id,
        quantityMilli: 1_000,
        targets: [
          { productId: bags.id, quantityMilli: 2_000, expiresAt: null }, // 2 bags worth 1 000
          { productId: kilos.id, quantityMilli: 30_000, expiresAt: null }, // 30 kg worth 1 500
        ],
        note: 'opened',
      }));
      expect(onHand(rice.id)[0]!.onHandMilli).toBe(0);
      // 1 000 shared 40 / 60: 400 over 2 bags, 600 over 30 kg.
      expect(onHand(bags.id)[0]).toMatchObject({ onHandMilli: 2_000, unitCost: 200_00 });
      expect(onHand(kilos.id)[0]).toMatchObject({ onHandMilli: 30_000, unitCost: 20_00 });
    });

    it('takes from the soonest-expiring batch first, never an expired one, and splits targets across source batches', () => {
      const rice = sack();
      const kilos = loose();
      ok(receive(rice.id, { batchNumber: 'OLDEST', expiresAt: Date.now() - DAY, quantityMilli: 5_000 }));
      ok(receive(rice.id, { batchNumber: 'A', expiresAt: Date.now() + 5 * DAY, quantityMilli: 1_000 }));
      ok(receive(rice.id, { batchNumber: 'B', expiresAt: Date.now() + 9 * DAY, quantityMilli: 4_000 }));
      ok(repackageStock(db, { productId: rice.id, quantityMilli: 3_000, targets: [{ productId: kilos.id, quantityMilli: 150_000, expiresAt: null }], note: null }));
      const left = Object.fromEntries(onHand(rice.id).map((b) => [b.batchNumber, b.onHandMilli]));
      expect(left).toEqual({ OLDEST: 5_000, A: 0, B: 2_000 });
      const made = Object.fromEntries(onHand(kilos.id).map((b) => [b.batchNumber, b.onHandMilli]));
      expect(made).toEqual({ A: 50_000, B: 100_000 }); // 1 of 3 sacks came from A, 2 from B
    });

    it('asks for an expiry when the source has none but the target expires, and allows loss', () => {
      const plain = product('quantity', { name: `Sack ${Math.random()}` });
      const kilos = loose();
      ok(receive(plain.id, { batchNumber: null, expiresAt: null, quantityMilli: 1_000 }));
      const t = { productId: kilos.id, quantityMilli: 48_500, expiresAt: null };
      expect(repackageStock(db, { productId: plain.id, quantityMilli: 1_000, targets: [t], note: null })).toMatchObject({ ok: false, field: 'targets' });
      expect(onHand(plain.id)[0]!.onHandMilli).toBe(1_000); // nothing was written
      ok(repackageStock(db, { productId: plain.id, quantityMilli: 1_000, targets: [{ ...t, expiresAt: SOON_ISH }], note: null }));
      expect(onHand(kilos.id)[0]).toMatchObject({ onHandMilli: 48_500, expiresAt: SOON_ISH });
    });

    it('rejects bad requests and writes nothing', () => {
      const rice = sack();
      const kilos = loose();
      const untracked = product('none');
      ok(receive(rice.id, { quantityMilli: 1_000 }));
      const t = (productId: string, quantityMilli = 1_000) => ({ productId, quantityMilli, expiresAt: null });
      const before = db.$client.prepare('SELECT COUNT(*) AS n FROM stock_movements').get();
      const bad = (over: Record<string, unknown>) => repackageStock(db, { productId: rice.id, quantityMilli: 1_000, targets: [t(kilos.id)], note: null, ...over });
      expect(bad({ quantityMilli: 2_000 })).toMatchObject({ ok: false, field: 'quantity' }); // only 1 sack
      expect(bad({ quantityMilli: 0 })).toMatchObject({ ok: false, field: 'quantity' });
      expect(bad({ targets: [] })).toMatchObject({ ok: false, field: 'targets' });
      expect(bad({ targets: [t(rice.id)] })).toMatchObject({ ok: false, field: 'targets' }); // into itself
      expect(bad({ targets: [t(kilos.id), t(kilos.id)] })).toMatchObject({ ok: false, field: 'targets' });
      expect(bad({ targets: [t(untracked.id)] })).toMatchObject({ ok: false, field: 'targets' });
      expect(bad({ productId: untracked.id })).toMatchObject({ ok: false, field: 'source' });
      expect(bad({ productId: 'nope' })).toMatchObject({ ok: false, field: 'source' });
      expect(db.$client.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual(before);
    });

  it('keeps a half-filled Repackage form as a draft, cleaned of anything malformed', () => {
    expect(loadRepackageDraft(db)).toBeNull();
    saveRepackageDraft(db, { productId: 'a', quantity: '1', targets: [{ productId: 'b', quantity: '48.5', expiry: '' }, 'junk'], note: 'n', extra: 1 });
    expect(loadRepackageDraft(db)).toEqual({
      productId: 'a',
      quantity: '1',
      targets: [{ productId: 'b', quantity: '48.5', expiry: '' }, { productId: null, quantity: '', expiry: '' }],
      note: 'n',
    });
    clearRepackageDraft(db);
    expect(loadRepackageDraft(db)).toBeNull();
  });

    it('keeps the sign rule: repack_out must remove and repack_in must add', () => {
      const rice = sack();
      ok(receive(rice.id));
      const [b] = onHand(rice.id);
      const insert = (type: string, q: number) =>
        db.$client.prepare('INSERT INTO stock_movements (id, product_id, batch_id, type, quantity_milli, at) VALUES (?, ?, ?, ?, ?, 1)').run(`m-${type}-${q}`, rice.id, b!.id, type, q);
      expect(() => insert('repack_out', 1_000)).toThrow();
      expect(() => insert('repack_in', -1_000)).toThrow();
      expect(() => insert('repack_in', 1_000)).not.toThrow();
    });
  });

  it('seeded data is consistent: stock never negative, ledger sums match, sold lines carry costs', () => {
    seedDatabase(db, { orders: 80, extraProducts: 4 });
    const batches = listBatches(db, { includeEmpty: true });
    expect(batches.length).toBeGreaterThan(0);
    for (const b of batches) expect(b.onHandMilli).toBeGreaterThanOrEqual(0);
    expect(batches.some((b) => b.expiresAt !== null && b.expiresAt < Date.now())).toBe(true); // an expired lot to demo
    expect(batches.some((b) => b.expiresAt !== null && b.expiresAt > Date.now() && b.expiresAt < Date.now() + 3 * DAY)).toBe(true);
    const costed = db.$client.prepare('SELECT COUNT(*) AS n FROM order_lines WHERE unit_cost IS NOT NULL').get() as { n: number };
    expect(costed.n).toBeGreaterThan(0);
    expect(db.$client.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('category management', () => {
  const make = (name: string, sortOrder = 0) => {
    const r = createCategory(db, { name, sortOrder });
    if (!r.ok) throw new Error(r.error);
    return r.category;
  };

  it('creates, lists in order, updates and counts live products', () => {
    const b = make('Bakery', 2);
    const a = make('  Dairy  ', 1); // spaces trimmed
    expect(listCategoryRecords(db).map((c) => c.name)).toEqual(['Dairy', 'Bakery']); // by order, then name
    const product = createProduct(db, { name: 'Milk', unit: 'each', tracking: 'none', shelfLifeDays: null, sku: null, barcode: null, price: 1, cost: null, active: true, categoryIds: [a.id] });
    if (!product.ok) throw new Error('product');
    createProduct(db, { name: 'Bread', unit: 'each', tracking: 'none', shelfLifeDays: null, sku: null, barcode: null, price: 1, cost: null, active: true, categoryIds: [a.id, b.id] });
    expect(listCategoryRecords(db).find((c) => c.id === a.id)?.productCount).toBe(2);
    deleteProducts(db, [product.product.id]);
    expect(listCategoryRecords(db).find((c) => c.id === a.id)?.productCount).toBe(1); // a deleted product no longer counts
    const renamed = updateCategory(db, a.id, { name: 'Milk and eggs', sortOrder: 5 });
    expect(renamed).toMatchObject({ ok: true, category: { name: 'Milk and eggs', sortOrder: 5 } });
  });

  it('rejects empty, long and duplicate names (ignoring case) and bad orders', () => {
    make('Dairy');
    expect(createCategory(db, { name: '  ', sortOrder: 0 })).toMatchObject({ ok: false, field: 'name' });
    expect(createCategory(db, { name: 'x'.repeat(101), sortOrder: 0 })).toMatchObject({ ok: false, field: 'name' });
    expect(createCategory(db, { name: 'dairy', sortOrder: 0 })).toMatchObject({ ok: false, field: 'name', error: 'Name is already used' });
    expect(createCategory(db, { name: 'Other', sortOrder: -1 })).toMatchObject({ ok: false, field: 'sortOrder' });
    expect(createCategory(db, { name: 'Other', sortOrder: 1.5 })).toMatchObject({ ok: false, field: 'sortOrder' });
    const d = make('Frozen');
    expect(updateCategory(db, d.id, { name: 'Frozen', sortOrder: 3 }).ok).toBe(true); // keeps its own name
    expect(updateCategory(db, d.id, { name: 'DAIRY', sortOrder: 3 })).toMatchObject({ ok: false, field: 'name' });
    expect(updateCategory(db, 'nope', { name: 'Z', sortOrder: 0 })).toMatchObject({ ok: false });
  });

  it('deletes and restores, keeping the product links, and skips a restore whose name was taken', () => {
    const a = make('Produce');
    const b = make('Snacks');
    const product = createProduct(db, { name: 'Apple', unit: 'each', tracking: 'none', shelfLifeDays: null, sku: null, barcode: null, price: 1, cost: null, active: true, categoryIds: [a.id] });
    if (!product.ok) throw new Error('product');
    deleteCategories(db, [a.id, b.id, 'nope', 7]); // unknown or malformed ids are ignored
    expect(listCategoryRecords(db)).toHaveLength(0);
    expect(listProductRecords(db)[0]?.categories).toEqual([]); // a deleted category is not shown on its product
    expect(listCategoryRecords(db, true)).toHaveLength(2);
    make('snacks'); // the name is free again, so it can be reused
    expect(restoreCategories(db, [a.id, b.id])).toEqual({ restored: 1, conflicts: ['Snacks'] });
    expect(listProductRecords(db)[0]?.categories.map((c) => c.name)).toEqual(['Produce']); // the link came back with it
    expect(restoreCategories(db, [a.id])).toEqual({ restored: 0, conflicts: [] }); // already live
    expect(restoreCategories(db, 'not a list')).toEqual({ restored: 0, conflicts: [] });
  });
});

describe('customers and credit sales', () => {
  const item = (price = 1_000) => {
    const r = createProduct(db, { name: `Item-${Math.random().toString(36).slice(2, 7)}`, unit: 'each', tracking: 'none', shelfLifeDays: null, sku: null, barcode: null, price, cost: null, active: true, categoryIds: [] });
    if (!r.ok) throw new Error(r.error);
    return r.product;
  };
  const customer = (over: Record<string, unknown> = {}) => {
    const r = createCustomer(db, { name: 'Aling Nena', phone: '0917 000 0000', note: null, creditLimit: null, ...over });
    if (!r.ok) throw new Error(r.error);
    return r.customer;
  };
  const credit = (productId: string, over: Record<string, unknown> = {}, price = 1_000) =>
    completeOrder(db, { lines: [{ productId, quantityMilli: 1_000, unitPrice: price }], discount: 0, payment: { method: 'cash', tendered: 500 }, ...over });
  const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r as Extract<T, { ok: true }>;
  };
  const balance = (id: string): number => listCustomers(db, true).find((c) => c.id === id)!.balance;

  it('validates, saves, lists and removes customers; one with a balance cannot be removed', () => {
    expect(createCustomer(db, { name: '  ', phone: null, note: null, creditLimit: null })).toMatchObject({ ok: false, field: 'name' });
    expect(createCustomer(db, { name: 'A', phone: 'x'.repeat(41), note: null, creditLimit: null })).toMatchObject({ ok: false, field: 'phone' });
    expect(createCustomer(db, { name: 'A', phone: null, note: 'x'.repeat(201), creditLimit: null })).toMatchObject({ ok: false, field: 'note' });
    expect(createCustomer(db, { name: 'A', phone: null, note: null, creditLimit: -5 })).toMatchObject({ ok: false, field: 'creditLimit' });
    expect(createCustomer(db, { name: 'A', phone: null, note: null, creditLimit: 1.5 })).toMatchObject({ ok: false, field: 'creditLimit' });

    const a = customer({ name: '  Aling   Nena ', phone: ' ', creditLimit: 5_000 });
    expect(a).toMatchObject({ name: 'Aling Nena', phone: null, creditLimit: 5_000, balance: 0, lastActivityAt: null, deletedAt: null });
    const b = customer({ name: 'Bong' });
    expect(listCustomers(db).map((c) => c.name)).toEqual(['Aling Nena', 'Bong']);
    expect(updateCustomer(db, a.id, { name: 'Nena', phone: '123', note: 'neighbour', creditLimit: null })).toMatchObject({ ok: true, customer: { name: 'Nena', phone: '123', creditLimit: null } });
    expect(updateCustomer(db, 'nope', { name: 'X', phone: null, note: null, creditLimit: null })).toMatchObject({ ok: false });

    ok(credit(item().id, { customerId: a.id, amountPaid: 0 }));
    expect(deleteCustomers(db, [a.id, b.id])).toEqual({ removed: 1, blocked: ['Nena'] });
    expect(listCustomers(db).map((c) => c.name)).toEqual(['Nena']);
    restoreCustomers(db, [b.id]);
    expect(listCustomers(db).map((c) => c.name)).toEqual(['Bong', 'Nena']);
  });

  it('a credit sale takes part now and puts the rest on the customer\'s account', () => {
    const c = customer();
    const result = ok(credit(item().id, { customerId: c.id, amountPaid: 300 }));
    expect(result).toMatchObject({ total: 1_000, change: 200, onAccount: 700 });

    expect(db.select().from(orders).where(eq(orders.id, result.orderId)).get()).toMatchObject({ customerId: c.id, total: 1_000, status: 'completed' });
    expect(db.select().from(payments).where(eq(payments.orderId, result.orderId)).all()).toMatchObject([{ method: 'cash', amount: 300, tendered: 500, change: 200 }]);
    expect(balance(c.id)).toBe(700);
    expect(getOrder(db, result.orderId)).toMatchObject({ customer: { id: c.id, name: 'Aling Nena' }, onAccount: 700 });
    expect(listOrders(db)[0]).toMatchObject({ customerName: 'Aling Nena', onAccount: 700 });
  });

  it('a sale paid nothing now is all on account and needs no money handed over; a sale paid in full touches no ledger', () => {
    const c = customer();
    const none = ok(credit(item().id, { customerId: c.id, amountPaid: 0, payment: { method: 'cash' } }));
    expect(none).toMatchObject({ change: 0, onAccount: 1_000 });
    expect(db.select().from(payments).where(eq(payments.orderId, none.orderId)).all()).toHaveLength(0);
    expect(balance(c.id)).toBe(1_000);

    const full = ok(credit(item().id, { customerId: c.id, payment: { method: 'card' } })); // no amountPaid: the whole total
    expect(full.onAccount).toBe(0);
    expect(balance(c.id)).toBe(1_000); // unchanged
    expect(db.select().from(orders).where(eq(orders.id, full.orderId)).get()?.customerId).toBe(c.id); // still linked to the customer
  });

  it('refuses a credit sale that is not valid, writing nothing', () => {
    const c = customer({ creditLimit: 1_500 });
    const gone = customer({ name: 'Gone' });
    deleteCustomers(db, [gone.id]);
    const p = item().id;
    expect(credit(p, { amountPaid: 300 })).toMatchObject({ ok: false, error: 'Choose a customer to put the rest on account' });
    expect(credit(p, { customerId: c.id, amountPaid: 1_500 })).toMatchObject({ ok: false, error: 'The amount paid is more than the total' });
    expect(credit(p, { customerId: c.id, amountPaid: -1 })).toMatchObject({ ok: false });
    expect(credit(p, { customerId: c.id, amountPaid: 1.5 })).toMatchObject({ ok: false });
    expect(credit(p, { customerId: 'nope', amountPaid: 0 })).toMatchObject({ ok: false, error: 'Customer not found' });
    expect(credit(p, { customerId: gone.id, amountPaid: 0 })).toMatchObject({ ok: false, error: 'Customer not found' });
    expect(credit(p, { customerId: c.id, amountPaid: 300, payment: { method: 'cash', tendered: 200 } })).toMatchObject({ ok: false, error: expect.stringContaining('cash') });
    expect(db.select().from(orders).all()).toHaveLength(0);

    // The credit limit counts what is already owed.
    ok(credit(p, { customerId: c.id, amountPaid: 500 })); // owes 500 of 1,500
    ok(credit(p, { customerId: c.id, amountPaid: 0 })); // +1,000 = 1,500: exactly at the limit is fine
    expect(balance(c.id)).toBe(1_500);
    expect(credit(p, { customerId: c.id, amountPaid: 500 })).toMatchObject({ ok: false, error: 'Aling Nena would owe more than their credit limit' }); // +500 > limit
    expect(balance(c.id)).toBe(1_500);
  });

  it('records payments against the balance, never more than is owed, and shows the account newest first with running balances', () => {
    const c = customer();
    const sale = ok(credit(item().id, { customerId: c.id, amountPaid: 0 }, 1_000));
    expect(receivePayment(db, { customerId: c.id, amount: 0, method: 'cash', reference: null })).toMatchObject({ ok: false, field: 'amount' });
    expect(receivePayment(db, { customerId: c.id, amount: 1.5, method: 'cash', reference: null })).toMatchObject({ ok: false, field: 'amount' });
    expect(receivePayment(db, { customerId: c.id, amount: 100, method: 'crypto', reference: null })).toMatchObject({ ok: false, field: 'method' });
    expect(receivePayment(db, { customerId: c.id, amount: 1_001, method: 'cash', reference: null })).toMatchObject({ ok: false, error: 'That is more than they owe' });
    expect(receivePayment(db, { customerId: 'nope', amount: 100, method: 'cash', reference: null })).toMatchObject({ ok: false });
    expect(receivePayment(db, { customerId: c.id, amount: 400, method: 'ewallet', reference: '  GC-1 ' })).toEqual({ ok: true, balance: 600 });
    expect(receivePayment(db, { customerId: c.id, amount: 600, method: 'cash', reference: null })).toEqual({ ok: true, balance: 0 });
    expect(receivePayment(db, { customerId: c.id, amount: 100, method: 'cash', reference: null })).toMatchObject({ ok: false, error: 'This customer owes nothing' });

    const account = getCustomerAccount(db, c.id)!;
    expect(account.customer.balance).toBe(0);
    expect(account.entries.map((e) => [e.type, e.amount, e.balanceAfter])).toEqual([['payment', -600, 0], ['payment', -400, 600], ['charge', 1_000, 1_000]]);
    expect(account.entries[1]).toMatchObject({ method: 'ewallet', reference: 'GC-1', employeeName: 'Register' });
    expect(account.entries[2]).toMatchObject({ orderId: sale.orderId, orderNumber: sale.orderNumber });
    expect(getCustomerAccount(db, 'nope')).toBeNull();
  });

  it('voiding a credit sale cancels what it left on account', () => {
    const c = customer();
    const sale = ok(credit(item().id, { customerId: c.id, amountPaid: 300 }));
    expect(balance(c.id)).toBe(700);
    ok(voidOrder(db, { orderId: sale.orderId, reason: 'Mistake' }));
    expect(balance(c.id)).toBe(0);
    expect(getCustomerAccount(db, c.id)!.entries.map((e) => [e.type, e.amount])).toEqual([['void', -700], ['charge', 700]]);
  });

  it('refunding a credit sale reverses the paid part as money and the rest on account, even after the debt was paid off', () => {
    const c = customer();
    const sale = ok(credit(item().id, { customerId: c.id, amountPaid: 300 }));
    ok(receivePayment(db, { customerId: c.id, amount: 700, method: 'cash', reference: null })); // paid off
    const refund = ok(refundOrder(db, { orderId: sale.orderId, reason: 'Returned' }));

    expect(db.select().from(payments).where(eq(payments.orderId, refund.refundOrderId!)).all()).toMatchObject([{ amount: -300 }]);
    expect(db.select().from(orders).where(eq(orders.id, refund.refundOrderId!)).get()).toMatchObject({ customerId: c.id, total: -1_000 });
    expect(balance(c.id)).toBe(-700); // the store now owes the customer what they had paid towards it
    expect(getOrder(db, refund.refundOrderId!)).toMatchObject({ onAccount: -700, customer: { name: 'Aling Nena' } });
    expect(getCustomerAccount(db, c.id)!.entries[0]).toMatchObject({ type: 'refund', amount: -700, orderId: refund.refundOrderId });
  });

  it('the ledger refuses entries whose sign does not match their type', () => {
    const c = customer();
    const insert = (type: string, amount: number) =>
      db.$client.prepare('INSERT INTO customer_ledger (id, customer_id, type, amount, at) VALUES (?, ?, ?, ?, 1)').run(`l-${type}-${amount}`, c.id, type, amount);
    expect(() => insert('charge', -5)).toThrow(/CHECK/);
    expect(() => insert('payment', 5)).toThrow(/CHECK/);
    expect(() => insert('void', 5)).toThrow(/CHECK/);
    expect(() => insert('adjustment', 0)).toThrow(/CHECK/);
    expect(() => insert('adjustment', -5)).not.toThrow();
    expect(() => insert('forgive', -5)).toThrow(/CHECK/);
  });
});

describe('purchases from suppliers', () => {
  const product = (over: Record<string, unknown> = {}) => {
    const r = createProduct(db, { name: `Item-${Math.random().toString(36).slice(2, 7)}`, unit: 'each', tracking: 'quantity', shelfLifeDays: null, sku: null, barcode: null, price: 2_000, cost: null, active: true, categoryIds: [], ...over });
    if (!r.ok) throw new Error(r.error);
    return r.product;
  };
  const supplier = (name = 'Metro Wholesale') => {
    const r = createSupplier(db, { name, phone: null, note: null });
    if (!r.ok) throw new Error(r.error);
    return r.supplier;
  };
  const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r as Extract<T, { ok: true }>;
  };
  /** An order for 10 of `p` at 1,000 each (total 10,000). */
  const order = (supplierId: string, p: { id: string }, over: Record<string, unknown> = {}) =>
    ok(createPurchase(db, { supplierId, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: p.id, quantityMilli: 10_000, unitCost: 1_000 }], ...over })).purchase;
  const onHand = (productId: string): number => listBatches(db).filter((b) => b.productId === productId).reduce((sum, b) => sum + b.onHandMilli, 0);

  it('validates, saves, lists and removes suppliers; one that is owed money cannot be removed', () => {
    expect(createSupplier(db, { name: ' ', phone: null, note: null })).toMatchObject({ ok: false, field: 'name' });
    expect(createSupplier(db, { name: 'A', phone: 'x'.repeat(41), note: null })).toMatchObject({ ok: false, field: 'phone' });
    expect(createSupplier(db, { name: 'A', phone: null, note: 'x'.repeat(201) })).toMatchObject({ ok: false, field: 'note' });
    const a = supplier('  Metro   Wholesale ');
    expect(a).toMatchObject({ name: 'Metro Wholesale', owed: 0, openOrders: 0 });
    const b = supplier('Bakery');
    expect(listSuppliers(db).map((s) => s.name)).toEqual(['Bakery', 'Metro Wholesale']);
    expect(updateSupplier(db, a.id, { name: 'Metro', phone: '123', note: null })).toMatchObject({ ok: true, supplier: { name: 'Metro', phone: '123' } });
    expect(updateSupplier(db, 'nope', { name: 'X', phone: null, note: null })).toMatchObject({ ok: false });

    order(a.id, product());
    expect(listSuppliers(db).find((s) => s.id === a.id)).toMatchObject({ owed: 10_000, openOrders: 1 });
    expect(deleteSuppliers(db, [a.id, b.id])).toEqual({ removed: 1, blocked: ['Metro'] });
    expect(listSuppliers(db).map((s) => s.name)).toEqual(['Metro']);
    restoreSuppliers(db, [b.id]);
    expect(listSuppliers(db).map((s) => s.name)).toEqual(['Bakery', 'Metro']);
  });

  it('places an order: numbered, totalled, nothing received or paid yet', () => {
    const s = supplier();
    const a = product();
    const b = product({ unit: 'kg' });
    const first = ok(createPurchase(db, { supplierId: s.id, expectedAt: 1_900_000_000_000, dueAt: 1_900_100_000_000, reference: ' INV-77 ', note: 'bulk', lines: [{ productId: a.id, quantityMilli: 10_000, unitCost: 1_000 }, { productId: b.id, quantityMilli: 2_500, unitCost: 4_000 }] })).purchase;
    expect(first).toMatchObject({ number: 'PO-1001', status: 'ordered', total: 20_000, paid: 0, owed: 20_000, lineCount: 2, reference: 'INV-77', note: 'bulk', receivedAt: null, supplierName: 'Metro Wholesale' });
    expect(first.lines.map((l) => [l.productName === a.name, l.quantityMilli, l.unitCost, l.total])).toEqual([[true, 10_000, 1_000, 10_000], [false, 2_500, 4_000, 10_000]]);
    expect(order(s.id, a).number).toBe('PO-1002');
    expect(listPurchases(db).map((p) => p.number)).toEqual(['PO-1002', 'PO-1001']);
    expect(onHand(a.id)).toBe(0);
  });

  it('refuses a bad order', () => {
    const s = supplier();
    const a = product();
    const base = { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 1_000, unitCost: 100 }] };
    expect(createPurchase(db, { ...base, supplierId: 'nope' })).toMatchObject({ ok: false, field: 'supplier' });
    expect(createPurchase(db, { ...base, lines: [] })).toMatchObject({ ok: false, field: 'lines' });
    expect(createPurchase(db, { ...base, lines: [{ productId: a.id, quantityMilli: 0, unitCost: 100 }] })).toMatchObject({ ok: false, field: 'quantity' });
    expect(createPurchase(db, { ...base, lines: [{ productId: a.id, quantityMilli: 1_000, unitCost: -1 }] })).toMatchObject({ ok: false, field: 'unitCost' });
    expect(createPurchase(db, { ...base, lines: [{ productId: 'nope', quantityMilli: 1_000, unitCost: 1 }] })).toMatchObject({ ok: false, field: 'product' });
    expect(createPurchase(db, { ...base, lines: [base.lines[0], base.lines[0]] })).toMatchObject({ ok: false, field: 'product' });
    expect(createPurchase(db, { ...base, dueAt: -3 })).toMatchObject({ ok: false, field: 'dueAt' });
    expect(createPurchase(db, { ...base, reference: 'x'.repeat(201) })).toMatchObject({ ok: false, field: 'reference' });
    expect(listPurchases(db)).toEqual([]);
  });

  it('pays in parts, never more than is owed, and keeps every payment on record', () => {
    const s = supplier();
    const po = order(s.id, product());
    expect(payPurchase(db, { purchaseId: po.id, amount: 0, method: 'cash', reference: null })).toMatchObject({ ok: false, field: 'amount' });
    expect(payPurchase(db, { purchaseId: po.id, amount: 100, method: 'barter', reference: null })).toMatchObject({ ok: false, field: 'method' });
    expect(payPurchase(db, { purchaseId: po.id, amount: 10_001, method: 'cash', reference: null })).toMatchObject({ ok: false, field: 'amount' });

    const deposit = ok(payPurchase(db, { purchaseId: po.id, amount: 4_000, method: 'bank_transfer', reference: ' TX-1 ' })).purchase;
    expect(deposit).toMatchObject({ paid: 4_000, owed: 6_000 });
    expect(deposit.payments).toMatchObject([{ amount: 4_000, method: 'bank_transfer', reference: 'TX-1' }]);
    expect(listSuppliers(db)[0]).toMatchObject({ owed: 6_000 });
    const settled = ok(payPurchase(db, { purchaseId: po.id, amount: 6_000, method: 'cash', reference: null })).purchase;
    expect(settled).toMatchObject({ paid: 10_000, owed: 0 });
    expect(settled.payments).toHaveLength(2);
    expect(payPurchase(db, { purchaseId: po.id, amount: 1, method: 'cash', reference: null })).toMatchObject({ ok: false, error: 'Nothing is owed on this order' });
    expect(listSuppliers(db)[0]).toMatchObject({ owed: 0 });
    expect(() => db.$client.prepare("UPDATE purchase_payments SET amount = 0").run()).toThrow(/CHECK/);
  });

  it('edits an order that has not arrived, but not below what is paid', () => {
    const s = supplier();
    const a = product();
    const b = product();
    const po = order(s.id, a);
    ok(payPurchase(db, { purchaseId: po.id, amount: 6_000, method: 'cash', reference: null }));
    const lines = (cost: number) => [{ productId: b.id, quantityMilli: 10_000, unitCost: cost }];
    expect(updatePurchase(db, po.id, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: lines(500) })).toMatchObject({ ok: false, field: 'lines', error: 'The total is less than what is already paid' });
    expect(getPurchase(db, po.id)!.lines[0]!.productId).toBe(a.id); // nothing changed
    const changed = ok(updatePurchase(db, po.id, { supplierId: s.id, expectedAt: null, dueAt: null, reference: 'INV-9', note: null, lines: lines(1_200) })).purchase;
    expect(changed).toMatchObject({ total: 12_000, paid: 6_000, owed: 6_000, reference: 'INV-9', number: po.number, lineCount: 1 });
    expect(changed.lines[0]!.productId).toBe(b.id);
    expect(updatePurchase(db, 'nope', { supplierId: s.id, lines: lines(1) })).toMatchObject({ ok: false });
  });

  it('receiving puts the stock into inventory at the ordered cost, and only once', () => {
    const s = supplier();
    const a = product();
    const loose = product({ tracking: 'none' });
    const po = ok(createPurchase(db, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 10_000, unitCost: 1_000 }, { productId: loose.id, quantityMilli: 1_000, unitCost: 50 }] })).purchase;
    const received = ok(receivePurchase(db, { purchaseId: po.id, lines: [] }), ).purchase;
    expect(received).toMatchObject({ status: 'received', owed: 10_050 });
    expect(received.receivedAt).not.toBeNull();
    expect(listBatches(db).filter((b) => b.productId === a.id)).toMatchObject([{ onHandMilli: 10_000, unitCost: 1_000 }]);
    expect(onHand(loose.id)).toBe(0); // stock is not tracked for it
    const movement = db.select().from(stockMovements).where(eq(stockMovements.productId, a.id)).get();
    expect(movement).toMatchObject({ type: 'receive', quantityMilli: 10_000, note: `Received on ${po.number}` });
    expect(receivePurchase(db, { purchaseId: po.id, lines: [] })).toMatchObject({ ok: false });
    expect(updatePurchase(db, po.id, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 1_000, unitCost: 1 }] })).toMatchObject({ ok: false });
    expect(cancelPurchase(db, po.id)).toMatchObject({ ok: false });
    // It can still be paid after it arrives.
    expect(ok(payPurchase(db, { purchaseId: po.id, amount: 10_050, method: 'cash', reference: null })).purchase.owed).toBe(0);
  });

  it('receives an order in parts through Receive stock: the order completes when everything has arrived', () => {
    const s = supplier();
    const a = product();
    const b = product();
    const po = ok(createPurchase(db, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 10_000, unitCost: 1_000 }, { productId: b.id, quantityMilli: 4_000, unitCost: 500 }] })).purchase;
    const [la, lb] = po.lines;
    const receive = (productId: string, lineId: string | null, quantityMilli: number) =>
      receiveStock(db, { productId, batchNumber: null, expiresAt: null, quantityMilli, unitCost: 1_000, note: null, purchaseLineId: lineId });

    // Part of one line arrives.
    expect(receive(a.id, la!.id, 6_000)).toMatchObject({ ok: true });
    let now = getPurchase(db, po.id)!;
    expect(now).toMatchObject({ status: 'ordered', partlyReceived: true });
    expect(now.lines.map((l) => l.receivedMilli)).toEqual([6_000, 0]);
    expect(db.select().from(stockMovements).where(eq(stockMovements.productId, a.id)).get()).toMatchObject({ purchaseOrderLineId: la!.id, note: `Received on ${po.number}` });
    // Parts of an order cannot be changed or cancelled any more.
    const same = { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 1_000, unitCost: 1 }] };
    expect(updatePurchase(db, po.id, same)).toMatchObject({ ok: false, error: 'Part of this order has arrived, so it cannot be changed' });
    expect(cancelPurchase(db, po.id)).toMatchObject({ ok: false });

    // Refused: more than is left, the wrong product, an unknown line.
    expect(receive(a.id, la!.id, 4_001)).toMatchObject({ ok: false, field: 'quantity', error: 'Only 4 is left on PO-1001' });
    expect(receive(b.id, la!.id, 1_000)).toMatchObject({ ok: false, field: 'purchaseLine' });
    expect(receive(a.id, 'nope', 1_000)).toMatchObject({ ok: false, field: 'purchaseLine' });
    expect(onHand(a.id)).toBe(6_000);

    // The rest of that line, then the other: the order completes by itself.
    expect(receive(a.id, la!.id, 4_000)).toMatchObject({ ok: true });
    expect(getPurchase(db, po.id)).toMatchObject({ status: 'ordered', partlyReceived: true });
    expect(receive(b.id, lb!.id, 4_000)).toMatchObject({ ok: true });
    now = getPurchase(db, po.id)!;
    expect(now).toMatchObject({ status: 'received', partlyReceived: false });
    expect(now.receivedAt).not.toBeNull();
    expect(receive(a.id, la!.id, 1_000)).toMatchObject({ ok: false, field: 'purchaseLine' }); // received already
    // A receipt that is not against an order is as before.
    expect(receive(a.id, null, 1_000)).toMatchObject({ ok: true });
  });

  it('receiving the order after part of it has arrived takes only what is left', () => {
    const s = supplier();
    const a = product();
    const b = product();
    const po = ok(createPurchase(db, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 10_000, unitCost: 1_000 }, { productId: b.id, quantityMilli: 4_000, unitCost: 500 }] })).purchase;
    expect(receiveStock(db, { productId: a.id, batchNumber: null, expiresAt: null, quantityMilli: 7_000, unitCost: 1_000, note: null, purchaseLineId: po.lines[0]!.id })).toMatchObject({ ok: true });
    const done = ok(receivePurchase(db, { purchaseId: po.id, lines: [] })).purchase;
    expect(done).toMatchObject({ status: 'received', partlyReceived: false });
    expect(done.lines.map((l) => l.receivedMilli)).toEqual([10_000, 4_000]);
    expect(onHand(a.id)).toBe(10_000);
    expect(onHand(b.id)).toBe(4_000);
  });

  it('a delivery session receives what actually arrived per line: short, in parts, and never more than is left', () => {
    const s = supplier();
    const a = product();
    const b = product();
    const po = ok(createPurchase(db, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: a.id, quantityMilli: 10_000, unitCost: 1_000 }, { productId: b.id, quantityMilli: 4_000, unitCost: 500 }] })).purchase;
    const [la, lb] = po.lines;
    expect(po.lines[0]).toMatchObject({ productCode: a.barcode, receivedMilli: 0 });
    // Nothing arrived, or too much: refused, and nothing is written.
    expect(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: la!.id, quantityMilli: 0 }, { lineId: lb!.id, quantityMilli: 0 }] })).toMatchObject({ ok: false, error: 'Enter what has arrived' });
    expect(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: la!.id, quantityMilli: 3_000 }, { lineId: lb!.id, quantityMilli: 4_001 }] })).toMatchObject({ ok: false, lineId: lb!.id, field: 'quantity' });
    expect(onHand(a.id)).toBe(0);
    expect(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: la!.id, quantityMilli: -1 }] })).toMatchObject({ ok: false, field: 'quantity' });

    // The first delivery: 3 of the first product, none of the second.
    const first = ok(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: la!.id, quantityMilli: 3_000 }, { lineId: lb!.id, quantityMilli: 0 }] })).purchase;
    expect(first).toMatchObject({ status: 'ordered', partlyReceived: true });
    expect(first.lines.map((l) => l.receivedMilli)).toEqual([3_000, 0]);
    // The rest: left out means all that is left.
    const done = ok(receivePurchase(db, { purchaseId: po.id, lines: [] })).purchase;
    expect(done).toMatchObject({ status: 'received', partlyReceived: false });
    expect(done.lines.map((l) => l.receivedMilli)).toEqual([10_000, 4_000]);
    expect(onHand(a.id)).toBe(10_000);
  });

  it('a product that tracks lots and expiry needs them, and one refused line receives nothing', () => {
    const s = supplier();
    const plain = product();
    const dated = product({ tracking: 'expiry' });
    const po = ok(createPurchase(db, { supplierId: s.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: plain.id, quantityMilli: 5_000, unitCost: 100 }, { productId: dated.id, quantityMilli: 5_000, unitCost: 100 }] })).purchase;
    const datedLine = po.lines.find((l) => l.productId === dated.id)!;
    const refused = receivePurchase(db, { purchaseId: po.id, lines: [] });
    expect(refused).toMatchObject({ ok: false, lineId: datedLine.id, field: 'batchNumber' });
    expect(onHand(plain.id)).toBe(0); // the first line was rolled back with it
    expect(getPurchase(db, po.id)!.status).toBe('ordered');
    expect(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: datedLine.id, batchNumber: 'L1', expiresAt: null }] })).toMatchObject({ ok: false, lineId: datedLine.id, field: 'expiresAt' });

    const expiresAt = Date.now() + 30 * 86_400_000;
    ok(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: datedLine.id, batchNumber: 'L1', expiresAt }] }));
    expect(listBatches(db).filter((b) => b.productId === dated.id)).toMatchObject([{ batchNumber: 'L1', expiresAt, onHandMilli: 5_000 }]);
    expect(onHand(plain.id)).toBe(5_000);
  });

  it('cancels an order only before it arrives and before anything is paid; a cancelled order owes nothing', () => {
    const s = supplier();
    const paid = order(s.id, product());
    ok(payPurchase(db, { purchaseId: paid.id, amount: 100, method: 'cash', reference: null }));
    expect(cancelPurchase(db, paid.id)).toMatchObject({ ok: false });

    const po = order(s.id, product());
    expect(listSuppliers(db)[0]).toMatchObject({ owed: 19_900, openOrders: 2 });
    expect(ok(cancelPurchase(db, po.id)).purchase).toMatchObject({ status: 'cancelled', owed: 0 });
    expect(listSuppliers(db)[0]).toMatchObject({ owed: 9_900, openOrders: 1 });
    expect(payPurchase(db, { purchaseId: po.id, amount: 1, method: 'cash', reference: null })).toMatchObject({ ok: false, error: 'This order is cancelled' });
    expect(receivePurchase(db, { purchaseId: po.id, lines: [] })).toMatchObject({ ok: false });
    expect(cancelPurchase(db, 'nope')).toMatchObject({ ok: false });
  });
});
