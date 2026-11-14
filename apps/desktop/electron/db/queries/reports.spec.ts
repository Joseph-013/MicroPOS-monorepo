import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { completeOrder, refundOrder, voidOrder } from './orders';
import { createProduct } from './products';
import { salesReport } from './reports';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-reports-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (h: number, day = 15): number => new Date(2026, 5, day, h).getTime();
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const product = (name: string, price: number) => ok(createProduct(db, { name, unit: 'each', tracking: 'none', price, active: true, categoryIds: [] })).product;
const sell = (p: { id: string }, price: number, payment: Record<string, unknown>, when: number) =>
  ok(completeOrder(db, { lines: [{ productId: p.id, quantityMilli: 1000, unitPrice: price }], discount: 0, payment }, when));

describe('salesReport', () => {
  it('adds up sales, refunds, voids, methods and items over a day, and over a range', () => {
    const water = product('Water', 5000);
    const soda = product('Soda', 3000);
    const chips = product('Chips', 2000);
    const rice = product('Rice', 4000);
    sell(water, 5000, { method: 'cash', tendered: 10_000 }, at(9)); // cash 50.00, the change went back
    sell(soda, 3000, { method: 'card', reference: 'S1' }, at(10));
    const voided = sell(chips, 2000, { method: 'cash', tendered: 2000 }, at(11));
    ok(voidOrder(db, { orderId: voided.orderId, reason: 'Mistake' }, at(12)));
    const refunded = sell(rice, 4000, { method: 'cash', tendered: 4000 }, at(13));
    ok(refundOrder(db, { orderId: refunded.orderId, reason: 'Wrong item' }, at(14)));
    sell(water, 5000, { method: 'card', reference: 'S2' }, at(9, 16)); // the next day

    const day = salesReport(db, '2026-06-15', '2026-06-15')!;
    expect(day.sales.count).toBe(3); // water, soda, rice (the voided sale is out)
    expect(day.sales.net).toBe(12_000);
    expect(day.refunds).toEqual({ count: 1, total: -4000 });
    expect(day.voids.count).toBe(1);
    expect(day.netAfterRefunds).toBe(8000);
    expect(day.byMethod).toEqual([{ method: 'cash', amount: 5000 }, { method: 'card', amount: 3000 }]);
    expect(day.items.map((i) => i.name)).toEqual(['Water', 'Soda']); // rice netted out to nothing

    const range = salesReport(db, '2026-06-15', '2026-06-16')!;
    expect(range.sales.count).toBe(4);
    expect(range.netAfterRefunds).toBe(13_000);
  });

  it('is null for anything that is not a date range in order', () => {
    expect(salesReport(db, 'nope', '2026-06-15')).toBeNull();
    expect(salesReport(db, '2026-06-16', '2026-06-15')).toBeNull();
    expect(salesReport(db, 5, 6)).toBeNull();
  });
});
