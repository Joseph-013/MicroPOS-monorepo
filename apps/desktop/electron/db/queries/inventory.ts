import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  type AdjustStockInput,
  type BatchRecord,
  expiryState,
  type InventoryOverview,
  type MovementRecord,
  type ReceiveStockInput,
  type RepackageField,
  type RepackageInput,
  type RepackageResult,
  type StockField,
  type StockResult,
  tracksBatches,
  tracksExpiry,
} from '@micropos/core';
import type { AppDatabase } from '../index';
import { uuid7 } from '../uuid';
import {
  type ProductTracking,
  productBatches,
  products,
  stockMovements,
  type StockMovementType,
} from '../schema';

const MAX_MILLI = 99_999_000;
const MAX_CENTS = 100_000_000_00;
const MAX_NOTE = 200;

type Problem = { ok: false; field: StockField | null; error: string };
const problem = (field: StockField | null, error: string): Problem => ({ ok: false, field, error });

interface BatchRow {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  unit: string;
  tracking: ProductTracking;
  batchNumber: string | null;
  receivedAt: number;
  expiresAt: number | null;
  unitCost: number | null;
  unitPrice: number;
  receivedMilli: number;
  onHandMilli: number;
}

/**
 * Batches with their received and remaining quantity, soonest expiry first (no expiry last, then oldest received).
 * Quantities are summed from the stock ledger. By default only batches with stock left are listed.
 */
export function listBatches(
  db: AppDatabase,
  options: { includeEmpty?: boolean; batchId?: string } = {},
): BatchRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.batchId) {
    where.push('b.id = ?');
    params.push(options.batchId);
  }
  const rows = db.$client
    .prepare(
      `SELECT b.id AS id, b.product_id AS productId, p.name AS productName, p.barcode AS productCode, p.unit AS unit,
              p.tracking AS tracking, b.batch_number AS batchNumber, b.received_at AS receivedAt,
              b.expires_at AS expiresAt, b.unit_cost AS unitCost, p.price AS unitPrice,
              COALESCE(SUM(CASE WHEN m.type = 'receive' THEN m.quantity_milli END), 0) AS receivedMilli,
              COALESCE(SUM(m.quantity_milli), 0) AS onHandMilli
         FROM product_batches b
         JOIN products p ON p.id = b.product_id
         LEFT JOIN stock_movements m ON m.batch_id = b.id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY b.id
        ${options.includeEmpty || options.batchId ? '' : 'HAVING onHandMilli > 0'}
        ORDER BY (b.expires_at IS NULL), b.expires_at, b.received_at`,
    )
    .all(...params) as BatchRow[];
  return rows;
}

/** Stock left and the soonest expiry (among batches with stock) for each product that has any batches. */
export function stockSummary(
  db: AppDatabase,
): Map<string, { onHandMilli: number; nextExpiry: number | null }> {
  const rows = db.$client
    .prepare(
      `SELECT b.product_id AS productId, SUM(s.q) AS onHandMilli,
              MIN(CASE WHEN s.q > 0 THEN b.expires_at END) AS nextExpiry
         FROM product_batches b
         JOIN (SELECT batch_id, SUM(quantity_milli) AS q FROM stock_movements GROUP BY batch_id) s ON s.batch_id = b.id
        GROUP BY b.product_id`,
    )
    .all() as { productId: string; onHandMilli: number; nextExpiry: number | null }[];
  return new Map(
    rows.map((r) => [r.productId, { onHandMilli: r.onHandMilli, nextExpiry: r.nextExpiry }]),
  );
}

const isMilli = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_MILLI;

