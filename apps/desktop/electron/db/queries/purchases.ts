import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  type CancelPurchaseResult,
  lineTotal,
  ORDER_PAYMENT_METHODS,
  type OrderPaymentMethod,
  type PayPurchaseResult,
  type PurchaseConcern,
  purchaseConcern,
  type ProductTracking,
  type PurchaseDetail,
  type PurchaseField,
  type PurchaseInput,
  type PurchaseLineInput,
  type PurchaseSummary,
  type ReceivePurchaseResult,
  type RemoveSuppliersResult,
  type SavePurchaseResult,
  type SaveSupplierResult,
  type SupplierField,
  type SupplierInput,
  type SupplierRecord,
} from '@micropos/core';
import type { AppDatabase } from '../index';
import { CREDITED, returnsOfPurchase } from './supplier-returns';
import { products, purchaseOrderLines, purchaseOrders, purchasePayments, suppliers } from '../schema';
import { receiveStock } from './inventory';
import { sellingEmployee } from './orders';

const MAX_BULK = 1000;
const MAX_LINES = 200;
const MAX_MILLI = 99_999_000;
const MAX_CENTS = 100_000_000_00;
const MAX_REFERENCE = 200;
const MAX_NOTE = 200;
const FIRST_NUMBER = 1001;

const cleanText = (value: unknown, max: number): string | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length > max ? undefined : clean || null;
};

// ---------------------------------------------------------------------------------------------------- suppliers

type SupplierInvalid = { field: SupplierField | null; error: string };

/** Validates what the renderer sent; returns clean input or the first problem found. */
export function sanitizeSupplierInput(value: unknown): SupplierInput | SupplierInvalid {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v['name'] === 'string' ? v['name'].trim().replace(/\s+/g, ' ') : '';
  if (!name) return { field: 'name', error: 'Enter a name' };
  if (name.length > 100) return { field: 'name', error: 'Name is too long' };
  const phone = cleanText(v['phone'], 40);
  if (phone === undefined) return { field: 'phone', error: 'Phone number is too long' };
  const note = cleanText(v['note'], MAX_NOTE);
  if (note === undefined) return { field: 'note', error: 'Note is too long' };
  return { name, phone, note };
}

const isInvalid = (r: SupplierInput | SupplierInvalid): r is SupplierInvalid => 'error' in r;

/** Cents paid on an order, read on the open connection so it sees the current transaction's writes. */
const PAID = `COALESCE((SELECT SUM(x.amount) FROM purchase_payments x WHERE x.purchase_order_id = p.id), 0)`;

function supplierRecords(db: AppDatabase, where: string, params: unknown[] = []): SupplierRecord[] {
  return db.$client
    .prepare(
      `SELECT s.id AS id, s.name AS name, s.phone AS phone, s.note AS note, s.created_at AS createdAt, s.deleted_at AS deletedAt,
              COALESCE((SELECT SUM(p.total - ${PAID} - ${CREDITED}) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status <> 'cancelled'), 0) AS owed,
              (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status = 'ordered') AS openOrders
         FROM suppliers s ${where} ORDER BY lower(s.name), s.id`,
    )
    .all(...params) as SupplierRecord[];
}

/** Live suppliers with what is owed to each; deleted ones too when asked. */
export const listSuppliers = (db: AppDatabase, includeDeleted = false): SupplierRecord[] =>
  supplierRecords(db, includeDeleted ? '' : 'WHERE s.deleted_at IS NULL');

function saveSupplier(db: AppDatabase, id: string | null, raw: unknown): SaveSupplierResult {
  const input = sanitizeSupplierInput(raw);
  if (isInvalid(input)) return { ok: false, ...input };
  let savedId: string;
  if (id === null) {
    savedId = db.insert(suppliers).values(input).returning({ id: suppliers.id }).get().id;
  } else {
    const [existing] = db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt))).all();
    if (!existing) return { ok: false, field: null, error: 'Supplier not found' };
    db.update(suppliers).set(input).where(eq(suppliers.id, id)).run();
    savedId = id;
  }
  return { ok: true, supplier: supplierRecords(db, 'WHERE s.id = ?', [savedId])[0]! };
}

export const createSupplier = (db: AppDatabase, raw: unknown): SaveSupplierResult => saveSupplier(db, null, raw);
export const updateSupplier = (db: AppDatabase, id: unknown, raw: unknown): SaveSupplierResult =>
  typeof id === 'string' ? saveSupplier(db, id, raw) : { ok: false, field: null, error: 'Supplier not found' };

