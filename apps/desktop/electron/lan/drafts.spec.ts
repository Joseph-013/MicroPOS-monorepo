import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newSessionState, runAsSession } from '../auth/context';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { clearDraft, draftKey, loadDraft, saveDraft } from '../db/queries/draft';
import { completeOrder, nextOrderNumber } from '../db/queries/orders';
import { createProduct } from '../db/queries/products';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-drafts-'));
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
const line = (productId: string, name = 'Water') => ({ productId, name, quantityMilli: 1000, unitPrice: 5000, unit: 'each' });
const phoneA = newSessionState('dev-a');
const phoneB = newSessionState('dev-b');

describe('checkout orders in progress, one per device', () => {
  it('names a key for the till and one for each paired phone', () => {
    expect(draftKey()).toBe('checkout.draft');
    expect(runAsSession(phoneA, () => draftKey())).toBe('checkout.draft.dev-a');
    expect(draftKey('dev-b')).toBe('checkout.draft.dev-b');
  });

  it('keeps the till, and each phone, with its own order: saving, loading and clearing never touch another', () => {
    saveDraft(db, { lines: [line('p-till', 'Till item')] });
    runAsSession(phoneA, () => saveDraft(db, { lines: [line('p-a', 'Phone A item')], note: 'for A' }));
    runAsSession(phoneB, () => saveDraft(db, { lines: [line('p-b', 'Phone B item')] }));
    expect(loadDraft(db)!.lines[0]!.name).toBe('Till item');
    expect(runAsSession(phoneA, () => loadDraft(db))).toMatchObject({ note: 'for A' });
    expect(runAsSession(phoneB, () => loadDraft(db))!.lines[0]!.name).toBe('Phone B item');
    runAsSession(phoneA, () => clearDraft(db));
    expect(runAsSession(phoneA, () => loadDraft(db))).toBeNull();
    expect(loadDraft(db)).not.toBeNull();
    expect(runAsSession(phoneB, () => loadDraft(db))).not.toBeNull();
  });

  it('completing a sale on one device clears only that device\'s order, and the next numbers do not collide', () => {
    const water = ok(createProduct(db, { name: 'Water', unit: 'each', tracking: 'none', price: 5000, active: true, categoryIds: [] })).product;
    saveDraft(db, { lines: [line(water.id)] });
    runAsSession(phoneA, () => saveDraft(db, { lines: [line(water.id)] }));
    const input = { lines: [{ productId: water.id, quantityMilli: 1000, unitPrice: 5000 }], discount: 0, payment: { method: 'cash', tendered: 5000 } };
    const fromPhone = runAsSession(phoneA, () => ok(completeOrder(db, input)));
    expect(runAsSession(phoneA, () => loadDraft(db))).toBeNull(); // the phone's order is done
    expect(loadDraft(db)).not.toBeNull(); // the till's is still being rung up
    const fromTill = ok(completeOrder(db, input));
    expect(new Set([fromPhone.orderNumber, fromTill.orderNumber]).size).toBe(2); // two sales, two numbers
    expect(nextOrderNumber(db)).toBe('SO-1003');
    expect(loadDraft(db)).toBeNull();
  });
});
