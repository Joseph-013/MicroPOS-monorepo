import type { Money } from './index.js';
import type { InventoryOverview } from './inventory.js';
import type { ItemSold, MethodTotal } from './reports.js';

/** What a stretch of days sold: sales rung up, and the money after refunds. */
export interface PeriodSales {
  count: number;
  net: Money;
}

/** The numbers behind the Dashboard page, as of `generatedAt`. Money is in cents. */
export interface DashboardData {
  generatedAt: number;
  today: PeriodSales;
  yesterday: PeriodSales;
  /** The last 7 days, today included. */
  last7: PeriodSales;
  /** The last 30 days, today included. */
  last30: PeriodSales;
  /** Net sales of each of the last 14 days (local days, oldest first), for the chart. */
  daily: { day: string; net: Money; count: number }[];
  /** What was taken by each payment method in the last 7 days. */
  byMethod: MethodTotal[];
  /** The best sellers of the last 30 days by money (at most 5). */
  topItems: ItemSold[];
  /** What customers owe on credit, and who owes most (at most 5). */
  customersOwing: { total: Money; count: number; top: { id: string; name: string; balance: Money }[] };
  /** What is still owed to suppliers on purchase orders, and how much of it is overdue. */
  suppliersOwed: { total: Money; orders: number; overdueOrders: number; overdue: Money };
  inventory: InventoryOverview;
}
