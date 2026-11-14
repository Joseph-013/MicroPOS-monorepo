import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSaleReceipt, discountCents, EMPTY_RECEIPT_SHOP, layoutReceipt, parseDiscount } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../index';
import { loadDraft, saveDraft } from './draft';
import { givesDiscount } from '../../ipc/discount-gate';
import { completeOrder, getOrder, refundOrder } from './orders';
import { createProduct } from './products';
import { salesReport } from './reports';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-discounts-'));
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
const product = (name: string, price: number) => ok(createProduct(db, { name, unit: 'each', tracking: 'none', price, active: true, categoryIds: [] })).product;
const cash = { method: 'cash', tendered: 100_000 };

describe('discount arithmetic', () => {
  it('takes an amount or a percent off, rounded to the cent and never more than the base', () => {
    expect(discountCents({ mode: 'amount', value: 150 }, 1000)).toBe(150);
    expect(discountCents({ mode: 'amount', value: 5000 }, 1000)).toBe(1000);
    expect(discountCents({ mode: 'percent', value: 1000 }, 858)).toBe(86); // 85.8 -> 86
    expect(discountCents({ mode: 'percent', value: 10_000 }, 858)).toBe(858);
    expect(discountCents(null, 1000)).toBe(0);
    expect(discountCents({ mode: 'amount', value: 100 }, 0)).toBe(0);
  });

  it('reads typed text: pesos with up to two decimals, or a percent up to 100', () => {
    expect(parseDiscount('12.5', 'amount')).toEqual({ mode: 'amount', value: 1250 });
    expect(parseDiscount(' 7.5% ', 'percent')).toEqual({ mode: 'percent', value: 750 });
    for (const bad of ['', '0', '-5', '1e3', 'abc', '1.234']) expect(parseDiscount(bad, 'amount')).toBeNull();
    expect(parseDiscount('100', 'percent')).toEqual({ mode: 'percent', value: 10_000 });
    expect(parseDiscount('100.01', 'percent')).toBeNull();
  });

  it('spots an order that carries a discount, which needs the permission', () => {
    expect(givesDiscount({ discount: 0, lines: [{ discount: 0 }, {}] })).toBe(false);
    expect(givesDiscount({ discount: 100, lines: [] })).toBe(true);
    expect(givesDiscount({ discount: 0, lines: [{ productId: 'x' }, { discount: 5 }] })).toBe(true);
    expect(givesDiscount(null)).toBe(false);
  });
});

describe('the checkout draft with discounts', () => {
  const line = { productId: 'p1', name: 'Water', quantityMilli: 1000, unitPrice: 5000, unit: 'each' };
  it('keeps item and order discounts, the reason and the note, and drops what is malformed', () => {
    saveDraft(db, {
      lines: [{ ...line, discount: { mode: 'percent', value: 500 } }, { ...line, productId: 'p2', discount: { mode: 'percent', value: 99_999 } }],
      orderDiscount: { mode: 'amount', value: 250 },
      discountReason: 'Loyal',
      note: 'Gift',
    });
    const draft = loadDraft(db)!;
    expect(draft.orderDiscount).toEqual({ mode: 'amount', value: 250 });
    expect([draft.discountReason, draft.note]).toEqual(['Loyal', 'Gift']);
    expect(draft.lines[0]!.discount).toEqual({ mode: 'percent', value: 500 });
    expect(draft.lines[1]!.discount).toBeUndefined(); // more than 100%
    saveDraft(db, { lines: [line], orderDiscount: { mode: 'x', value: 1 }, discountReason: '  ', note: 5 });
    expect(loadDraft(db)).toEqual({ lines: [line] });
  });
});

