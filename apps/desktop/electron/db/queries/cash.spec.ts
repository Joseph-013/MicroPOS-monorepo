import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDailyReceipt, cashFlowNet, dayRange, expectedCash, layoutReceipt } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { addCashMovement, cashFlow, closeDrawer, drawerState, openDrawer } from './cash';
import { createCustomer, receivePayment } from './customers';
import { completeOrder, refundOrder, voidOrder } from './orders';
import { createProduct } from './products';
import { createPurchase, createSupplier, payPurchase } from './purchases';
import { dailyReport } from './reports';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-cash-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const DAY = '2026-06-15';
const at = (h: number, m = 0, day = 15): number => new Date(2026, 5, day, h, m).getTime();
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const product = (name: string, price: number) => ok(createProduct(db, { name, unit: 'each', tracking: 'none', price, active: true, categoryIds: [] })).product;
const sell = (p: { id: string }, price: number, payment: Record<string, unknown>, when: number, extra: Record<string, unknown> = {}) =>
  ok(completeOrder(db, { lines: [{ productId: p.id, quantityMilli: 1000, unitPrice: price }], discount: 0, payment, ...extra }, when));

/** The day used throughout: a drawer opened with 100.00, then sales of every kind, and a close that is 1.00 short. */
function theDay() {
  const water = product('Water', 5000);
  const soda = product('Soda', 3000);
  const chips = product('Chips', 2000);
  const rice = product('Rice', 4000);
  const feast = product('Feast', 6000);
  expect(openDrawer(db, { openingFloat: 10_000 }, at(8)).ok).toBe(true);
  sell(water, 5000, { method: 'cash', tendered: 10_000 }, at(9)); // +50.00 cash (the change goes back out)
  sell(soda, 3000, { method: 'card', reference: 'S1' }, at(9, 30)); // card
  const voided = sell(chips, 2000, { method: 'cash', tendered: 2000 }, at(10));
  ok(voidOrder(db, { orderId: voided.orderId, reason: 'Mistake' }, at(10, 30))); // its cash goes back
  const refunded = sell(rice, 4000, { method: 'cash', tendered: 4000 }, at(11));
  ok(refundOrder(db, { orderId: refunded.orderId, reason: 'Wrong item' }, at(11, 30))); // cash back out
  const nena = ok(createCustomer(db, { name: 'Nena', phone: null, note: null, creditLimit: null })).customer;
  sell(feast, 6000, { method: 'cash', tendered: 1000 }, at(12), { customerId: nena.id, amountPaid: 1000 }); // 10.00 cash now, 50.00 on account
  ok(receivePayment(db, { customerId: nena.id, amount: 2000, method: 'cash', reference: null }, at(13))); // +20.00 cash
  const supplier = ok(createSupplier(db, { name: 'Metro', phone: null, note: null })).supplier;
  const po = ok(createPurchase(db, { supplierId: supplier.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: water.id, quantityMilli: 10_000, unitCost: 1_000 }] })).purchase;
  ok(payPurchase(db, { purchaseId: po.id, amount: 1500, method: 'cash', reference: null }, at(14))); // -15.00 cash out
  ok(addCashMovement(db, { type: 'in', amount: 1000, reason: 'Float top-up' }, at(15)));
  ok(addCashMovement(db, { type: 'out', amount: 500, reason: 'Safe drop' }, at(15, 30)));
}

