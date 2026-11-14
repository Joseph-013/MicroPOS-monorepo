import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { createCustomer } from './customers';
import { dashboard } from './dashboard';
import { completeOrder, refundOrder } from './orders';
import { createProduct } from './products';
import { salesReport } from './reports';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-dashboard-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date(2026, 5, 15, 15).getTime();
const at = (day: number, h = 10): number => new Date(2026, 5, day, h).getTime();
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const product = (name: string, price: number) => ok(createProduct(db, { name, unit: 'each', tracking: 'none', price, active: true, categoryIds: [] })).product;
const sell = (p: { id: string }, price: number, payment: Record<string, unknown>, when: number, extra: Record<string, unknown> = {}) =>
  ok(completeOrder(db, { lines: [{ productId: p.id, quantityMilli: 1000, unitPrice: price }], discount: 0, payment, ...extra }, when));

describe('dashboard', () => {
  it('is empty on a new till', () => {
    const d = dashboard(db, NOW);
    expect(d.today).toEqual({ count: 0, net: 0 });
    expect(d.daily).toHaveLength(14);
    expect(d.daily.at(-1)!.day).toBe('2026-06-15');
    expect(d.daily[0]!.day).toBe('2026-06-02');
    expect(d.topItems).toEqual([]);
    expect(d.customersOwing).toEqual({ total: 0, count: 0, top: [] });
    expect(d.suppliersOwed).toEqual({ total: 0, orders: 0, overdueOrders: 0, overdue: 0 });
  });

  it('adds up today, yesterday, the week, the chart and the best sellers, agreeing with the Reports page', () => {
    const water = product('Water', 5000);
    const soda = product('Soda', 3000);
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(15, 9));
    sell(soda, 3000, { method: 'card', reference: 'S1' }, at(15, 11));
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(14));
    const old = sell(water, 5000, { method: 'cash', tendered: 5000 }, at(10));
    ok(refundOrder(db, { orderId: old.orderId, reason: 'Wrong' }, at(15, 12))); // refunded today: takes 50.00 off today
    sell(soda, 3000, { method: 'cash', tendered: 3000 }, at(1)); // 14 days ago: in the 30 days, not the chart

    const d = dashboard(db, NOW);
    expect(d.today).toEqual({ count: 2, net: 8000 - 5000 });
    expect(d.yesterday).toEqual({ count: 1, net: 5000 });
    expect(d.last7).toEqual({ count: 4, net: 5000 + 8000 + 5000 - 5000 });
    expect(d.last30.count).toBe(5);
    expect(d.daily.at(-1)).toEqual({ day: '2026-06-15', net: 3000, count: 2 });
    expect(d.daily.at(-2)).toEqual({ day: '2026-06-14', net: 5000, count: 1 });
    expect(d.daily.find((x) => x.day === '2026-06-10')!.net).toBe(5000);
    const rep = salesReport(db, '2026-06-15', '2026-06-15')!;
    expect(d.today.net).toBe(rep.netAfterRefunds);
    expect(d.topItems[0]).toMatchObject({ name: 'Water' });
    expect(d.byMethod.map((m) => m.method)).toEqual(['cash', 'card']);
  });

  it('lists who owes the most, and what is owed to suppliers', () => {
    const rice = product('Rice', 4000);
    const ana = ok(createCustomer(db, { name: 'Ana', phone: null, note: null, creditLimit: null })).customer;
    const bo = ok(createCustomer(db, { name: 'Bo', phone: null, note: null, creditLimit: null })).customer;
    const onCredit = (customerId: string, when: number) =>
      ok(completeOrder(db, { lines: [{ productId: rice.id, quantityMilli: 1000, unitPrice: 4000 }], discount: 0, payment: { method: 'cash', tendered: 500 }, customerId, amountPaid: 0 }, when));
    onCredit(ana.id, at(15, 9));
    onCredit(bo.id, at(15, 10));
    onCredit(bo.id, at(15, 11));
    const d = dashboard(db, NOW);
    expect(d.customersOwing.total).toBe(12_000);
    expect(d.customersOwing.count).toBe(2);
    expect(d.customersOwing.top.map((c) => [c.name, c.balance])).toEqual([['Bo', 8000], ['Ana', 4000]]);
  });
});