describe('selling with discounts and a note', () => {
  it('records line and order discounts, the reason and the note, and the totals add up', () => {
    const water = product('Water', 5000);
    const soda = product('Soda', 3000);
    const sold = ok(
      completeOrder(db, {
        lines: [
          { productId: water.id, quantityMilli: 2000, unitPrice: 5000, discount: 1000 }, // 100.00 gross, 10.00 off
          { productId: soda.id, quantityMilli: 1000, unitPrice: 3000 },
        ],
        discount: 500,
        discountReason: '  Loyal customer ',
        note: ' Pick up at 5 ',
        payment: cash,
      }),
    );
    expect(sold.total).toBe(13_000 - 1000 - 500);
    const order = getOrder(db, sold.orderId)!;
    expect(order).toMatchObject({ subtotal: 13_000, discountTotal: 1500, total: 11_500, discountReason: 'Loyal customer', note: 'Pick up at 5' });
    expect(order.lines.map((l) => [l.name, l.lineTotal, l.discount]).sort()).toEqual([['Soda', 3000, 0], ['Water', 10_000, 1000]]);
    // Reports count the discounts in their "discounts" line and net sales after them.
    const report = salesReport(db, '1970-01-01', '2999-12-31')!;
    expect(report.sales).toMatchObject({ gross: 13_000, discounts: 1500, net: 11_500 });
  });

  it('forgets the reason when nothing was discounted, and keeps a note on its own', () => {
    const water = product('Water', 5000);
    const sold = ok(completeOrder(db, { lines: [{ productId: water.id, quantityMilli: 1000, unitPrice: 5000 }], discount: 0, discountReason: 'None really', note: 'Gift', payment: cash }));
    expect(getOrder(db, sold.orderId)).toMatchObject({ discountTotal: 0, discountReason: null, note: 'Gift' });
  });

  it('refuses a discount bigger than its line or than what is left of the order, recording nothing', () => {
    const water = product('Water', 5000);
    const soda = product('Soda', 3000);
    const lines = [{ productId: water.id, quantityMilli: 1000, unitPrice: 5000, discount: 5001 }];
    expect(completeOrder(db, { lines, discount: 0, payment: cash })).toMatchObject({ ok: false, error: expect.stringContaining('more than the item') });
    const two = [{ productId: water.id, quantityMilli: 1000, unitPrice: 5000, discount: 4000 }, { productId: soda.id, quantityMilli: 1000, unitPrice: 3000 }];
    expect(completeOrder(db, { lines: two, discount: 4001, payment: cash })).toMatchObject({ ok: false, error: 'The discount is more than the order' });
    expect(completeOrder(db, { lines: two, discount: 4000, payment: cash }).ok).toBe(true); // everything but nothing left over: free
    expect(completeOrder(db, { lines: [{ ...two[0]!, discount: -1 }], discount: 0, payment: cash })).toMatchObject({ ok: false });
    expect(salesReport(db, '1970-01-01', '2999-12-31')!.sales.count).toBe(1);
  });

  it('a refund undoes the discounts too, and keeps the reason', () => {
    const water = product('Water', 5000);
    const sold = ok(completeOrder(db, { lines: [{ productId: water.id, quantityMilli: 1000, unitPrice: 5000, discount: 500 }], discount: 250, discountReason: 'Damaged box', payment: cash }));
    const refund = ok(refundOrder(db, { orderId: sold.orderId, reason: 'Changed mind' }));
    const back = getOrder(db, refund.refundOrderId!)!;
    expect(back).toMatchObject({ subtotal: -5000, discountTotal: -750, total: -4250, discountReason: 'Damaged box' });
    expect(back.lines[0]).toMatchObject({ lineTotal: -5000, discount: -500 });
    expect(salesReport(db, '1970-01-01', '2999-12-31')!.netAfterRefunds).toBe(0);
  });

  it('prints each line discount and the note on the receipt', () => {
    const water = product('Water', 5000);
    const sold = ok(completeOrder(db, { lines: [{ productId: water.id, quantityMilli: 2000, unitPrice: 5000, discount: 1000 }], discount: 0, note: 'Pick up at 5', payment: cash }));
    const doc = buildSaleReceipt(getOrder(db, sold.orderId)!, EMPTY_RECEIPT_SHOP, 32);
    const rows = layoutReceipt(doc).map((r) => (r.kind === 'text' ? r.text.trim() : ''));
    expect(rows.some((t) => /^Discount +-10\.00$/.test(t))).toBe(true);
    expect(rows.some((t) => t === 'Note: Pick up at 5')).toBe(true);
  });
});