describe('the cash drawer', () => {
  it('opens with a counted float, once, and shows no expected amount while open', () => {
    expect(openDrawer(db, { openingFloat: -1 }, at(8))).toMatchObject({ ok: false, field: 'openingFloat' });
    expect(openDrawer(db, { openingFloat: 1.5 }, at(8))).toMatchObject({ ok: false, field: 'openingFloat' });
    expect(openDrawer(db, {}, at(8))).toMatchObject({ ok: false, field: 'openingFloat' });
    const state = ok(openDrawer(db, { openingFloat: 10_000 }, at(8))).value;
    expect(state.session).toMatchObject({ openedAt: at(8), openingFloat: 10_000 });
    expect(Object.keys(state.session!)).not.toContain('expectedCash'); // the count is made blind
    expect(openDrawer(db, { openingFloat: 5000 }, at(9))).toMatchObject({ ok: false, error: 'The drawer is already open' });
    expect(drawerState(db).session?.id).toBe(state.session!.id);
  });

  it('records cash put in and taken out, with a reason, and only while open', () => {
    expect(addCashMovement(db, { type: 'in', amount: 500, reason: 'x' }, at(8))).toMatchObject({ ok: false, error: 'Open the drawer first' });
    ok(openDrawer(db, { openingFloat: 0 }, at(8)));
    expect(addCashMovement(db, { type: 'sideways', amount: 500, reason: 'x' }, at(9))).toMatchObject({ ok: false });
    expect(addCashMovement(db, { type: 'in', amount: 0, reason: 'x' }, at(9))).toMatchObject({ ok: false, field: 'amount' });
    expect(addCashMovement(db, { type: 'in', amount: 500, reason: '  ' }, at(9))).toMatchObject({ ok: false, field: 'reason' });
    expect(addCashMovement(db, { type: 'in', amount: 500, reason: 'x'.repeat(101) }, at(9))).toMatchObject({ ok: false, field: 'reason' });
    const state = ok(addCashMovement(db, { type: 'out', amount: 700, reason: ' Paid  the   milkman ' }, at(9))).value;
    expect(state.movements).toMatchObject([{ type: 'out', amount: 700, reason: 'Paid the milkman', at: at(9) }]);
  });

  it('adds up what the drawer should hold from every kind of cash, and compares it with the count', () => {
    theDay();
    expect(cashFlow(db, at(0), at(23, 59))).toEqual({ sales: 6000, customerPayments: 2000, supplierPayments: 1500, movementsIn: 1000, movementsOut: 500 });
    const closed = ok(closeDrawer(db, { countedCash: 16_900, note: 'A coin went missing' }, at(18))).value;
    expect(closed).toMatchObject({ openingFloat: 10_000, expectedCash: 17_000, countedCash: 16_900, variance: -100, closedAt: at(18), note: 'A coin went missing' });
    expect(drawerState(db)).toMatchObject({ session: null, movements: [], lastClosed: { id: closed.id, variance: -100 } });
    expect(closeDrawer(db, { countedCash: 0 }, at(19))).toMatchObject({ ok: false, error: 'The drawer is not open' });
  });

  it('can be over as well as short, and refuses a count that is not money', () => {
    ok(openDrawer(db, { openingFloat: 5000 }, at(8)));
    expect(closeDrawer(db, { countedCash: -5 }, at(9))).toMatchObject({ ok: false, field: 'countedCash' });
    expect(closeDrawer(db, { countedCash: 12.5 }, at(9))).toMatchObject({ ok: false, field: 'countedCash' });
    expect(closeDrawer(db, { countedCash: 5000, note: 'x'.repeat(201) }, at(9))).toMatchObject({ ok: false, field: 'note' });
    expect(ok(closeDrawer(db, { countedCash: 5300 }, at(9))).value).toMatchObject({ expectedCash: 5000, variance: 300 });
  });

  it('only counts what happened inside the session, and starts a new one after closing', () => {
    const water = product('Water', 5000);
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(7)); // before the drawer was opened
    ok(openDrawer(db, { openingFloat: 1000 }, at(8)));
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(9));
    expect(ok(closeDrawer(db, { countedCash: 6000 }, at(10))).value).toMatchObject({ expectedCash: 6000, variance: 0 });
    sell(water, 5000, { method: 'cash', tendered: 5000 }, at(11)); // between sessions
    ok(openDrawer(db, { openingFloat: 6000 }, at(12)));
    expect(ok(closeDrawer(db, { countedCash: 6000 }, at(13))).value).toMatchObject({ expectedCash: 6000, variance: 0 });
  });

  it('writes the opening and closing to the audit log', () => {
    ok(openDrawer(db, { openingFloat: 1000 }, at(8)));
    ok(closeDrawer(db, { countedCash: 900 }, at(9)));
    const actions = (db.$client.prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'cash.%' ORDER BY at").all() as { action: string; detail: string }[]).map((r) => [r.action, JSON.parse(r.detail)]);
    expect(actions).toEqual([['cash.open', { openingFloat: 1000 }], ['cash.close', { counted: 900, expected: 1000, variance: -100 }]]);
  });

  it('has the same arithmetic in core as in the records', () => {
    const flow = { sales: 100, customerPayments: 20, supplierPayments: 30, movementsIn: 5, movementsOut: 15 };
    expect(cashFlowNet(flow)).toBe(80);
    expect(expectedCash(1000, flow)).toBe(1080);
  });
});