const idList = (ids: unknown): string[] =>
  Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_BULK) : [];

/** Removes suppliers from the list. One still owed money, or with an order on the way, stays and is reported. */
export function deleteSuppliers(db: AppDatabase, ids: unknown, now = Date.now()): RemoveSuppliersResult {
  const wanted = idList(ids);
  const result: RemoveSuppliersResult = { removed: 0, blocked: [] };
  if (!wanted.length) return result;
  const rows = listSuppliers(db).filter((s) => wanted.includes(s.id));
  const removable = rows.filter((s) => s.owed === 0 && s.openOrders === 0);
  result.blocked = rows.filter((s) => s.owed !== 0 || s.openOrders !== 0).map((s) => s.name);
  if (removable.length) db.update(suppliers).set({ deletedAt: now }).where(inArray(suppliers.id, removable.map((s) => s.id))).run();
  result.removed = removable.length;
  return result;
}

export function restoreSuppliers(db: AppDatabase, ids: unknown): void {
  const wanted = idList(ids);
  if (wanted.length) db.update(suppliers).set({ deletedAt: null }).where(inArray(suppliers.id, wanted)).run();
}

// --------------------------------------------------------------------------------------------- purchase orders

type PurchaseInvalid = { field: PurchaseField | null; error: string };
type CleanPurchase = Omit<PurchaseInput, 'lines'> & { lines: PurchaseLineInput[]; total: number };

const isEpoch = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Validates what the renderer sent; returns clean input (with the total) or the first problem found. */
export function sanitizePurchaseInput(value: unknown): CleanPurchase | PurchaseInvalid {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v['supplierId'] !== 'string') return { field: 'supplier', error: 'Choose a supplier' };
  for (const field of ['expectedAt', 'dueAt'] as const) {
    if (v[field] !== null && v[field] !== undefined && !isEpoch(v[field])) {
      return { field, error: field === 'dueAt' ? 'Enter a valid due date' : 'Enter a valid expected date' };
    }
  }
  const reference = cleanText(v['reference'], MAX_REFERENCE);
  if (reference === undefined) return { field: 'reference', error: 'Reference is too long' };
  const note = cleanText(v['note'], MAX_NOTE);
  if (note === undefined) return { field: 'note', error: 'Note is too long' };
  const rawLines = Array.isArray(v['lines']) ? (v['lines'] as unknown[]) : [];
  if (!rawLines.length) return { field: 'lines', error: 'Add at least one product' };
  if (rawLines.length > MAX_LINES) return { field: 'lines', error: 'Too many products on one order' };
  const lines: PurchaseLineInput[] = [];
  let total = 0;
  for (const raw of rawLines) {
    const l = (raw ?? {}) as Record<string, unknown>;
    if (typeof l['productId'] !== 'string') return { field: 'product', error: 'Choose a product' };
    if (lines.some((x) => x.productId === l['productId'])) return { field: 'product', error: 'A product can be on an order only once' };
    const q = l['quantityMilli'];
    if (typeof q !== 'number' || !Number.isInteger(q) || q <= 0 || q > MAX_MILLI) return { field: 'quantity', error: 'Enter a valid quantity' };
    const c = l['unitCost'];
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > MAX_CENTS) return { field: 'unitCost', error: 'Enter a valid cost' };
    lines.push({ productId: l['productId'], quantityMilli: q, unitCost: c });
    total += lineTotal(c, q);
  }
  if (total > MAX_CENTS) return { field: 'lines', error: 'The total is too large' };
  return {
    supplierId: v['supplierId'],
    expectedAt: (v['expectedAt'] as number | null | undefined) ?? null,
    dueAt: (v['dueAt'] as number | null | undefined) ?? null,
    reference,
    note,
    lines,
    total,
  };
}

const isPurchaseInvalid = (r: CleanPurchase | PurchaseInvalid): r is PurchaseInvalid => 'error' in r;

/** The number the next order gets: PO-1001, PO-1002, ... one more than the highest used. */
export function nextPurchaseNumber(db: AppDatabase): string {
  const row = db.$client
    .prepare(`SELECT MAX(CAST(SUBSTR(po_number, 4) AS INTEGER)) AS last FROM purchase_orders WHERE po_number LIKE 'PO-%'`)
    .get() as { last: number | null };
  return `PO-${Math.max(row.last ?? 0, FIRST_NUMBER - 1) + 1}`;
}

