import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMonths, DEFAULT_INTEREST_DEFAULTS, formatRate, parseRate } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { accrueInterest, getInterestDefaults, saveInterestDefaults } from './credit-interest';
import { createCustomer, getCustomerAccount, receivePayment, updateCustomer } from './customers';
import { completeOrder, voidOrder } from './orders';
import { createProduct } from './products';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 10, 9); // Jan 10
let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-interest-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const productId = (): string => {
  const r = createProduct(db, { name: `Item ${Math.random()}`, unit: 'each', tracking: 'none', shelfLifeDays: null, sku: null, barcode: null, price: 100_000, cost: null, active: true, categoryIds: [] });
  if (!r.ok) throw new Error(r.error);
  return r.product.id;
};
const customer = (over: Record<string, unknown> = {}, now = T0) => {
  const r = createCustomer(db, { name: 'Aling Nena', phone: null, note: null, creditLimit: null, interestMode: null, interestRateBp: null, ...over }, now);
  if (!r.ok) throw new Error(r.error);
  return r.customer;
};
/** A 1,000.00 sale of which only `paid` is paid now. */
const sell = (customerId: string, paid: number, at: number, price = 100_000) => {
  const r = completeOrder(db, { lines: [{ productId: productId(), quantityMilli: 1_000, unitPrice: price }], discount: 0, customerId, amountPaid: paid, payment: { method: 'cash', tendered: paid } }, at);
  if (!r.ok) throw new Error('sale refused');
  return r;
};
const interest = (id: string) => getCustomerAccount(db, id)!.entries.filter((e) => e.type === 'interest').reverse();
const balance = (id: string) => getCustomerAccount(db, id)!.customer.balance;

describe('rates', () => {
  it('reads and writes percent text', () => {
    expect(parseRate('3')).toBe(300);
    expect(parseRate(' 2.5% ')).toBe(250);
    expect(parseRate('0.01')).toBe(1);
    for (const bad of ['', '0', '100.01', '-1', '1.234', 'abc']) expect(parseRate(bad), bad).toBeNull();
    expect(formatRate(250)).toBe('2.5');
  });
  it('adds months to the end of a shorter month', () => {
    expect(addMonths(Date.UTC(2026, 0, 31), 1)).toBe(Date.UTC(2026, 1, 28));
  });
});

describe('interest defaults', () => {
  it('start from the factory values and keep what was saved', () => {
    expect(getInterestDefaults(db)).toEqual(DEFAULT_INTEREST_DEFAULTS);
    expect(saveInterestDefaults(db, { orderRateBp: 500, totalRateBp: 150 })).toBe(true);
    expect(getInterestDefaults(db)).toEqual({ orderRateBp: 500, totalRateBp: 150 });
    expect(saveInterestDefaults(db, { orderRateBp: 0, totalRateBp: 150 })).toBe(false);
    expect(saveInterestDefaults(db, { orderRateBp: 500 })).toBe(false);
    expect(getInterestDefaults(db)).toEqual({ orderRateBp: 500, totalRateBp: 150 });
  });
});

describe('a customer with interest', () => {
  it('needs a valid kind and rate, and trustworthy customers have none', () => {
    expect(createCustomer(db, { name: 'A', interestMode: 'weekly', interestRateBp: 300 })).toMatchObject({ ok: false, field: 'interest' });
    expect(createCustomer(db, { name: 'A', interestMode: 'order', interestRateBp: null })).toMatchObject({ ok: false, field: 'interest' });
    expect(createCustomer(db, { name: 'A', interestMode: 'order', interestRateBp: 20_000 })).toMatchObject({ ok: false, field: 'interest' });
    const plain = customer();
    expect(plain).toMatchObject({ interestMode: null, interestRateBp: null, interestStartedAt: null });
    sell(plain.id, 0, T0);
    expect(accrueInterest(db, T0 + 400 * DAY)).toBe(0);
  });

  it('starts counting when interest is switched on, and a new rate keeps the start', () => {
    const c = customer();
    const on = updateCustomer(db, c.id, { ...c, interestMode: 'total', interestRateBp: 300 }, T0 + DAY);
    expect(on).toMatchObject({ ok: true, customer: { interestStartedAt: T0 + DAY } });
    const rate = updateCustomer(db, c.id, { ...c, interestMode: 'total', interestRateBp: 400 }, T0 + 9 * DAY);
    expect(rate).toMatchObject({ customer: { interestStartedAt: T0 + DAY, interestRateBp: 400 } });
    expect(updateCustomer(db, c.id, { ...c, interestMode: 'order', interestRateBp: 400 }, T0 + 20 * DAY)).toMatchObject({ customer: { interestStartedAt: T0 + 20 * DAY } });
    expect(updateCustomer(db, c.id, { ...c }, T0 + 30 * DAY)).toMatchObject({ customer: { interestMode: null, interestStartedAt: null } });
  });
});

