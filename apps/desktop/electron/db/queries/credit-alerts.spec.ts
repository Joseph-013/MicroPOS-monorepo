import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CREDIT_ALERTS } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { countCreditAlerts, creditAlerts, getCreditAlertSettings, saveCreditAlertSettings } from './credit-alerts';
import { createCustomer, deleteCustomers, listCustomers, receivePayment } from './customers';
import { completeOrder } from './orders';
import { createProduct } from './products';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 10, 9);
let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-alerts-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const customer = (name: string): string => {
  const r = createCustomer(db, { name, phone: null, note: null, creditLimit: null });
  if (!r.ok) throw new Error(r.error);
  return r.customer.id;
};
/** A credit sale of `price` cents, all of it on account. */
const owe = (customerId: string, price: number, at: number): void => {
  const p = createProduct(db, { name: `Item ${Math.random()}`, unit: 'each', tracking: 'none', shelfLifeDays: null, sku: null, barcode: null, price, cost: null, active: true, categoryIds: [] });
  if (!p.ok) throw new Error(p.error);
  const r = completeOrder(db, { lines: [{ productId: p.product.id, quantityMilli: 1_000, unitPrice: price }], discount: 0, customerId, amountPaid: 0, payment: { method: 'cash' } }, at);
  if (!r.ok) throw new Error('refused');
};

describe('credit alert limits', () => {
  it('start from the factory values, keep what was saved, and either can be off', () => {
    expect(getCreditAlertSettings(db)).toEqual(DEFAULT_CREDIT_ALERTS);
    expect(saveCreditAlertSettings(db, { amount: 100_000, days: null })).toBe(true);
    expect(getCreditAlertSettings(db)).toEqual({ amount: 100_000, days: null });
    for (const bad of [{ amount: 0, days: 5 }, { amount: 1.5, days: 5 }, { amount: 5, days: 0 }, { amount: 5, days: 4000 }, { amount: '5', days: 1 }]) expect(saveCreditAlertSettings(db, bad), JSON.stringify(bad)).toBe(false);
    expect(getCreditAlertSettings(db)).toEqual({ amount: 100_000, days: null });
  });
});

describe('customers needing attention', () => {
  it('counts customers over the amount, and those with a sale unpaid too long, once each', () => {
    saveCreditAlertSettings(db, { amount: 200_000, days: 30 });
    const big = customer('Big');
    const old = customer('Old');
    const fine = customer('Fine');
    const both = customer('Both');
    owe(big, 250_000, T0 + 40 * DAY); // over the amount, only 5 days old
    owe(old, 50_000, T0); // small but 45 days old
    owe(fine, 50_000, T0 + 40 * DAY);
    owe(both, 250_000, T0);
    expect(countCreditAlerts(db, T0 + 45 * DAY)).toBe(3);
    const reasons = creditAlerts(db, T0 + 45 * DAY);
    expect(reasons.get(big)).toEqual({ overAmount: 200_000, unpaidDays: null });
    expect(reasons.get(old)).toEqual({ overAmount: null, unpaidDays: 45 });
    expect(reasons.get(both)).toEqual({ overAmount: 200_000, unpaidDays: 45 });
    expect(reasons.has(fine)).toBe(false);
  });

  it('puts the reason on the customer record, and none on one who needs nothing', () => {
    saveCreditAlertSettings(db, { amount: 200_000, days: 30 });
    const late = customer('Late');
    const fine = customer('Fine');
    owe(late, 900_000, Date.now() - 40 * DAY);
    owe(fine, 10_000, Date.now() - DAY);
    const byName = Object.fromEntries(listCustomers(db).map((c) => [c.name, c.alert]));
    expect(byName).toEqual({ Late: { overAmount: 200_000, unpaidDays: 40 }, Fine: null });
  });

  it('stops flagging a customer once the old sale is paid, even if a newer one is owed', () => {
    saveCreditAlertSettings(db, { amount: null, days: 30 });
    const c = customer('Nena');
    owe(c, 50_000, T0);
    owe(c, 50_000, T0 + 40 * DAY);
    expect(countCreditAlerts(db, T0 + 45 * DAY)).toBe(1);
    receivePayment(db, { customerId: c, amount: 50_000, method: 'cash', reference: null }, T0 + 46 * DAY);
    expect(countCreditAlerts(db, T0 + 47 * DAY)).toBe(0);
  });

  it('counts nothing with both limits off, and ignores deleted customers and anyone who owes nothing', () => {
    const c = customer('Nena');
    owe(c, 900_000, T0);
    saveCreditAlertSettings(db, { amount: null, days: null });
    expect(countCreditAlerts(db, T0 + 90 * DAY)).toBe(0);
    saveCreditAlertSettings(db, { amount: 100_000, days: 30 });
    expect(countCreditAlerts(db, T0 + 90 * DAY)).toBe(1);
    receivePayment(db, { customerId: c, amount: 900_000, method: 'cash', reference: null }, T0 + 91 * DAY);
    expect(deleteCustomers(db, [c])).toMatchObject({ removed: 1 });
    expect(countCreditAlerts(db, T0 + 92 * DAY)).toBe(0);
  });
});