/** Adds stock: a new batch, or more of an existing one (the unnamed batch of a quantity-only product, or the same lot). */
export function receiveStock(
  db: AppDatabase,
  raw: unknown,
  employeeId: string | null = null,
  now = Date.now(),
): StockResult {
  const input = (raw ?? {}) as Partial<ReceiveStockInput>;
  if (typeof input.productId !== 'string') return problem('product', 'Choose a product');
  const [product] = db
    .select({ id: products.id, tracking: products.tracking })
    .from(products)
    .where(and(eq(products.id, input.productId), isNull(products.deletedAt)))
    .all();
  if (!product) return problem('product', 'Product no longer exists');
  if (product.tracking === 'none')
    return problem('product', 'Stock is not tracked for this product');
  if (!isMilli(input.quantityMilli)) return problem('quantity', 'Enter a valid quantity');

  const tracking = product.tracking as ProductTracking;
  let batchNumber: string | null = null;
  if (tracksBatches(tracking)) {
    batchNumber = typeof input.batchNumber === 'string' ? input.batchNumber.trim() : '';
    if (!batchNumber) return problem('batchNumber', 'Enter a batch number');
    if (batchNumber.length > 64) return problem('batchNumber', 'Batch number is too long');
  }
  let expiresAt: number | null = null;
  if (tracksExpiry(tracking)) {
    if (
      typeof input.expiresAt !== 'number' ||
      !Number.isInteger(input.expiresAt) ||
      input.expiresAt <= 0
    ) {
      return problem('expiresAt', 'Enter an expiry date');
    }
    expiresAt = input.expiresAt;
  }
  const unitCost = input.unitCost ?? null;
  if (
    unitCost !== null &&
    !(
      typeof unitCost === 'number' &&
      Number.isInteger(unitCost) &&
      unitCost >= 0 &&
      unitCost <= MAX_CENTS
    )
  ) {
    return problem('unitCost', 'Enter a valid cost');
  }
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim().slice(0, MAX_NOTE)
      : null;

  const batchId = db.transaction((tx): string | Problem => {
    const sameBatch = tx
      .select()
      .from(productBatches)
      .where(
        and(
          eq(productBatches.productId, product.id),
          batchNumber === null
            ? isNull(productBatches.batchNumber)
            : eq(productBatches.batchNumber, batchNumber),
        ),
      )
      .all()[0];
    let id: string;
    if (sameBatch) {
      // The same lot delivered again: more of the same stock, so the dates must agree.
      if (expiresAt !== null && sameBatch.expiresAt !== expiresAt) {
        return problem('expiresAt', `Batch ${batchNumber} already has a different expiry date`);
      }
      id = sameBatch.id;
      if (sameBatch.unitCost === null && unitCost !== null) {
        tx.update(productBatches).set({ unitCost }).where(eq(productBatches.id, id)).run();
      }
    } else {
      id = tx
        .insert(productBatches)
        .values({ productId: product.id, batchNumber, expiresAt, unitCost, receivedAt: now })
        .returning({ id: productBatches.id })
        .get().id;
    }
    tx.insert(stockMovements)
      .values({
        productId: product.id,
        batchId: id,
        type: 'receive',
        quantityMilli: input.quantityMilli as number,
        employeeId,
        at: now,
        note,
      })
      .run();
    return id;
  });
  if (typeof batchId !== 'string') return batchId;
  return { ok: true, batch: listBatches(db, { includeEmpty: true, batchId })[0]! };
}

/** Removes stock as waste or expired, or corrects a count up or down. Never takes a batch below zero. */
export function adjustStock(
  db: AppDatabase,
  raw: unknown,
  employeeId: string | null = null,
  now = Date.now(),
): StockResult {
  const input = (raw ?? {}) as Partial<AdjustStockInput>;
  if (typeof input.batchId !== 'string') return problem(null, 'Batch no longer exists');
  const type = input.type;
  if (type !== 'adjust' && type !== 'waste' && type !== 'expired')
    return problem(null, 'Choose what happened');
  const quantity = input.quantityMilli;
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity === 0 ||
    Math.abs(quantity) > MAX_MILLI
  ) {
    return problem('quantity', 'Enter a valid quantity');
  }
  // Waste and expiry always remove stock, whatever sign was typed; a correction keeps its sign.
  const delta = type === 'adjust' ? quantity : -Math.abs(quantity);
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim().slice(0, MAX_NOTE)
      : null;

  const [batch] = listBatches(db, { includeEmpty: true, batchId: input.batchId });
  if (!batch) return problem(null, 'Batch no longer exists');
  if (batch.onHandMilli + delta < 0) return problem('quantity', 'Not enough stock in this batch');
  db.insert(stockMovements)
    .values({
      productId: batch.productId,
      batchId: batch.id,
      type: type as StockMovementType,
      quantityMilli: delta,
      employeeId,
      at: now,
      note,
    })
    .run();
  return { ok: true, batch: listBatches(db, { includeEmpty: true, batchId: batch.id })[0]! };
}

const MAX_TARGETS = 10;
const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Opens a pack: takes `quantityMilli` of the source product out of its batches (first-expiring-first-out, never from
 * an expired one) and puts the targets in, as one `repack_out` movement per source batch and one `repack_in` per
 * target batch, all sharing a repackage id. Each target batch keeps the lot number and expiry of the batch it came
 * from, and the cost of what was taken is split over the targets by retail value (quantity x price), so margins stay
 * right whatever the units. The two sides are typed independently, so a loss is just a smaller target quantity.
 */
