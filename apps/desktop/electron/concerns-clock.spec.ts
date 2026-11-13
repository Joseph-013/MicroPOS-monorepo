import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_DOMAINS, EXPIRY_WARN_DAYS } from '@micropos/core';
import { nextConcernAt, startConcernsClock } from './concerns-clock';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './db';
import { saveCreditAlertSettings } from './db/queries/credit-alerts';
import { createCustomer } from './db/queries/customers';
import { receiveStock } from './db/queries/inventory';
import { completeOrder } from './db/queries/orders';
import { createProduct } from './db/queries/products';
import { createPurchase, createSupplier } from './db/queries/purchases';
import { emitDataChanged } from './ipc/changes';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12);
let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-clock-'));
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
const product = (tracking = 'expiry') =>
  ok(createProduct(db, { name: `P-${Math.random()}`, unit: 'each', tracking, shelfLifeDays: null, criticalLevelMilli: null, sku: null, barcode: null, price: 100, cost: 60, active: true, categoryIds: [] })).product;

describe('the next moment something becomes a concern', () => {
  it('is null when nothing is still to come', () => {
    expect(nextConcernAt(db, NOW)).toBeNull();
  });

  it('is the earliest of an expiry window, an expected date, a due date and a customer passing the days limit', () => {
    // A batch expiring in 10 days enters its window at 10 - 3 days.
    const p = product();
    ok(receiveStock(db, { productId: p.id, batchNumber: 'L1', expiresAt: NOW + 10 * DAY, quantityMilli: 1_000, unitCost: 1, note: null }));
    expect(nextConcernAt(db, NOW)).toBe(NOW + (10 - EXPIRY_WARN_DAYS) * DAY);

    // An order expected in 2 days is late one millisecond after.
    const s = ok(createSupplier(db, { name: 'Metro', phone: null, note: null })).supplier;
    const q = product('none');
    ok(createPurchase(db, { supplierId: s.id, expectedAt: NOW + 2 * DAY, dueAt: NOW + 20 * DAY, reference: null, note: null, lines: [{ productId: q.id, quantityMilli: 1_000, unitCost: 100 }] }));
    expect(nextConcernAt(db, NOW)).toBe(NOW + 2 * DAY + 1);

    // A customer whose oldest unpaid sale reaches 30 days in 1 day.
    saveCreditAlertSettings(db, { amount: null, days: 30 });
    const c = ok(createCustomer(db, { name: 'Nena', phone: null, note: null, creditLimit: null })).customer;
    const sold = ok(completeOrder(db, { lines: [{ productId: q.id, quantityMilli: 1_000, unitPrice: 100 }], discount: 0, customerId: c.id, amountPaid: 0, payment: { method: 'cash' } }, NOW - 29 * DAY));
    expect(sold.orderId).toBeTruthy();
    expect(nextConcernAt(db, NOW)).toBe(NOW - 29 * DAY + 30 * DAY + 1);
  });
});

describe('the concerns clock', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it('announces when the next concern appears, then waits for the one after', () => {
    const p = product();
    ok(receiveStock(db, { productId: p.id, batchNumber: 'L1', expiresAt: NOW + 5 * DAY, quantityMilli: 1_000, unitCost: 1, note: null }));
    const emit = vi.fn();
    const clock = startConcernsClock(db, emit);
    vi.advanceTimersByTime(2 * DAY - 1000);
    expect(emit).not.toHaveBeenCalled(); // the window opens at day 2
    vi.advanceTimersByTime(2000);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(DATA_DOMAINS);
    vi.advanceTimersByTime(3 * DAY); // and again when it expires at day 5
    expect(emit).toHaveBeenCalledTimes(2);
    clock.stop();
  });

  it('sets the alarm again when data changes, and never sleeps longer than six hours', () => {
    const emit = vi.fn();
    const clock = startConcernsClock(db, emit);
    vi.advanceTimersByTime(13 * 60 * 60 * 1000); // nothing to wait for: it keeps looking, and says nothing
    expect(emit).not.toHaveBeenCalled();
    const p = product();
    ok(receiveStock(db, { productId: p.id, batchNumber: 'L1', expiresAt: Date.now() + 4 * DAY, quantityMilli: 1_000, unitCost: 1, note: null }));
    emitDataChanged(['stock']); // a write brings a new deadline (day 1) into view
    vi.advanceTimersByTime(DAY + 1000);
    expect(emit).toHaveBeenCalledTimes(1);
    clock.stop();
  });

  it('announces everything after the computer wakes', () => {
    const emit = vi.fn();
    const clock = startConcernsClock(db, emit);
    clock.resume();
    expect(emit).toHaveBeenCalledWith(DATA_DOMAINS);
    clock.stop();
  });
});