type SummaryRow = Omit<PurchaseSummary, 'owed' | 'partlyReceived'> & { anyReceived: number };

function summaries(db: AppDatabase, where = '', params: unknown[] = []): PurchaseSummary[] {
  const rows = db.$client
    .prepare(
      `SELECT p.id AS id, p.po_number AS number, p.supplier_id AS supplierId, s.name AS supplierName, p.status AS status,
              p.ordered_at AS orderedAt, p.expected_at AS expectedAt, p.due_at AS dueAt, p.received_at AS receivedAt,
              p.reference AS reference, p.total AS total, ${PAID} AS paid, ${CREDITED} AS credited,
              (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = p.id) AS lineCount,
              EXISTS (SELECT 1 FROM stock_movements m JOIN purchase_order_lines l ON l.id = m.purchase_order_line_id WHERE l.purchase_order_id = p.id) AS anyReceived
         FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id ${where}
        ORDER BY p.ordered_at DESC, p.rowid DESC`,
    )
    .all(...params) as SummaryRow[];
  return rows.map(({ anyReceived, ...r }) => ({
    ...r,
    partlyReceived: r.status === 'ordered' && anyReceived === 1,
    owed: r.status === 'cancelled' ? 0 : r.total - r.paid - r.credited,
  }));
}

export const listPurchases = (db: AppDatabase): PurchaseSummary[] => summaries(db);

export function getPurchase(db: AppDatabase, id: unknown): PurchaseDetail | null {
  if (typeof id !== 'string') return null;
  const summary = summaries(db, 'WHERE p.id = ?', [id])[0];
  if (!summary) return null;
  const extra = db.$client
    .prepare(`SELECT p.note AS note, e.name AS employeeName FROM purchase_orders p LEFT JOIN employees e ON e.id = p.employee_id WHERE p.id = ?`)
    .get(id) as { note: string | null; employeeName: string | null };
  const lines = db.$client
    .prepare(
      `SELECT l.id AS id, l.product_id AS productId, pr.name AS productName, pr.barcode AS productCode, pr.unit AS unit, pr.tracking AS tracking,
              l.quantity_milli AS quantityMilli, l.unit_cost AS unitCost,
              COALESCE((SELECT SUM(m.quantity_milli) FROM stock_movements m WHERE m.purchase_order_line_id = l.id AND m.type = 'receive'), 0) AS receivedMilli
         FROM purchase_order_lines l JOIN products pr ON pr.id = l.product_id
        WHERE l.purchase_order_id = ? ORDER BY l.rowid`,
    )
    .all(id) as Omit<PurchaseDetail['lines'][number], 'total'>[];
  const payments = db.$client
    .prepare(
      `SELECT x.id AS id, x.amount AS amount, x.method AS method, x.reference AS reference, x.note AS note, e.name AS employeeName, x.at AS at
         FROM purchase_payments x LEFT JOIN employees e ON e.id = x.employee_id
        WHERE x.purchase_order_id = ? ORDER BY x.at DESC, x.rowid DESC`,
    )
    .all(id) as PurchaseDetail['payments'];
  return { ...summary, ...extra, lines: lines.map((l) => ({ ...l, tracking: l.tracking as ProductTracking, total: lineTotal(l.unitCost, l.quantityMilli) })), payments, returns: returnsOfPurchase(db, id) };
}

class Stop extends Error {
  constructor(readonly error: string, readonly field: PurchaseField | null = null) {
    super(error);
  }
}

/** Checks the supplier and every product still exist (a deleted one cannot be ordered). */
function checkReferences(db: AppDatabase, input: CleanPurchase): void {
  const [supplier] = db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, input.supplierId), isNull(suppliers.deletedAt))).all();
  if (!supplier) throw new Stop('Supplier no longer exists', 'supplier');
  const live = new Set(
    db.select({ id: products.id }).from(products).where(and(inArray(products.id, input.lines.map((l) => l.productId)), isNull(products.deletedAt))).all().map((p) => p.id),
  );
  if (input.lines.some((l) => !live.has(l.productId))) throw new Stop('A product on the order no longer exists', 'product');
}