export function repackageStock(
  db: AppDatabase,
  raw: unknown,
  employeeId: string | null = null,
  now = Date.now(),
): RepackageResult {
  const fail = (field: RepackageField | null, error: string): RepackageResult => ({
    ok: false,
    field,
    error,
  });
  const input = (raw ?? {}) as Partial<RepackageInput>;
  if (typeof input.productId !== 'string') return fail('source', 'Choose the product to open');
  if (!isMilli(input.quantityMilli)) return fail('quantity', 'Enter a valid quantity');
  const quantity = input.quantityMilli;
  const asked = Array.isArray(input.targets) ? input.targets : [];
  if (asked.length === 0) return fail('targets', 'Add what it is repackaged into');
  if (asked.length > MAX_TARGETS) return fail('targets', 'Too many products');
  const targets: { productId: string; quantityMilli: number; expiresAt: number | null }[] = [];
  for (const t of asked) {
    if (!t || typeof t.productId !== 'string')
      return fail('targets', 'Choose the product to repackage into');
    if (!isMilli(t.quantityMilli))
      return fail('targets', 'Enter a valid quantity for each product');
    const expiresAt =
      typeof t.expiresAt === 'number' && Number.isInteger(t.expiresAt) && t.expiresAt > 0
        ? t.expiresAt
        : null;
    targets.push({ productId: t.productId, quantityMilli: t.quantityMilli, expiresAt });
  }
  const ids = targets.map((t) => t.productId);
  if (ids.includes(input.productId)) return fail('targets', 'It cannot be repackaged into itself');
  if (new Set(ids).size !== ids.length) return fail('targets', 'A product is listed twice');
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim().slice(0, MAX_NOTE)
      : null;

  const found = db
    .select({
      id: products.id,
      name: products.name,
      tracking: products.tracking,
      price: products.price,
    })
    .from(products)
    .where(and(inArray(products.id, [input.productId, ...ids]), isNull(products.deletedAt)))
    .all();
  const byId = new Map(found.map((p) => [p.id, p]));
  const source = byId.get(input.productId);
  if (!source) return fail('source', 'Product no longer exists');
  if (source.tracking === 'none') return fail('source', 'Stock is not tracked for this product');
  for (const t of targets) {
    const p = byId.get(t.productId);
    if (!p) return fail('targets', 'A product no longer exists');
    if (p.tracking === 'none') return fail('targets', `Stock is not tracked for ${p.name}`);
  }

  // Take from the source's batches, soonest expiry first.
  const pieces: { batch: BatchRecord; take: number }[] = [];
  let remaining = quantity;
  for (const batch of listBatches(db).filter(
    (b) => b.productId === source.id && (b.expiresAt === null || b.expiresAt > now),
  )) {
    if (remaining <= 0) break;
    const take = Math.min(batch.onHandMilli, remaining);
    pieces.push({ batch, take });
    remaining -= take;
  }
  if (remaining > 0) return fail('quantity', 'Not enough stock to open');

  // Cost of what was taken (unknown if any of the batches has no cost), shared out by retail value.
  const totalCost = pieces.every((p) => p.batch.unitCost !== null)
    ? pieces.reduce((sum, p) => sum + (p.take * p.batch.unitCost!) / 1000, 0)
    : null;
  const weightOf = (t: { productId: string; quantityMilli: number }): number =>
    t.quantityMilli * byId.get(t.productId)!.price;
  const anyWeight = targets.some((t) => weightOf(t) > 0);
  const weight = (t: (typeof targets)[number]): number =>
    anyWeight ? weightOf(t) : t.quantityMilli;
  const totalWeight = targets.reduce((sum, t) => sum + weight(t), 0);

  // One batch of each target per source batch, quantity shared in proportion to what each source batch gave.
  const day = new Date(now);
  const fallbackLot = `REPACK-${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}`;
  const plan: {
    productId: string;
    batchNumber: string | null;
    expiresAt: number | null;
    unitCost: number | null;
    quantityMilli: number;
  }[] = [];
  for (const t of targets) {
    const p = byId.get(t.productId)!;
    const tracking = p.tracking as ProductTracking;
    const unitCost =
      totalCost === null
        ? null
        : Math.round((((totalCost * weight(t)) / totalWeight) * 1000) / t.quantityMilli);
    let left = t.quantityMilli;
    pieces.forEach((piece, i) => {
      const portion =
        i === pieces.length - 1 ? left : Math.floor((t.quantityMilli * piece.take) / quantity);
      left -= portion;
      if (portion <= 0) return;
      const batchNumber = tracksBatches(tracking) ? (piece.batch.batchNumber ?? fallbackLot) : null;
      const expiresAt = tracksExpiry(tracking) ? (piece.batch.expiresAt ?? t.expiresAt) : null;
      plan.push({
        productId: t.productId,
        batchNumber,
        expiresAt,
        unitCost,
        quantityMilli: portion,
      });
    });
  }
  for (const line of plan) {
    if (
      tracksExpiry(byId.get(line.productId)!.tracking as ProductTracking) &&
      line.expiresAt === null
    ) {
      return fail('targets', `Enter an expiry date for ${byId.get(line.productId)!.name}`);
    }
  }

  const repackageId = uuid7(now);
  // A problem found while writing throws, so the transaction rolls back (a returned value would commit it).
  class Rollback extends Error {
    constructor(readonly result: RepackageResult) {
      super('rollback');
    }
  }
  try {
    db.transaction((tx) => {
      for (const { batch, take } of pieces) {
        tx.insert(stockMovements)
          .values({
            productId: source.id,
            batchId: batch.id,
            type: 'repack_out',
            quantityMilli: -take,
            repackageId,
            employeeId,
            at: now,
            note,
          })
          .run();
      }
      for (const line of plan) {
        const same = tx
          .select()
          .from(productBatches)
          .where(
            and(
              eq(productBatches.productId, line.productId),
              line.batchNumber === null
                ? isNull(productBatches.batchNumber)
                : eq(productBatches.batchNumber, line.batchNumber),
            ),
          )
          .all()[0];
        let batchId: string;
        if (same) {
          if (line.expiresAt !== null && same.expiresAt !== line.expiresAt) {
            throw new Rollback(
              fail(
                'targets',
                `Batch ${line.batchNumber} of ${byId.get(line.productId)!.name} already has a different expiry date`,
              ),
            );
          }
          batchId = same.id;
          if (same.unitCost === null && line.unitCost !== null) {
            tx.update(productBatches)
              .set({ unitCost: line.unitCost })
              .where(eq(productBatches.id, batchId))
              .run();
          }
        } else {
          batchId = tx
            .insert(productBatches)
            .values({
              productId: line.productId,
              batchNumber: line.batchNumber,
              expiresAt: line.expiresAt,
              unitCost: line.unitCost,
              receivedAt: now,
            })
            .returning({ id: productBatches.id })
            .get().id;
        }
        tx.insert(stockMovements)
          .values({
            productId: line.productId,
            batchId,
            type: 'repack_in',
            quantityMilli: line.quantityMilli,
            repackageId,
            employeeId,
            at: now,
            note,
          })
          .run();
      }
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    throw error;
  }
  return { ok: true, repackageId };
}

export interface SaleAllocation {
  batchId: string;
  quantityMilli: number;
  unitCost: number | null;
}

/**
 * Takes `quantityMilli` of a product out of its batches for a sale line, first-expiring-first-out (no-expiry batches
 * last, then oldest received). Expired batches are never sold from. Writes the sale movements and returns where the
 * stock came from, the part that could not be covered (`shortfallMilli`) and the average cost per unit of what was
 * taken, to store on the order line. Products that do not track stock are ignored.
 */
export function allocateSale(
  db: AppDatabase,
  sale: {
    productId: string;
    orderLineId: string;
    quantityMilli: number;
    employeeId?: string | null;
    at?: number;
  },
): { allocations: SaleAllocation[]; shortfallMilli: number; unitCost: number | null } {
  const at = sale.at ?? Date.now();
  const [product] = db
    .select({ tracking: products.tracking })
    .from(products)
    .where(eq(products.id, sale.productId))
    .all();
  if (!product || product.tracking === 'none' || sale.quantityMilli <= 0) {
    return { allocations: [], shortfallMilli: 0, unitCost: null };
  }
  const batches = listBatches(db).filter(
    (b) => b.productId === sale.productId && (b.expiresAt === null || b.expiresAt > at),
  );
  let remaining = sale.quantityMilli;
  const allocations: SaleAllocation[] = [];
  db.transaction((tx) => {
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.onHandMilli, remaining);
      tx.insert(stockMovements)
        .values({
          productId: sale.productId,
          batchId: batch.id,
          type: 'sale',
          quantityMilli: -take,
          orderLineId: sale.orderLineId,
          employeeId: sale.employeeId ?? null,
          at,
        })
        .run();
      allocations.push({ batchId: batch.id, quantityMilli: take, unitCost: batch.unitCost });
      remaining -= take;
    }
  });
  const costed = allocations.filter((a) => a.unitCost !== null);
  const costedQty = costed.reduce((sum, a) => sum + a.quantityMilli, 0);
  const unitCost =
    costedQty > 0
      ? Math.round(costed.reduce((sum, a) => sum + a.unitCost! * a.quantityMilli, 0) / costedQty)
      : null;
  return { allocations, shortfallMilli: remaining, unitCost };
}

