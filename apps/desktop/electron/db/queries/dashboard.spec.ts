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
  const ask = (from: string, to: string, compare = false) => dashboard(db, { from, to, compare }, NOW)!;

  it('is empty on a new till', () => {
    const d = ask('2026-06-15', '2026-06-15', true);
    expect(d.current).toEqual({ count: 0, net: 0, discounts: 0, refunded: 0, voided: 0 });
    expect(d.previous).toMatchObject({ from: '2026-06-14', to: '2026-06-14', count: 0, net: 0 });
    expect(d.granularity).toBe('day');
    expect(d.chart).toEqual([{ from: '2026-06-15', to: '2026-06-15', net: 0, count: 0 }]);
    expect(d.topItems).toEqual([]);
    expect(d.customersOwing).toEqual({ total: 0, count: 0, top: [] });
    expect(d.suppliersOwed).toEqual({ total: 0, orders: 0, overdueOrders: 0, overdue: 0 });
  });

  it('refuses days that are not real dates in order, or more than the limit', () => {
    for (const q of [{ from: 'x', to: '2026-06-15' }, { from: '2026-06-16', to: '2026-06-15' }, { from: '2020-01-01', to: '2026-06-15' }, null, { from: 5, to: 6 }]) expect(dashboard(db, q, NOW)).toBeNull();
  });

  it('adds up a period, compares it with the one before, and charts it, agreeing with the Reports page', () => {
    const water = product('Water', 5000);
    const soda = product('Soda', 3000);
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(15, 9));
    sell(soda, 3000, { method: 'card', reference: 'S1' }, at(15, 11));
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(14));
    const old = sell(water, 5000, { method: 'cash', tendered: 5000 }, at(10));
    ok(refundOrder(db, { orderId: old.orderId, reason: 'Wrong' }, at(15, 12))); // refunded today: takes 50.00 off today
    sell(soda, 3000, { method: 'cash', tendered: 3000 }, at(1)); // 14 days ago

    const today = ask('2026-06-15', '2026-06-15', true);
    expect(today.current).toMatchObject({ count: 2, net: 8000 - 5000, refunded: 5000 });
    expect(today.previous).toMatchObject({ from: '2026-06-14', to: '2026-06-14', count: 1, net: 5000 });
    const week = ask('2026-06-09', '2026-06-15', true);
    expect(week.current).toMatchObject({ count: 4, net: 5000 + 8000 + 5000 - 5000 });
    expect(week.previous).toMatchObject({ from: '2026-06-02', to: '2026-06-08', count: 0, net: 0 }); // the soda was on the 1st
    expect(week.chart).toHaveLength(7);
    expect(week.chart.at(-1)).toEqual({ from: '2026-06-15', to: '2026-06-15', net: 3000, count: 2 });
    expect(week.chart.find((b) => b.from === '2026-06-10')!.net).toBe(5000);
    const rep = salesReport(db, '2026-06-15', '2026-06-15')!;
    expect(today.current.net).toBe(rep.netAfterRefunds);
    expect(today.topItems.map((i) => i.name)).toEqual(['Soda']); // today's water sale and the refund of an older one net out to nothing
    expect(week.topItems[0]).toMatchObject({ name: 'Water' });
    expect(today.byMethod.map((m) => m.method)).toEqual(['card']); // today's cash sale and the cash refund net out
    expect(week.byMethod.map((m) => m.method)).toEqual(['cash', 'card']);
    expect(ask('2026-06-15', '2026-06-15', false).previous).toBeNull(); // not asked for
  });

  it('charts a longer period by week (Monday to Sunday, the ends clipped) and a long one by month', () => {
    const water = product('Water', 5000);
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(3)); // a Wednesday
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(15)); // a Monday
    const weeks = ask('2026-06-01', '2026-06-30');
    expect(weeks.granularity).toBe('day'); // 30 days: still by day
    const sixty = ask('2026-05-01', '2026-06-30');
    expect(sixty.granularity).toBe('week');
    expect(sixty.chart[0]).toMatchObject({ from: '2026-05-01', to: '2026-05-03' }); // a Friday to the Sunday
    expect(sixty.chart.filter((b) => b.net > 0).map((b) => [b.from, b.net])).toEqual([['2026-06-01', 5000], ['2026-06-15', 5000]]);
    expect(sixty.chart.at(-1)!.to).toBe('2026-06-30');
    const year = ask('2025-07-01', '2026-06-30');
    expect(year.granularity).toBe('month');
    expect(year.chart).toHaveLength(12);
    expect(year.chart.find((b) => b.from === '2026-06-01')).toMatchObject({ to: '2026-06-30', net: 10_000, count: 2 });
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
    const d = ask('2026-06-15', '2026-06-15');
    expect(d.customersOwing.total).toBe(12_000);
    expect(d.customersOwing.count).toBe(2);
    expect(d.customersOwing.top.map((c) => [c.name, c.balance])).toEqual([['Bo', 8000], ['Ana', 4000]]);
  });
});
