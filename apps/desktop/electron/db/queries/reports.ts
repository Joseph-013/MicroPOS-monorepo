import { dayRange, type ItemSold, type MethodTotal, type OrderPaymentMethod, PAYMENT_METHOD_ORDER, type SalesReport } from '@micropos/core';
import type { AppDatabase } from '../index';

const sortedMethods = (totals: Map<string, number>): MethodTotal[] =>
  [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([method, amount]) => ({ method: method as OrderPaymentMethod, amount }))
    .sort((a, b) => PAYMENT_METHOD_ORDER.indexOf(a.method) - PAYMENT_METHOD_ORDER.indexOf(b.method));

/**
 * The sales summary for the local days `from` to `to` inclusive (`YYYY-MM-DD`), or null when they are not dates in order:
 * - sales: orders completed in the period that were not voided; refunds (refund orders) are counted apart;
 * - voids: orders voided in the period, whenever they were sold (their payments come off the methods then);
 * - by method: payments in the period (refunds are negative) less the payments of orders voided in it;
 * - credit: what went on and came off customers' accounts, and what they paid back, by method;
 * - items: lines of those orders added up by name (refund lines are negative, so they net out).
 */
export function salesReport(db: AppDatabase, fromDay: unknown, toDay: unknown): SalesReport | null {
  if (typeof fromDay !== 'string' || typeof toDay !== 'string') return null;
  const range = dayRange(fromDay, toDay);
  if (!range) return null;
  const { from, to } = range;
  const one = <T>(sql: string, ...params: unknown[]): T => db.$client.prepare(sql).get(...params) as T;
  const all = <T>(sql: string, ...params: unknown[]): T[] => db.$client.prepare(sql).all(...params) as T[];

  const sales = one<{ count: number; gross: number; discounts: number; net: number }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal), 0) AS gross, COALESCE(SUM(discount_total), 0) AS discounts, COALESCE(SUM(total), 0) AS net
       FROM orders WHERE completed_at >= ? AND completed_at < ? AND refund_of_order_id IS NULL AND status IN ('completed', 'refunded')`,
    from,
    to,
  );
  const refunds = one<{ count: number; total: number }>(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM orders WHERE completed_at >= ? AND completed_at < ? AND refund_of_order_id IS NOT NULL AND status = 'completed'",
    from,
    to,
  );
  const voids = one<{ count: number; total: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'voided' AND updated_at >= ? AND updated_at < ?", from, to);

  const methods = new Map<string, number>();
  for (const r of all<{ method: string; amount: number }>('SELECT method, SUM(amount) AS amount FROM payments WHERE created_at >= ? AND created_at < ? GROUP BY method', from, to)) methods.set(r.method, r.amount);
  for (const r of all<{ method: string; amount: number }>(
    `SELECT p.method AS method, SUM(p.amount) AS amount FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.amount > 0 AND o.status = 'voided' AND o.updated_at >= ? AND o.updated_at < ? GROUP BY p.method`,
    from,
    to,
  )) methods.set(r.method, (methods.get(r.method) ?? 0) - r.amount);

  const received = new Map<string, number>();
  for (const r of all<{ method: string; amount: number }>("SELECT method, -SUM(amount) AS amount FROM customer_ledger WHERE type = 'payment' AND method IS NOT NULL AND at >= ? AND at < ? GROUP BY method", from, to)) received.set(r.method, r.amount);
  const ledger = one<{ given: number; interest: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('charge', 'refund', 'void') THEN amount END), 0) AS given,
            COALESCE(SUM(CASE WHEN type = 'interest' THEN amount END), 0) AS interest
       FROM customer_ledger WHERE at >= ? AND at < ?`,
    from,
    to,
  );

  const items = all<ItemSold>(
    `SELECT l.name AS name, p.unit AS unit, SUM(l.quantity_milli) AS quantityMilli, SUM(l.line_total) AS total
       FROM order_lines l JOIN orders o ON o.id = l.order_id LEFT JOIN products p ON p.id = l.product_id
      WHERE o.completed_at >= ? AND o.completed_at < ? AND o.status IN ('completed', 'refunded')
      GROUP BY l.name, p.unit HAVING SUM(l.quantity_milli) <> 0 OR SUM(l.line_total) <> 0 ORDER BY total DESC, l.name`,
    from,
    to,
  );

  return {
    from: fromDay,
    to: toDay,
    sales,
    voids,
    refunds,
    netAfterRefunds: sales.net + refunds.total,
    byMethod: sortedMethods(methods),
    credit: { given: ledger.given, interest: ledger.interest, paymentsReceived: sortedMethods(received) },
    items,
  };
}