/**
 * Puts a sale line's stock back (a refund, or a void of the whole order) into the same batches it came from.
 * Does nothing if the line has no sale movements or has already been put back.
 */
export function restockSale(
  db: AppDatabase,
  orderLineId: string,
  type: Extract<StockMovementType, 'refund' | 'void'>,
  employeeId: string | null = null,
  at = Date.now(),
): number {
  const rows = db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.orderLineId, orderLineId))
    .all();
  if (rows.some((r) => r.type === 'refund' || r.type === 'void')) return 0;
  const sold = rows.filter((r) => r.type === 'sale');
  db.transaction((tx) => {
    for (const row of sold) {
      tx.insert(stockMovements)
        .values({
          productId: row.productId,
          batchId: row.batchId,
          type,
          quantityMilli: -row.quantityMilli,
          orderLineId,
          employeeId,
          at,
        })
        .run();
    }
  });
  return sold.length;
}

const DAY_MS = 86_400_000;
const MAX_ATTENTION = 8;
const MAX_LISTED = 8;
const RECENT_MOVEMENTS = 10;

/** Cents for `quantityMilli` thousandths of a unit at `cents` per unit. */
const worth = (quantityMilli: number, cents: number): number =>
  Math.round((quantityMilli * cents) / 1000);

/** The summary behind the Inventory overview page, computed from the live batches and the ledger. */
export function inventoryOverview(db: AppDatabase, now = Date.now()): InventoryOverview {
  const batches = listBatches(db);
  const costOf = (b: BatchRecord): number =>
    b.unitCost === null ? 0 : worth(b.onHandMilli, b.unitCost);

  const expired = batches.filter((b) => expiryState(b.expiresAt, now) === 'expired');
  const soon = batches.filter((b) => expiryState(b.expiresAt, now) === 'soon');
  const sum = (list: BatchRecord[]): number => list.reduce((total, b) => total + costOf(b), 0);

  const tracked = db.$client
    .prepare(
      `SELECT p.id AS id, p.name AS name, COALESCE(SUM(m.quantity_milli), 0) AS onHand
         FROM products p
         LEFT JOIN stock_movements m ON m.product_id = p.id
        WHERE p.deleted_at IS NULL AND p.tracking <> 'none'
        GROUP BY p.id`,
    )
    .all() as { id: string; name: string; onHand: number }[];
  const emptyProducts = tracked.filter((p) => p.onHand <= 0);
  const outOfStock = emptyProducts
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_LISTED)
    .map(({ id, name }) => ({ id, name }));

  const waste = db.$client
    .prepare(
      `SELECT COUNT(*) AS entries, COALESCE(SUM(-m.quantity_milli * COALESCE(b.unit_cost, 0) / 1000.0), 0) AS valueCost
         FROM stock_movements m JOIN product_batches b ON b.id = m.batch_id
        WHERE m.type IN ('waste', 'expired') AND m.at >= ?`,
    )
    .get(now - 30 * DAY_MS) as { entries: number; valueCost: number };

  const recent = db.$client
    .prepare(
      `SELECT m.id AS id, m.at AS at, m.type AS type, p.name AS productName, p.unit AS unit,
              b.batch_number AS batchNumber, m.quantity_milli AS quantityMilli, m.note AS note
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN product_batches b ON b.id = m.batch_id
        ORDER BY m.at DESC, m.rowid DESC
        LIMIT ?`,
    )
    .all(RECENT_MOVEMENTS) as MovementRecord[];

  return {
    trackedProducts: tracked.length,
    outOfStockCount: emptyProducts.length,
    outOfStockProducts: outOfStock,
    stockValueCost: sum(batches),
    stockValueRetail: batches.reduce((total, b) => total + worth(b.onHandMilli, b.unitPrice), 0),
    expired: { batches: expired.length, valueCost: sum(expired) },
    expiringSoon: { batches: soon.length, valueCost: sum(soon) },
    wasteLast30Days: { entries: waste.entries, valueCost: Math.round(waste.valueCost) },
    // listBatches is already soonest-expiry first, so expired batches lead.
    attention: [...expired, ...soon].slice(0, MAX_ATTENTION),
    recentMovements: recent,
  };
}