describe('interest per sales order', () => {
  it('is charged on each sale after 15 days and then monthly, on that sale only', () => {
    const c = customer({ interestMode: 'order', interestRateBp: 300 });
    const a = sell(c.id, 0, T0 + DAY); // owes 1,000.00
    sell(c.id, 60_000, T0 + 2 * DAY); // owes 400.00 of its own
    expect(accrueInterest(db, T0 + 10 * DAY)).toBe(0); // nobody is 15 days old yet
    expect(accrueInterest(db, T0 + 16 * DAY)).toBe(1); // the first sale's 15 days (Jan 26)
    expect(accrueInterest(db, T0 + 16 * DAY)).toBe(0); // never twice
    expect(interest(c.id).map((e) => e.amount)).toEqual([3_000]);
    expect(interest(c.id)[0]).toMatchObject({ orderNumber: a.orderNumber, at: T0 + DAY + 15 * DAY });
    expect(accrueInterest(db, T0 + 17 * DAY)).toBe(1); // the second sale: 3% of 400.00
    expect(interest(c.id).map((e) => e.amount)).toEqual([3_000, 1_200]);
    // Then monthly: Feb 26 for the first sale, whatever the total has grown to.
    expect(accrueInterest(db, Date.UTC(2026, 1, 27))).toBe(1);
    expect(interest(c.id).map((e) => e.amount)).toEqual([3_000, 1_200, 3_000]); // not compounded
  });

  it('catches up months missed while the app was closed, dated when each fell due', () => {
    const c = customer({ interestMode: 'order', interestRateBp: 100 });
    sell(c.id, 0, T0);
    expect(accrueInterest(db, T0 + 15 * DAY + 62 * DAY)).toBe(3);
    expect(interest(c.id).map((e) => e.at)).toEqual([T0 + 15 * DAY, addMonths(T0 + 15 * DAY, 1), addMonths(T0 + 15 * DAY, 2)]);
  });

  it('stops once the sale is paid, using payments oldest sale first', () => {
    const c = customer({ interestMode: 'order', interestRateBp: 300 });
    sell(c.id, 0, T0);
    sell(c.id, 0, T0 + DAY);
    receivePayment(db, { customerId: c.id, amount: 100_000, method: 'cash', reference: null }, T0 + 5 * DAY); // pays the first sale
    accrueInterest(db, T0 + 30 * DAY);
    const entries = interest(c.id);
    expect(entries).toHaveLength(1); // only the second sale (still owed) is charged
    expect(entries[0]).toMatchObject({ amount: 3_000, at: T0 + DAY + 15 * DAY });
  });

  it('ignores sales from before interest was switched on, and a voided sale', () => {
    const c = customer();
    sell(c.id, 0, T0);
    updateCustomer(db, c.id, { ...c, interestMode: 'order', interestRateBp: 300 }, T0 + 3 * DAY);
    const later = sell(c.id, 0, T0 + 4 * DAY);
    const voided = sell(c.id, 0, T0 + 5 * DAY);
    expect(voidOrder(db, { orderId: voided.orderId, reason: 'Entered by mistake' }, T0 + 6 * DAY)).toMatchObject({ ok: true });
    accrueInterest(db, T0 + 40 * DAY);
    expect(interest(c.id).map((e) => e.orderNumber)).toEqual([later.orderNumber]);
  });
});

describe('interest on total credit', () => {
  it('is charged monthly on everything owed then, and compounds', () => {
    const c = customer({ interestMode: 'total', interestRateBp: 200 }, T0);
    sell(c.id, 0, T0 + DAY); // 1,000.00
    sell(c.id, 0, T0 + 20 * DAY); // 2,000.00 in all
    expect(accrueInterest(db, addMonths(T0, 1) - 1)).toBe(0);
    expect(accrueInterest(db, addMonths(T0, 1))).toBe(1);
    expect(interest(c.id).map((e) => e.amount)).toEqual([4_000]); // 2% of 2,000.00
    expect(accrueInterest(db, addMonths(T0, 2))).toBe(1);
    expect(interest(c.id).map((e) => e.amount)).toEqual([4_000, 4_080]); // 2% of 2,040.00
    expect(balance(c.id)).toBe(200_000 + 4_000 + 4_080);
    expect(accrueInterest(db, addMonths(T0, 2))).toBe(0);
  });

  it('charges nothing in a month nothing is owed, and does not repeat later months', () => {
    const c = customer({ interestMode: 'total', interestRateBp: 200 }, T0);
    accrueInterest(db, addMonths(T0, 2)); // nothing owed
    sell(c.id, 0, addMonths(T0, 2) + DAY);
    expect(accrueInterest(db, addMonths(T0, 3))).toBe(1);
    expect(accrueInterest(db, addMonths(T0, 3))).toBe(0);
    expect(interest(c.id)).toHaveLength(1);
  });
});
