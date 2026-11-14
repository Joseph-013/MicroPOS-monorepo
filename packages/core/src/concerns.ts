import type { PurchaseSummary } from './purchasing.js';
import type { Money } from './index.js';

/** The parts of the data a badge can depend on. The main process announces which changed. */
export const DATA_DOMAINS = ['customers', 'stock', 'purchases', 'sales'] as const;
export type DataDomain = (typeof DATA_DOMAINS)[number];

/**
 * Things that need attention on the Inventory and Purchases pages. The same lists feed the number on the nav rail,
 * the button beside the page title and the dialog it opens.
 */

/** Worst first: stock that must not be sold, then nothing left, then running low, then about to expire. */
export const STOCK_CONCERN_KINDS = ['expired', 'out', 'low', 'expiring'] as const;
export type StockConcernKind = (typeof STOCK_CONCERN_KINDS)[number];
export const STOCK_CONCERN_LABELS: Record<StockConcernKind, string> = { expired: 'Expired', out: 'Out of stock', low: 'Low stock', expiring: 'Expiring soon' };

/** One batch past or near its expiry (kind `expired` / `expiring`), or one product out of stock or at its critical level (`out` / `low`). */
export interface StockConcern {
  kind: StockConcernKind;
  productId: string;
  productName: string;
  unit: string;
  /** The batch, for expiry concerns. */
  batchNumber: string | null;
  expiresAt: number | null;
  /** Thousandths of the unit left (in the batch for expiry concerns, in all for the others). */
  onHandMilli: number;
  /** The level that makes stock low, for `low`. */
  criticalLevelMilli: number | null;
}

/** Why a purchase order needs attention. */
export interface PurchaseConcern {
  purchase: PurchaseSummary;
  /** When it was expected, if it is late (still to arrive, past the expected date). */
  lateSince: number | null;
  /** What is owed, if payment is overdue. */
  overdueOwed: Money | null;
}

/** A purchase order that arrives late or is paid late, or null when it is fine. A cancelled or received order has no late delivery. */
export function purchaseConcern(purchase: PurchaseSummary, now: number): PurchaseConcern | null {
  const lateSince = purchase.status === 'ordered' && purchase.expectedAt !== null && purchase.expectedAt < now ? purchase.expectedAt : null;
  const overdueOwed = purchase.owed > 0 && purchase.dueAt !== null && purchase.dueAt < now ? purchase.owed : null;
  return lateSince === null && overdueOwed === null ? null : { purchase, lateSince, overdueOwed };
}

/**
 * The next moment (epoch ms, after `now`) at which this order starts to be a concern with nothing being written:
 * when it becomes late, or when its payment becomes overdue. Null when neither is still to come.
 */
export function purchaseConcernDueAt(purchase: PurchaseSummary, now: number): number | null {
  const candidates = [
    purchase.status === 'ordered' && purchase.expectedAt !== null ? purchase.expectedAt + 1 : null,
    purchase.owed > 0 && purchase.dueAt !== null ? purchase.dueAt + 1 : null,
  ].filter((t): t is number => t !== null && t > now);
  return candidates.length ? Math.min(...candidates) : null;
}
