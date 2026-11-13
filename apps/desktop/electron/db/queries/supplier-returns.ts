import type { ReturnToSupplierField, ReturnToSupplierInput, ReturnToSupplierResult, SupplierReturnRecord } from '@micropos/core';
import { currentActorId } from '../../auth/actor';
import type { AppDatabase } from '../index';
import { stockMovements, supplierReturns } from '../schema';
import { listBatches } from './inventory';

const MAX_CENTS = 100_000_000_00;
const MAX_NOTE = 200;

/** Cents the supplier has refunded against an order for returned stock (it reduces what is owed); `p` is the order. */
export const CREDITED = `COALESCE((SELECT SUM(r.credited_amount) FROM supplier_returns r WHERE r.purchase_order_id = p.id), 0)`;

const RETURN_SELECT = `SELECT r.id AS id, r.at AS at, s.name AS supplierName, po.po_number AS purchaseNumber,
              r.product_id AS productId, pr.name AS productName, pr.unit AS unit, b.batch_number AS batchNumber,
              r.quantity_milli AS quantityMilli, r.refund_amount AS refundAmount, r.credited_amount AS creditedAmount,
              r.note AS note, e.name AS employeeName
         FROM supplier_returns r
         JOIN suppliers s ON s.id = r.supplier_id
         JOIN products pr ON pr.id = r.product_id
         JOIN product_batches b ON b.id = r.batch_id
         LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id
         LEFT JOIN employees e ON e.id = r.employee_id`;

/** The returns made from one purchase order, newest first. */
export const returnsOfPurchase = (db: AppDatabase, purchaseOrderId: string): SupplierReturnRecord[] =>
  db.$client.prepare(`${RETURN_SELECT} WHERE r.purchase_order_id = ? ORDER BY r.at DESC, r.rowid DESC`).all(purchaseOrderId) as SupplierReturnRecord[];

const fail = (field: ReturnToSupplierField | null, error: string): ReturnToSupplierResult => ({ ok: false, field, error });

/**
 * Sends stock back to a supplier. The batch loses `quantityMilli` (a `supplier_return` movement) and the return is
 * recorded with what the supplier refunds. The refund first reduces what is still owed on the purchase order the
 * batch was received on (`creditedAmount`); anything beyond that, or any refund on stock that did not come through an
 * order, is recorded as refunded and nothing else (there is no cash register to reconcile). A refund cannot be more
 * than the cost of what goes back, when that cost is known.
 */
export function returnToSupplier(db: AppDatabase, raw: unknown, employeeId: string | null = currentActorId(), now = Date.now()): ReturnToSupplierResult {
  const input = (raw ?? {}) as Partial<ReturnToSupplierInput>;
  if (typeof input.batchId !== 'string') return fail(null, 'Batch no longer exists');
  const quantity = input.quantityMilli;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99_999_000) return fail('quantity', 'Enter a valid quantity');
  const refund = input.refundAmount ?? 0;
  if (typeof refund !== 'number' || !Number.isInteger(refund) || refund < 0 || refund > MAX_CENTS) return fail('refundAmount', 'Enter a valid refund');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;

  return db.transaction((tx) => {
    const [batch] = listBatches(db, { includeEmpty: true, batchId: input.batchId });
    if (!batch) return fail(null, 'Batch no longer exists');
    if (quantity > batch.onHandMilli) return fail('quantity', 'Not enough stock in this batch');
    if (batch.unitCost !== null && refund > Math.round((quantity * batch.unitCost) / 1000)) return fail('refundAmount', 'More than the cost of what goes back');

    // The supplier: the order the batch came on names it; stock that did not come on an order needs one chosen.
    let supplierId = batch.supplierId;
    if (!supplierId) {
      if (typeof input.supplierId !== 'string') return fail('supplier', 'Choose the supplier');
      const found = db.$client.prepare('SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL').get(input.supplierId) as { id: string } | undefined;
      if (!found) return fail('supplier', 'Choose the supplier');
      supplierId = found.id;
    }
    const owed = batch.purchaseId
      ? ((db.$client
          .prepare(
            `SELECT CASE WHEN p.status = 'cancelled' THEN 0 ELSE p.total - COALESCE((SELECT SUM(x.amount) FROM purchase_payments x WHERE x.purchase_order_id = p.id), 0) - ${CREDITED} END AS owed
               FROM purchase_orders p WHERE p.id = ?`,
          )
          .get(batch.purchaseId) as { owed: number }).owed)
      : 0;
    const credited = Math.min(refund, Math.max(0, owed));

    const movement = tx
      .insert(stockMovements)
      .values({ productId: batch.productId, batchId: batch.id, type: 'supplier_return', quantityMilli: -quantity, employeeId, at: now, note: `Returned to ${batch.supplierName ?? 'supplier'}${note ? `: ${note}` : ''}` })
      .returning({ id: stockMovements.id })
      .get();
    const saved = tx
      .insert(supplierReturns)
      .values({ supplierId, purchaseOrderId: batch.purchaseId, productId: batch.productId, batchId: batch.id, stockMovementId: movement.id, quantityMilli: quantity, refundAmount: refund, creditedAmount: credited, note, employeeId, at: now })
      .returning({ id: supplierReturns.id })
      .get();
    const record = (db.$client.prepare(`${RETURN_SELECT} WHERE r.id = ?`).get(saved.id) as SupplierReturnRecord);
    return { ok: true as const, return: record };
  });
}
