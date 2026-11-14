import type { Money } from './index.js';
import type { InventoryOverview } from './inventory.js';
import { dayOf, type ItemSold, type MethodTotal } from './reports.js';

/** The periods the Dashboard can show. `custom` uses the two dates the person picked. */
export const DASHBOARD_PERIODS = ['today', 'yesterday', '7d', '30d', 'month', 'lastMonth', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  lastMonth: 'Last month',
  custom: 'Custom range',
};
export const isDashboardPeriod = (value: unknown): value is DashboardPeriod => (DASHBOARD_PERIODS as readonly unknown[]).includes(value);

/** What the Dashboard asks for: whole local days `from` to `to` (`YYYY-MM-DD`, inclusive), and whether to compare with the period just before. */
export interface DashboardQuery {
  from: string;
  to: string;
  compare: boolean;
}
/** The longest period the Dashboard will work out (days). */
export const MAX_DASHBOARD_DAYS = 1830;

/** What a stretch of days sold. Money is in cents. */
export interface PeriodTotals {
  /** Sales rung up (refund orders and voided sales are not counted). */
  count: number;
  /** After refunds. */
  net: Money;
  discounts: Money;
  /** Refunded, as a positive amount. */
  refunded: Money;
  voided: number;
}

/** One bar of the chart: net sales over its days (`from` to `to` inclusive). */
export interface ChartBar {
  from: string;
  to: string;
  net: Money;
  count: number;
}
export type ChartGranularity = 'day' | 'week' | 'month';

/** The numbers behind the Dashboard page, as of `generatedAt`. */
export interface DashboardData {
  generatedAt: number;
  query: DashboardQuery;
  current: PeriodTotals;
  /** The period of equal length just before, when comparing. */
  previous: (PeriodTotals & { from: string; to: string }) | null;
  granularity: ChartGranularity;
  chart: ChartBar[];
  /** What was taken by each payment method in the period. */
  byMethod: MethodTotal[];
  /** The best sellers of the period by money (at most 5). */
  topItems: ItemSold[];
  /** What customers owe on credit now, and who owes most (at most 5). */
  customersOwing: { total: Money; count: number; top: { id: string; name: string; balance: Money }[] };
  /** What is still owed to suppliers on purchase orders now, and how much of it is overdue. */
  suppliersOwed: { total: Money; orders: number; overdueOrders: number; overdue: Money };
  inventory: InventoryOverview;
}

// --- periods and chart bars (whole local days as `YYYY-MM-DD`) ---

const DAY_MS = 86_400_000;
const parts = (day: string): [number, number, number] => day.split('-').map(Number) as [number, number, number];
/** `day` moved by whole days (a clock change does not skip or repeat one). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return dayOf(new Date(y, m - 1, d + n).getTime());
}
/** How many days `from` to `to` cover, both included. */
export function daysInRange(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS) + 1;
}

/** The days a period covers, counting back from `today`. `custom` takes the picked dates (today when there are none). */
export function periodRange(period: DashboardPeriod, today: string, custom?: { from: string; to: string }): { from: string; to: string } {
  const [y, m] = parts(today);
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
    case '7d':
      return { from: shiftDay(today, -6), to: today };
    case '30d':
      return { from: shiftDay(today, -29), to: today };
    case 'month':
      return { from: dayOf(new Date(y, m - 1, 1).getTime()), to: today };
    case 'lastMonth':
      return { from: dayOf(new Date(y, m - 2, 1).getTime()), to: dayOf(new Date(y, m - 1, 0).getTime()) };
    case 'custom':
      return custom ?? { from: today, to: today };
  }
}

/** The period of equal length just before `from` to `to`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = daysInRange(from, to);
  return { from: shiftDay(from, -days), to: shiftDay(from, -1) };
}

/** Days for a bar, weeks for a month or so to half a year, months beyond that: a chart never has more than about 31 bars. */
export const granularityFor = (days: number): ChartGranularity => (days <= 31 ? 'day' : days <= 183 ? 'week' : 'month');

/** The bars covering `from` to `to`: single days, weeks (Monday to Sunday) or calendar months, the first and last clipped to the period. */
export function chartBuckets(from: string, to: string, granularity: ChartGranularity): { from: string; to: string }[] {
  const buckets: { from: string; to: string }[] = [];
  const dayOfWeek = (day: string): number => {
    const [y, m, d] = parts(day);
    return (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday 0 ... Sunday 6
  };
  const monthEnd = (day: string): string => {
    const [y, m] = parts(day);
    return dayOf(new Date(y, m, 0).getTime());
  };
  for (let start = from; start <= to; ) {
    const natural = granularity === 'day' ? start : granularity === 'week' ? shiftDay(start, 6 - dayOfWeek(start)) : monthEnd(start);
    const end = natural < to ? natural : to;
    buckets.push({ from: start, to: end });
    start = shiftDay(end, 1);
  }
  return buckets;
}
