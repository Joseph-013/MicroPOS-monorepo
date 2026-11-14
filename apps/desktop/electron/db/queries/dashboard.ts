import { type DashboardData, dayOf, dayRange, type PeriodSales } from '@micropos/core';
import type { AppDatabase } from '../index';
import { listCustomers } from './customers';
import { inventoryOverview } from './inventory';
import { listPurchases, purchaseConcerns } from './purchases';
import { salesReport } from './reports';

const DAILY_DAYS = 14;
const TOP_ITEMS = 5;
const TOP_OWING = 5;

/** `day` moved by whole local days (a clock change does not skip or repeat a day). */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return dayOf(new Date(y, m - 1, d + n).getTime());
}

/**
 * The figures for the Dashboard page: sales today, yesterday and over 7 and 30 days, a chart of the last 14 days, what
 * is taken by each payment method, the best sellers, what customers and suppliers are owed, and the stock overview.
 * Net sales and the day-by-day chart are `salesReport`'s own numbers, so the dashboard and Reports agree.
 */
export function dashboard(db: AppDatabase, now = Date.now()): DashboardData {
  const today = dayOf(now);
  const report = (from: string, to: string) => salesReport(db, from, to)!;
  const period = (from: string, to: string): PeriodSales => {
    const r = report(from, to);
    return { count: r.sales.count, net: r.netAfterRefunds };
  };

  // One query for the chart instead of a full report per day: net = every completed or refunded order's total (refund
  // orders are negative), counted by the day it was completed; the sale count leaves refund orders out.
  const range = dayRange(addDays(today, 1 - DAILY_DAYS), today)!;
  const rows = db.$client
    .prepare(
      `SELECT completed_at AS at, total, refund_of_order_id IS NULL AS isSale FROM orders
        WHERE completed_at >= ? AND completed_at < ? AND status IN ('completed', 'refunded')`,
    )
    .all(range.from, range.to) as { at: number; total: number; isSale: number }[];
  const byDay = new Map<string, { net: number; count: number }>();
  for (const r of rows) {
    const entry = byDay.get(dayOf(r.at)) ?? { net: 0, count: 0 };
    entry.net += r.total;
    entry.count += r.isSale;
    byDay.set(dayOf(r.at), entry);
  }
  const daily = Array.from({ length: DAILY_DAYS }, (_, i) => {
    const day = addDays(today, i + 1 - DAILY_DAYS);
    return { day, net: byDay.get(day)?.net ?? 0, count: byDay.get(day)?.count ?? 0 };
  });

  const last7 = report(addDays(today, -6), today);
  const last30 = report(addDays(today, -29), today);

  const owing = listCustomers(db)
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const purchases = listPurchases(db).filter((p) => p.status !== 'cancelled' && p.owed > 0);
  const overdue = purchaseConcerns(db, now).filter((c) => c.overdueOwed !== null);

  return {
    generatedAt: now,
    today: period(today, today),
    yesterday: period(addDays(today, -1), addDays(today, -1)),
    last7: { count: last7.sales.count, net: last7.netAfterRefunds },
    last30: { count: last30.sales.count, net: last30.netAfterRefunds },
    daily,
    byMethod: last7.byMethod,
    topItems: last30.items.slice(0, TOP_ITEMS),
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