describe('the daily sales report', () => {
  it('adds up the day: sales, refunds and voids, what was taken by each method, credit, items and the drawer', () => {
    theDay();
    ok(closeDrawer(db, { countedCash: 16_900 }, at(18)));
    const report = dailyReport(db, DAY)!;
    expect(report.day).toBe(DAY);
    expect(report.sales).toEqual({ count: 4, gross: 18_000, discounts: 0, net: 18_000 }); // the voided sale is not a sale
    expect(report.refunds).toEqual({ count: 1, total: -4000 });
    expect(report.voids).toEqual({ count: 1, total: 2000 });
    expect(report.netAfterRefunds).toBe(14_000);
    expect(report.byMethod).toEqual([{ method: 'cash', amount: 6000 }, { method: 'card', amount: 3000 }]); // refunds and voids come off
    expect(report.credit).toEqual({ given: 5000, interest: 0, paymentsReceived: [{ method: 'cash', amount: 2000 }] });
    expect(report.cash).toEqual({ sales: 6000, customerPayments: 2000, supplierPayments: 1500, movementsIn: 1000, movementsOut: 500 });
    expect(report.items.map((i) => [i.name, i.quantityMilli, i.total])).toEqual([['Feast', 1000, 6000], ['Water', 1000, 5000], ['Soda', 1000, 3000]]); // the refunded Rice nets to nothing and the voided Chips are not sold
    expect(report.sessions).toMatchObject([{ openingFloat: 10_000, expectedCash: 17_000, countedCash: 16_900, variance: -100 }]);
  });

  it('is empty for a day with nothing, only knows real dates, and keeps days apart', () => {
    theDay();
    const empty = dailyReport(db, '2026-06-14')!;
    expect(empty).toMatchObject({ sales: { count: 0, gross: 0 }, byMethod: [], items: [], sessions: [] });
    expect(dailyReport(db, '2026-06-16')!.sales.count).toBe(0);
    for (const bad of ['2026-02-30', '15-06-2026', '', 'today', 42, null, undefined]) expect(dailyReport(db, bad), String(bad)).toBeNull();
    expect(dayRange('2026-06-15')).toEqual({ from: at(0), to: at(0, 0, 16) });
  });

  it('lists a drawer that is still open, and one that spans midnight on both days', () => {
    ok(openDrawer(db, { openingFloat: 1000 }, at(22, 0, 15)));
    expect(dailyReport(db, '2026-06-15')!.sessions).toMatchObject([{ closedAt: null }]);
    ok(closeDrawer(db, { countedCash: 1000 }, at(2, 0, 16)));
    expect(dailyReport(db, '2026-06-15')!.sessions).toHaveLength(1);
    expect(dailyReport(db, '2026-06-16')!.sessions).toHaveLength(1);
    expect(dailyReport(db, '2026-06-17')!.sessions).toHaveLength(0);
  });

  it('prints as a receipt that fits the paper, with every section and the drawer result', () => {
    theDay();
    ok(closeDrawer(db, { countedCash: 16_900 }, at(18)));
    const doc = buildDailyReceipt(dailyReport(db, DAY)!, { name: 'Aling Nena Store', address: '', footer: '', hasLogo: false }, 32);
    const rows = layoutReceipt(doc).flatMap((r) => (r.kind === 'text' ? [r.text.trimEnd()] : []));
    for (const r of layoutReceipt(doc)) if (r.kind === 'text') expect(r.text.length).toBe(32);
    for (const part of ['DAILY SALES REPORT', DAY, 'Net sales', 'NET', 'Cash', 'Card', 'Put on account', 'Opening float', 'Expected', 'Counted', 'SHORT', 'Items sold', 'Feast']) expect(rows.some((r) => r.includes(part)), part).toBe(true);
    expect(rows.find((r) => r.startsWith('NET'))).toMatch(/PHP 140\.00$/);
    expect(rows.find((r) => r.startsWith('SHORT'))).toMatch(/1\.00$/);
  });

  it('caps a long list of items, summing the rest on one line', () => {
    const doc = buildDailyReceipt({ ...dailyReport(db, DAY)!, items: Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}`, unit: 'each', quantityMilli: 1000, total: 100 })) }, { name: '', address: '', footer: '', hasLogo: false }, 32, 5);
    const rows = layoutReceipt(doc).flatMap((r) => (r.kind === 'text' ? [r.text.trimEnd()] : []));
    expect(rows.filter((r) => r.startsWith('Item '))).toHaveLength(5);
    expect(rows.some((r) => r.startsWith('15 more items'))).toBe(true);
  });
});