function save(db: AppDatabase, id: string | null, raw: unknown, now: number): SavePurchaseResult {
  const input = sanitizePurchaseInput(raw);
  if (isPurchaseInvalid(input)) return { ok: false, ...input };
  try {
    const savedId = db.transaction((tx) => {
      checkReferences(db, input);
      const header = {
        supplierId: input.supplierId,
        expectedAt: input.expectedAt,
        dueAt: input.dueAt,
        reference: input.reference,
        note: input.note,
        total: input.total,
      };
      let orderId: string;
      if (id === null) {
        orderId = tx
          .insert(purchaseOrders)
          .values({ ...header, poNumber: nextPurchaseNumber(db), orderedAt: now, employeeId: sellingEmployee(tx), createdAt: now, updatedAt: now })
          .returning({ id: purchaseOrders.id })
          .get().id;
      } else {
        const current = summaries(db, 'WHERE p.id = ?', [id])[0];
        if (!current) throw new Stop('Purchase order not found');
        if (current.status !== 'ordered') throw new Stop('Only an order that has not arrived can be changed');
        if (current.partlyReceived) throw new Stop('Part of this order has arrived, so it cannot be changed');
        if (input.total < current.paid) throw new Stop('The total is less than what is already paid', 'lines');
        tx.update(purchaseOrders).set({ ...header, updatedAt: now }).where(eq(purchaseOrders.id, id)).run();
        tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)).run();
        orderId = id;
      }
      tx.insert(purchaseOrderLines).values(input.lines.map((l) => ({ ...l, purchaseOrderId: orderId }))).run();
      return orderId;
    });
    return { ok: true, purchase: getPurchase(db, savedId)! };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, field: error.field, error: error.error };
    throw error;
  }
}

export const createPurchase = (db: AppDatabase, raw: unknown, now = Date.now()): SavePurchaseResult => save(db, null, raw, now);
export const updatePurchase = (db: AppDatabase, id: unknown, raw: unknown, now = Date.now()): SavePurchaseResult =>
  typeof id === 'string' ? save(db, id, raw, now) : { ok: false, field: null, error: 'Purchase order not found' };

/**
 * Money paid to the supplier towards an order, in full or in parts. It can be paid before the stock arrives (a
 * deposit) but never more than is owed (a larger amount is almost always a typo) and not on a cancelled order.
 */
export function payPurchase(db: AppDatabase, raw: unknown, now = Date.now()): PayPurchaseResult {
  const v = (raw ?? {}) as Record<string, unknown>;
  if (typeof v['purchaseId'] !== 'string') return { ok: false, field: null, error: 'Purchase order not found' };
  const amount = v['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) {
    return { ok: false, field: 'amount', error: 'Enter the amount paid' };
  }
  const method = v['method'] as OrderPaymentMethod;
  if (!ORDER_PAYMENT_METHODS.includes(method)) return { ok: false, field: 'method', error: 'Choose how it was paid' };
  const reference = typeof v['reference'] === 'string' ? v['reference'].trim().slice(0, MAX_REFERENCE) || null : null;

  return db.transaction((tx) => {
    const order = summaries(db, 'WHERE p.id = ?', [v['purchaseId']])[0];
    if (!order) return { ok: false as const, field: null, error: 'Purchase order not found' };
    if (order.status === 'cancelled') return { ok: false as const, field: null, error: 'This order is cancelled' };
    if (order.owed <= 0) return { ok: false as const, field: 'amount' as const, error: 'Nothing is owed on this order' };
    if (amount > order.owed) return { ok: false as const, field: 'amount' as const, error: 'That is more than is owed' };
    tx.insert(purchasePayments).values({ purchaseOrderId: order.id, amount, method, reference, employeeId: sellingEmployee(tx), at: now }).run();
    return { ok: true as const, purchase: getPurchase(db, order.id)! };
  });
}

/** Calls off an order that has not arrived. One with money already paid on it stays (a refund from the supplier is not recorded here). */
export function cancelPurchase(db: AppDatabase, id: unknown, now = Date.now()): CancelPurchaseResult {
  const order = typeof id === 'string' ? summaries(db, 'WHERE p.id = ?', [id])[0] : undefined;
  if (!order) return { ok: false, error: 'Purchase order not found' };
  if (order.status !== 'ordered') return { ok: false, error: 'Only an order that has not arrived can be cancelled' };
  if (order.partlyReceived) return { ok: false, error: 'Part of this order has arrived, so it cannot be cancelled' };
  if (order.paid > 0) return { ok: false, error: 'Money has been paid on this order, so it cannot be cancelled' };
  db.update(purchaseOrders).set({ status: 'cancelled', updatedAt: now }).where(eq(purchaseOrders.id, order.id)).run();
  return { ok: true, purchase: getPurchase(db, order.id)! };
}

