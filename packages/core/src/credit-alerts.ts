import { type InterestEntry, unpaidByOrder } from './credit-interest.js';
import type { Money } from './index.js';

/**
 * When a customer's credit needs attention (counted on the Customers link in the navigation). Either limit can be
 * off (null). Stored once for the whole shop.
 */
export interface CreditAlertSettings {
  /** Cents: a customer who owes more than this is flagged. */
  amount: Money | null;
  /** Days: a customer whose oldest unpaid sale is older than this is flagged. */
  days: number | null;
}

export const DEFAULT_CREDIT_ALERTS: CreditAlertSettings = { amount: 500_000, days: 30 };
export const MAX_ALERT_AMOUNT = 100_000_000_00;
export const MAX_ALERT_DAYS = 3650;

export const isAlertAmount = (value: unknown): value is Money => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ALERT_AMOUNT;
export const isAlertDays = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ALERT_DAYS;

const DAY_MS = 86_400_000;

/**
 * Whether a customer is over the amount, or has a sale unpaid for longer than the days. The age is the oldest sale
 * with something still unpaid (payments are applied oldest first, as for interest).
 */
export function creditAlert(entries: readonly InterestEntry[], settings: CreditAlertSettings, now: number): { overAmount: boolean; overdue: boolean } {
  let balance = 0;
  const chargedAt = new Map<string, number>();
  for (const e of entries) {
    if (e.at > now) continue;
    balance += e.amount;
    if (e.type === 'charge' && e.orderId && !chargedAt.has(e.orderId)) chargedAt.set(e.orderId, e.at);
  }
  const overAmount = settings.amount !== null && balance > settings.amount;
  let overdue = false;
  if (settings.days !== null && balance > 0) {
    for (const [orderId, unpaid] of unpaidByOrder(entries, now, 0)) {
      if (unpaid > 0) {
        overdue = now - chargedAt.get(orderId)! > settings.days * DAY_MS;
        break; // the oldest unpaid sale decides
      }
    }
  }
  return { overAmount, overdue };
}
