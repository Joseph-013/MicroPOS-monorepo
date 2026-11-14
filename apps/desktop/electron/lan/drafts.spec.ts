import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newSessionState, runAsSession } from '../auth/context';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { clearDraft, deviceDraftKey, draftKey, loadDraft, othersInProgress, saveDraft } from '../db/queries/draft';
import { deleteDraftForEveryone, deleteDraftsOf } from '../db/queries/owned-drafts';
import { loadProductDraft, saveProductDraft } from '../db/queries/product-draft';
import { loadRepackageDraft, saveRepackageDraft } from '../db/queries/repackage-draft';
import { employees, settings } from '../db/schema';
import { completeOrder, nextOrderNumber } from '../db/queries/orders';
import { createProduct, deleteProducts } from '../db/queries/products';

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

describe('drafts belong to the person who started them', () => {
  /** Someone signed in on the till (`deviceId` null) or on a phone. */
  const as = (employeeId: string, deviceId: string | null = null) => {
    const state = newSessionState(deviceId);
    state.session = { employeeId, loginSessionId: `ls-${employeeId}` };
    return <T>(fn: () => T): T => runAsSession(state, fn);
  };
  const person = (name: string): string => db.insert(employees).values({ name, employeeNumber: name, role: 'cashier', pinHash: 'x' }).returning().get().id;
  const keys = (): string[] => db.select({ key: settings.key }).from(settings).all().map((r) => r.key).sort();

  it('keeps one checkout order per person on the same till, and tells each about the waiting orders of others', () => {
    const sam = as(person('Sam'));
    const ana = as(person('Ana'));
    sam(() => saveDraft(db, { lines: [line('p1', 'Sam item')] }));
    expect(ana(() => loadDraft(db))).toBeNull(); // Ana starts with an empty order
    ana(() => saveDraft(db, { lines: [line('p2', 'Ana item')] }));
    expect(sam(() => loadDraft(db))!.lines[0]!.name).toBe('Sam item');
    expect(ana(() => othersInProgress(db))).toEqual(['Sam']);
    expect(sam(() => othersInProgress(db))).toEqual(['Ana']);
    ana(() => clearDraft(db));
    expect(sam(() => othersInProgress(db))).toEqual([]); // an empty order is no order
    expect(sam(() => loadDraft(db))).not.toBeNull();
  });

  it('keeps the orders of one person on the till and on a phone apart, and counts only this device', () => {
    const samId = person('Sam');
    const anaId = person('Ana');
    as(samId)(() => saveDraft(db, { lines: [line('p1', 'On the till')] }));
    as(samId, 'dev-a')(() => saveDraft(db, { lines: [line('p2', 'On the phone')] }));
    expect(as(samId)(() => loadDraft(db))!.lines[0]!.name).toBe('On the till');
    expect(as(samId, 'dev-a')(() => loadDraft(db))!.lines[0]!.name).toBe('On the phone');
    expect(as(anaId, 'dev-b')(() => othersInProgress(db))).toEqual([]); // Sam's orders are on other devices
    expect(as(anaId, 'dev-a')(() => othersInProgress(db))).toEqual(['Sam']);
  });

  it('hands an order saved before drafts had owners to the first person who opens Checkout on that device', () => {
    saveDraft(db, { lines: [line('p1', 'From before the update')] }); // nobody signed in: the old, unowned key
    expect(keys()).toEqual([deviceDraftKey(null)]);
    const samId = person('Sam');
    expect(as(samId)(() => loadDraft(db))!.lines[0]!.name).toBe('From before the update');
    expect(keys()).toEqual([draftKey(null, samId)]);
    expect(as(person('Ana'))(() => loadDraft(db))).toBeNull(); // already claimed
  });

  it('completing a sale clears only the order of the seller', () => {
    const water = ok(createProduct(db, { name: 'Water', unit: 'each', tracking: 'none', price: 5000, active: true, categoryIds: [] })).product;
    const sam = as(person('Sam'));
    const ana = as(person('Ana'));
    sam(() => saveDraft(db, { lines: [line(water.id)] }));
    ana(() => saveDraft(db, { lines: [line(water.id)] }));
    ana(() => ok(completeOrder(db, { lines: [{ productId: water.id, quantityMilli: 1000, unitPrice: 5000 }], discount: 0, payment: { method: 'cash', tendered: 5000 } })));
    expect(ana(() => loadDraft(db))).toBeNull();
    expect(sam(() => loadDraft(db))).not.toBeNull();
  });

  it('keeps product and Repackage form drafts per person', () => {
    const sam = as(person('Sam'));
    const ana = as(person('Ana'));
    sam(() => saveProductDraft(db, 'new', { name: 'Sam product' }));
    sam(() => saveRepackageDraft(db, { note: 'Sam repack' }));
    expect(ana(() => loadProductDraft(db, 'new'))).toBeNull();
    expect(ana(() => loadRepackageDraft(db))).toBeNull();
    expect(sam(() => loadProductDraft(db, 'new'))!.name).toBe('Sam product');
    expect(sam(() => loadRepackageDraft(db))!.note).toBe('Sam repack');
  });

  it('drops all drafts of a deleted product, the drafts of a deactivated person, and the orders of an unpaired phone', () => {
    const product = ok(createProduct(db, { name: 'Rice', unit: 'each', tracking: 'none', price: 100, active: true, categoryIds: [] })).product;
    const samId = person('Sam');
    const anaId = person('Ana');
    as(samId)(() => saveProductDraft(db, product.id, { name: 'Sam edit' }));
    as(anaId)(() => saveProductDraft(db, product.id, { name: 'Ana edit' }));
    deleteProducts(db, [product.id]);
    expect(keys().filter((k) => k.startsWith('product.draft.'))).toEqual([]);

    as(samId)(() => saveDraft(db, { lines: [line('p1')] }));
    as(samId)(() => saveRepackageDraft(db, { note: 'x' }));
    as(anaId)(() => saveDraft(db, { lines: [line('p1')] }));
    deleteDraftsOf(db, samId);
    expect(keys()).toEqual([draftKey(null, anaId)]);

    as(samId, 'dev-a')(() => saveDraft(db, { lines: [line('p1')] }));
    as(anaId, 'dev-a')(() => saveDraft(db, { lines: [line('p1')] }));
    deleteDraftForEveryone(db, deviceDraftKey('dev-a'));
    expect(keys()).toEqual([draftKey(null, anaId)]); // the till's order stays
  });
});