class ReceiveStop extends Error {
  constructor(readonly result: Extract<ReceivePurchaseResult, { ok: false }>) {
    super(result.error);
  }
}

/**
 * A delivery against the order: each line's `quantityMilli` arrives (all that is left of it when not given); every product that tracks stock goes into inventory as a new delivery at the ordered cost
 * (products that do not track stock are just recorded as bought). A product that tracks lots or expiry needs them in
 * `lines`. All or nothing: if any line is refused nothing is received and the order stays ordered.
 */
export function receivePurchase(db: AppDatabase, raw: unknown, now = Date.now()): ReceivePurchaseResult {
  const v = (raw ?? {}) as Record<string, unknown>;
  const given = new Map<string, { batchNumber: string | null; expiresAt: number | null; quantityMilli: number | null }>();
  for (const item of Array.isArray(v['lines']) ? (v['lines'] as unknown[]) : []) {
    const l = (item ?? {}) as Record<string, unknown>;
    if (typeof l['lineId'] !== 'string') continue;
    given.set(l['lineId'], {
      batchNumber: typeof l['batchNumber'] === 'string' ? l['batchNumber'] : null,
      expiresAt: typeof l['expiresAt'] === 'number' ? l['expiresAt'] : null,
      quantityMilli: typeof l['quantityMilli'] === 'number' ? l['quantityMilli'] : null,
    });
  }
  try {
    return db.transaction((tx) => {
      const order = typeof v['purchaseId'] === 'string' ? getPurchase(db, v['purchaseId']) : null;
      if (!order) throw new ReceiveStop({ ok: false, lineId: null, field: null, error: 'Purchase order not found' });
      if (order.status !== 'ordered') throw new ReceiveStop({ ok: false, lineId: null, field: null, error: 'This order has already been received or cancelled' });
      const employeeId = sellingEmployee(tx);
      let received = !order.lines.some((l) => l.tracking !== 'none'); // nothing to count for untracked-only orders
      for (const line of order.lines) {
        const left = line.quantityMilli - line.receivedMilli;
        if (line.tracking === 'none' || left <= 0) continue;
        const details = given.get(line.id);
        const arriving = details?.quantityMilli ?? left;
        if (!Number.isInteger(arriving) || arriving < 0) throw new ReceiveStop({ ok: false, lineId: line.id, field: 'quantity', error: `${line.productName}: Enter a valid quantity` });
        if (arriving === 0) continue;
        const result = receiveStock(
          db,
          {
            productId: line.productId,
            batchNumber: details?.batchNumber ?? null,
            expiresAt: details?.expiresAt ?? null,
            quantityMilli: arriving,
            unitCost: line.unitCost,
            purchaseLineId: line.id,
          },
          employeeId,
          now,
          tx,
        );
        if (!result.ok) {
          const field = result.field === 'batchNumber' || result.field === 'expiresAt' || result.field === 'quantity' ? result.field : null;
          throw new ReceiveStop({ ok: false, lineId: line.id, field, error: `${line.productName}: ${result.error}` });
        }
        received = true;
      }
      if (!received) throw new ReceiveStop({ ok: false, lineId: null, field: null, error: 'Enter what has arrived' });
      // An order that holds only products that track no stock has no receipts to complete it, so receiving it does.
      if (!order.lines.some((l) => l.tracking !== 'none')) {
        tx.update(purchaseOrders).set({ status: 'received', receivedAt: now, updatedAt: now }).where(eq(purchaseOrders.id, order.id)).run();
      }
      return { ok: true as const, purchase: getPurchase(db, order.id)! };
    });
  } catch (error) {
    if (error instanceof ReceiveStop) return error.result;
    throw error;
  }
}

/** Orders that are late to arrive or overdue for payment, the most overdue first. */
export function purchaseConcerns(db: AppDatabase, now = Date.now()): PurchaseConcern[] {
  const concerns = summaries(db).flatMap((p) => purchaseConcern(p, now) ?? []);
  const since = (c: PurchaseConcern): number => Math.min(c.lateSince ?? Infinity, c.purchase.dueAt !== null && c.overdueOwed !== null ? c.purchase.dueAt : Infinity);
  return concerns.sort((a, b) => since(a) - since(b));
}
