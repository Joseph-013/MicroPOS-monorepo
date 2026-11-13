import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { receiveStock, stockConcerns } from './inventory';
import { createProduct, setProductsActive } from './products';
import { createPurchase, createSupplier, payPurchase, purchaseConcerns, receivePurchase } from './purchases';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12);
let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-concerns-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const product = (name: string, over: Record<string, unknown> = {}) =>
  ok(createProduct(db, { name, unit: 'each', tracking: 'expiry', shelfLifeDays: null, criticalLevelMilli: null, sku: null, barcode: null, price: 100, cost: 60, active: true, categoryIds: [], ...over })).product;
const stock = (productId: string, quantityMilli: number, expiresAt: number | null, batchNumber = 'L1') =>
  ok(receiveStock(db, { productId, batchNumber, expiresAt, quantityMilli, unitCost: 50, note: null }));
const summary = () => stockConcerns(db, NOW).map((c) => [c.kind, c.productName]);

describe('product critical level', () => {
  it('is kept for products that track stock, refused when not a quantity, and dropped when stock is not tracked', () => {
    expect(product('Milk', { criticalLevelMilli: 5_000 }).criticalLevelMilli).toBe(5_000);
    expect(createProduct(db, { name: 'X', unit: 'each', tracking: 'quantity', criticalLevelMilli: 0, price: 1, active: true, categoryIds: [] })).toMatchObject({ ok: false, field: 'criticalLevel' });
    expect(createProduct(db, { name: 'Y', unit: 'each', tracking: 'quantity', criticalLevelMilli: 1.5, price: 1, active: true, categoryIds: [] })).toMatchObject({ ok: false, field: 'criticalLevel' });
    expect(product('Plain', { tracking: 'none', criticalLevelMilli: 5_000 }).criticalLevelMilli).toBeNull();
    expect(product('Open').criticalLevelMilli).toBeNull();
  });
});

describe('stock concerns', () => {
  it('lists expired and expiring batches, products out of stock and products at their critical level, worst first', () => {
    const expired = product('Bread');
    const soon = product('Yogurt');
    const fine = product('Rice');
    const low = product('Eggs', { criticalLevelMilli: 6_000 });
    const roomy = product('Salt', { criticalLevelMilli: 2_000 });
    product('Empty'); // never received: out of stock
    stock(expired.id, 4_000, NOW - DAY);
    stock(soon.id, 3_000, NOW + 2 * DAY);
    stock(fine.id, 9_000, NOW + 30 * DAY);
    stock(low.id, 6_000, NOW + 30 * DAY); // exactly at the level counts
    stock(roomy.id, 9_000, NOW + 30 * DAY);
    expect(summary()).toEqual([
      ['expired', 'Bread'],
      ['out', 'Empty'],
      ['low', 'Eggs'],
      ['expiring', 'Yogurt'],
    ]);
    const bread = stockConcerns(db, NOW).find((c) => c.productName === 'Bread')!;
    expect(bread).toMatchObject({ batchNumber: 'L1', onHandMilli: 4_000, expiresAt: NOW - DAY });
    expect(stockConcerns(db, NOW).find((c) => c.kind === 'low')).toMatchObject({ onHandMilli: 6_000, criticalLevelMilli: 6_000 });
  });

  it('ignores inactive and untracked products', () => {
    const off = product('Retired');
    product('Untracked', { tracking: 'none' });
    expect(summary()).toEqual([['out', 'Retired']]);
    setProductsActive(db, [off.id], false);
    expect(summary()).toEqual([]);
  });
});

describe('purchase concerns', () => {
  const supplier = () => ok(createSupplier(db, { name: 'Metro', phone: null, note: null })).supplier;
  const order = (over: Record<string, unknown>) => {
    const p = product(`P-${Math.random()}`, { tracking: 'quantity' });
    return ok(createPurchase(db, { supplierId: supplier().id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: p.id, quantityMilli: 10_000, unitCost: 1_000 }], ...over })).purchase;
  };
  const who = (): string[] => purchaseConcerns(db, NOW).map((c) => c.purchase.number);

  it('flags orders still to arrive past their expected date, and payment overdue', () => {
    const late = order({ expectedAt: NOW - 3 * DAY });
    const overdue = order({ dueAt: NOW - 10 * DAY });
    const both = order({ expectedAt: NOW - DAY, dueAt: NOW - DAY });
    order({ expectedAt: NOW + 3 * DAY, dueAt: NOW + 5 * DAY }); // on track
    order({}); // no dates
    const concerns = purchaseConcerns(db, NOW);
    expect(concerns.map((c) => c.purchase.number)).toEqual([overdue.number, late.number, both.number]); // longest overdue first
    expect(concerns.find((c) => c.purchase.id === late.id)).toMatchObject({ lateSince: NOW - 3 * DAY, overdueOwed: null });
    expect(concerns.find((c) => c.purchase.id === overdue.id)).toMatchObject({ lateSince: null, overdueOwed: 10_000 });
    expect(concerns.find((c) => c.purchase.id === both.id)).toMatchObject({ lateSince: NOW - DAY, overdueOwed: 10_000 });
  });

  it('stops once the order has arrived and been paid', () => {
    const po = order({ expectedAt: NOW - DAY, dueAt: NOW - DAY });
    expect(who()).toEqual([po.number]);
    ok(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: po.lines[0]!.id, quantityMilli: 10_000, batchNumber: null, expiresAt: null }] }));
    expect(purchaseConcerns(db, NOW)[0]).toMatchObject({ lateSince: null, overdueOwed: 10_000 });
    ok(payPurchase(db, { purchaseId: po.id, amount: 10_000, method: 'cash', reference: null }));
    expect(who()).toEqual([]);
  });
});
