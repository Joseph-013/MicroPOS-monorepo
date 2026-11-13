import type { AppDatabase } from '../index';

/** What has arrived of an order line so far: the sum of the receipts made against it. */
export function receivedOfLine(db: AppDatabase, lineId: string): number {
  const row = db.$client
    .prepare(`SELECT COALESCE(SUM(quantity_milli), 0) AS total FROM stock_movements WHERE purchase_order_line_id = ? AND type = 'receive'`)
    .get(lineId) as { total: number };
  return row.total;
}

/**
 * Marks an order received once everything it ordered of the products that track stock has arrived. Products that
 * track no stock never produce a receipt, so they do not hold it back (an order of only those is received by hand).
 * Read and written on the open connection, so it works inside a transaction. Returns true when it changed the order.
 */
export function settlePurchase(db: AppDatabase, purchaseOrderId: string, now: number): boolean {
  const lines = db.$client
    .prepare(
      `SELECT l.quantity_milli AS quantity,
              COALESCE((SELECT SUM(m.quantity_milli) FROM stock_movements m WHERE m.purchase_order_line_id = l.id AND m.type = 'receive'), 0) AS received
         FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
        WHERE l.purchase_order_id = ? AND p.tracking <> 'none'`,
    )
    .all(purchaseOrderId) as { quantity: number; received: number }[];
  if (!lines.length || lines.some((l) => l.received < l.quantity)) return false;
  const result = db.$client
    .prepare(`UPDATE purchase_orders SET status = 'received', received_at = ?, updated_at = ? WHERE id = ? AND status = 'ordered'`)
    .run(now, now, purchaseOrderId);
  return result.changes > 0;
}
