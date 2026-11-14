import { type ChartBar, chartBuckets, type DashboardData, dayOf, dayRange, daysInRange, granularityFor, MAX_DASHBOARD_DAYS, type PeriodTotals, previousRange } from '@micropos/core';
import type { AppDatabase } from '../index';
import { listCustomers } from './customers';
import { inventoryOverview } from './inventory';
import { listPurchases, purchaseConcerns } from './purchases';
import { salesReport } from './reports';

const TOP_ITEMS = 5;
const TOP_OWING = 5;

/**
 * The figures for the Dashboard page over `from` to `to` (local days, inclusive): net sales, how many, the average,
 * discounts, refunds and voids, optionally against the period of equal length just before; a chart that is by day, week
 * or month depending on how long the period is; what was taken by each payment method; the best sellers; and, as of now,
 * what customers and suppliers are owed and the stock overview. The sales figures are `salesReport`'s own, so the
 * dashboard and Reports agree. Null when the days are not real dates in order, or are more than `MAX_DASHBOARD_DAYS`.
 */
export function dashboard(db: AppDatabase, rawQuery: unknown, now = Date.now()): DashboardData | null {
  const q = rawQuery as { from?: unknown; to?: unknown; compare?: unknown } | null;
  if (typeof q?.from !== 'string' || typeof q.to !== 'string' || !dayRange(q.from, q.to)) return null;
  const query = { from: q.from, to: q.to, compare: q.compare === true };
  const days = daysInRange(query.from, query.to);
  if (days > MAX_DASHBOARD_DAYS) return null;

  const totals = (from: string, to: string): { totals: PeriodTotals; report: NonNullable<ReturnType<typeof salesReport>> } => {
    const report = salesReport(db, from, to)!;
    return {
      report,
      totals: { count: report.sales.count, net: report.netAfterRefunds, discounts: report.sales.discounts, refunded: report.refunds.total === 0 ? 0 : -report.refunds.total, voided: report.voids.count },
    };
  };
  const current = totals(query.from, query.to);
  const before = query.compare ? previousRange(query.from, query.to) : null;
  const previous = before ? { ...totals(before.from, before.to).totals, ...before } : null;

  // The chart in one query: net = every completed or refunded order's total (refund orders are negative), by the day it was
  // completed; the sale count leaves refund orders out. Each order goes in the bar that holds its day.
  const granularity = granularityFor(days);
  const buckets = chartBuckets(query.from, query.to, granularity);
  const chart: ChartBar[] = buckets.map((b) => ({ ...b, net: 0, count: 0 }));
  const barOfDay = new Map<string, ChartBar>();
  for (const bar of chart) for (let d = bar.from; d <= bar.to; d = shiftOneDay(d)) barOfDay.set(d, bar);
  const range = dayRange(query.from, query.to)!;
  const rows = db.$client
    .prepare(
      `SELECT completed_at AS at, total, refund_of_order_id IS NULL AS isSale FROM orders
        WHERE completed_at >= ? AND completed_at < ? AND status IN ('completed', 'refunded')`,
    )
    .all(range.from, range.to) as { at: number; total: number; isSale: number }[];
  for (const r of rows) {
    const bar = barOfDay.get(dayOf(r.at));
    if (!bar) continue;
    bar.net += r.total;
    bar.count += r.isSale;
  }

  const owing = listCustomers(db)
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const purchases = listPurchases(db).filter((p) => p.status !== 'cancelled' && p.owed > 0);
  const overdue = purchaseConcerns(db, now).filter((c) => c.overdueOwed !== null);

  return {
    generatedAt: now,
    query,
    current: current.totals,
    previous,
    granularity,
    chart,
    byMethod: current.report.byMethod,
    topItems: current.report.items.slice(0, TOP_ITEMS),
    customersOwing: {
      total: owing.reduce((sum, c) => sum + c.balance, 0),
      count: owing.length,
      top: owing.slice(0, TOP_OWING).map((c) => ({ id: c.id, name: c.name, balance: c.balance })),
    },
    suppliersOwed: {
      total: purchases.reduce((sum, p) => sum + p.owed, 0),
      orders: purchases.length,
      overdueOrders: overdue.length,
      overdue: overdue.reduce((sum, c) => sum + (c.overdueOwed ?? 0), 0),
    },
    inventory: inventoryOverview(db, now),
  };
}

/** The day after `day` (local, a clock change does not skip or repeat one). */
function shiftOneDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return dayOf(new Date(y, m - 1, d + 1).getTime());
}
