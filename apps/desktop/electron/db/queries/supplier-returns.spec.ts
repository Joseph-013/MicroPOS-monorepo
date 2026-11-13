import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { listBatches, stockConcerns } from './inventory';
import { createProduct } from './products';
import { createPurchase, createSupplier, getPurchase, listPurchases, listSuppliers, payPurchase, receivePurchase } from './purchases';
import { receiveStock } from './inventory';
import { returnToSupplier } from './supplier-returns';

const DAY = 86_400_000;
let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-returns-'));
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
const bread = () => ok(createProduct(db, { name: 'Bread', unit: 'each', tracking: 'expiry', shelfLifeDays: 5, criticalLevelMilli: null, sku: null, barcode: null, price: 300, cost: 100, active: true, categoryIds: [] })).product;

/** 10 loaves bought at 100 each (1,000 total) on an order, received into one lot that expires in two days. */
function bought(over: { pay?: number } = {}) {
  const supplier = ok(createSupplier(db, { name: 'Metro', phone: null, note: null })).supplier;
  const p = bread();
  const po = ok(createPurchase(db, { supplierId: supplier.id, expectedAt: null, dueAt: null, reference: null, note: null, lines: [{ productId: p.id, quantityMilli: 10_000, unitCost: 100 }] })).purchase;
  ok(receivePurchase(db, { purchaseId: po.id, lines: [{ lineId: po.lines[0]!.id, quantityMilli: 10_000, batchNumber: 'L1', expiresAt: Date.now() + 2 * DAY }] }));
  if (over.pay) ok(payPurchase(db, { purchaseId: po.id, amount: over.pay, method: 'cash', reference: null }));
  const batch = listBatches(db).find((b) => b.productId === p.id)!;
  return { supplier, p, po, batch };
}

describe('returning stock to a supplier', () => {
  it('takes the stock out and the refund off what is owed on the order it came on', () => {
    const { supplier, po, batch } = bought();
    expect(batch).toMatchObject({ purchaseNumber: po.number, supplierName: 'Metro', supplierId: supplier.id });
    const done = ok(returnToSupplier(db, { batchId: batch.id, quantityMilli: 4_000, supplierId: null, refundAmount: 300, note: 'Stale' }));
    expect(done.return).toMatchObject({ supplierName: 'Metro', purchaseNumber: po.number, quantityMilli: 4_000, refundAmount: 300, creditedAmount: 300, note: 'Stale' });
    expect(listBatches(db)[0]!.onHandMilli).toBe(6_000);
    const order = getPurchase(db, po.id)!;
    expect(order).toMatchObject({ total: 1_000, paid: 0, credited: 300, owed: 700 });
    expect(order.returns.map((r) => r.refundAmount)).toEqual([300]);
    expect(listPurchases(db)[0]!.owed).toBe(700);
    expect(listSuppliers(db)[0]!.owed).toBe(700);
  });

  it('only reduces what is still owed; the rest of the refund is just recorded', () => {
    const { po, batch } = bought({ pay: 900 }); // 100 left to owe
    const done = ok(returnToSupplier(db, { batchId: batch.id, quantityMilli: 5_000, supplierId: null, refundAmount: 400, note: null }));
    expect(done.return).toMatchObject({ refundAmount: 400, creditedAmount: 100 });
    expect(getPurchase(db, po.id)).toMatchObject({ paid: 900, credited: 100, owed: 0 });
    // Nothing is owed any more, so a second refund credits nothing.
    expect(ok(returnToSupplier(db, { batchId: batch.id, quantityMilli: 1_000, supplierId: null, refundAmount: 50, note: null })).return.creditedAmount).toBe(0);
  });

  it('may come with no refund at all, and clears the concern for an expired batch', () => {
    const { batch, p } = bought();
    expect(stockConcerns(db, Date.now() + 3 * DAY).map((c) => c.kind)).toEqual(['expired']);
    ok(returnToSupplier(db, { batchId: batch.id, quantityMilli: 10_000, supplierId: null, refundAmount: 0, note: null }));
    expect(stockConcerns(db, Date.now() + 3 * DAY).map((c) => [c.kind, c.productName])).toEqual([['out', p.name]]); // none left, so out of stock now
  });

  it('refuses too much, a refund over the cost, and a missing supplier for stock that did not come on an order', () => {
    const { batch } = bought();
    expect(returnToSupplier(db, { batchId: batch.id, quantityMilli: 11_000, supplierId: null, refundAmount: 0, note: null })).toMatchObject({ ok: false, field: 'quantity' });
    expect(returnToSupplier(db, { batchId: batch.id, quantityMilli: 0, supplierId: null, refundAmount: 0, note: null })).toMatchObject({ ok: false, field: 'quantity' });
    expect(returnToSupplier(db, { batchId: batch.id, quantityMilli: 2_000, supplierId: null, refundAmount: 201, note: null })).toMatchObject({ ok: false, field: 'refundAmount' });
    expect(returnToSupplier(db, { batchId: batch.id, quantityMilli: 2_000, supplierId: null, refundAmount: -1, note: null })).toMatchObject({ ok: false, field: 'refundAmount' });
    expect(returnToSupplier(db, { batchId: 'nope', quantityMilli: 1_000, supplierId: null, refundAmount: 0, note: null })).toMatchObject({ ok: false, field: null });
    expect(listBatches(db)[0]!.onHandMilli).toBe(10_000);

    // Stock received by hand has no order, so the supplier must be chosen.
    const q = ok(createProduct(db, { name: 'Salt', unit: 'each', tracking: 'quantity', price: 100, cost: 50, active: true, categoryIds: [] })).product;
    ok(receiveStock(db, { productId: q.id, batchNumber: null, expiresAt: null, quantityMilli: 5_000, unitCost: 50, note: null }));
    const loose = listBatches(db).find((b) => b.productId === q.id)!;
    expect(loose.purchaseId).toBeNull();
    expect(returnToSupplier(db, { batchId: loose.id, quantityMilli: 1_000, supplierId: null, refundAmount: 20, note: null })).toMatchObject({ ok: false, field: 'supplier' });
    expect(returnToSupplier(db, { batchId: loose.id, quantityMilli: 1_000, supplierId: 'nope', refundAmount: 20, note: null })).toMatchObject({ ok: false, field: 'supplier' });
    const supplier = ok(createSupplier(db, { name: 'Corner', phone: null, note: null })).supplier;
    const done = ok(returnToSupplier(db, { batchId: loose.id, quantityMilli: 1_000, supplierId: supplier.id, refundAmount: 20, note: null }));
    expect(done.return).toMatchObject({ supplierName: 'Corner', purchaseNumber: null, refundAmount: 20, creditedAmount: 0 });
  });
});
