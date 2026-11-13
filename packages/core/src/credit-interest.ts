import type { Money } from './index.js';

/**
 * Optional interest on a customer's credit. Not every customer has it: it is switched on per customer.
 * - `order`: charged on each credit sale's own unpaid amount (not on the total owed, and not on earlier interest).
 * - `total`: charged on everything the customer owes at the time (earlier interest included).
 */
export const INTEREST_MODES = ['order', 'total'] as const;
export type InterestMode = (typeof INTEREST_MODES)[number];

export const INTEREST_MODE_LABELS: Record<InterestMode, string> = { order: 'Per sales order', total: 'On total credit' };

/** Rates are whole basis points per month (300 = 3%), so interest stays integer maths. */
export const MAX_INTEREST_RATE_BP = 10_000;

/** What new customers start from when interest is switched on; each customer keeps their own copy. */
export interface InterestDefaults {
  /** Monthly rate for "per sales order" interest, in basis points. */
  orderRateBp: number;
  /** Monthly rate for "on total credit" interest, in basis points. */
  totalRateBp: number;
}
export const DEFAULT_INTEREST_DEFAULTS: InterestDefaults = { orderRateBp: 300, totalRateBp: 300 };

export const isRateBp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INTEREST_RATE_BP;

/** "3" or "2.5" or "0.25": a rate as percent text. */
export const formatRate = (bp: number): string => String(bp / 100);

/** Percent text ("2.5") to basis points; null when it is not a rate between 0.01% and 100%. */
export function parseRate(text: string): number | null {
  const clean = text.trim().replace(/%$/, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return isRateBp(bp) ? bp : null;
}

/** The interest on `base` cents at `rateBp` for one period, rounded to a whole cent. */
export const interestOn = (base: Money, rateBp: number): Money => Math.round((base * rateBp) / 10_000);

/** The first interest period of a credit sale is shortened to this many days; after it periods are a month. */
export const FIRST_PERIOD_DAYS = 15;
const DAY_MS = 86_400_000;

/** `ms` moved forward by whole calendar months (UTC), clamped to the end of a shorter month (Jan 31 + 1 = Feb 28). */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

/** When the nth (1-based) interest on a credit sale is due: 15 days after the sale, then every month after that. */
export const orderInterestDueAt = (chargedAt: number, n: number): number => addMonths(chargedAt + FIRST_PERIOD_DAYS * DAY_MS, n - 1);

/** When the nth (1-based) interest on the total credit is due: every month from when interest was switched on. */
export const totalInterestDueAt = (startedAt: number, n: number): number => addMonths(startedAt, n);

/** The ledger facts interest needs. Entries are in the order they happened. */
export interface InterestEntry {
  type: 'charge' | 'payment' | 'refund' | 'void' | 'adjustment' | 'interest';
  amount: Money;
  orderId: string | null;
  at: number;
}

/**
 * What is still unpaid of each credit sale's own charge at time `at`. Refunds and voids take away from their sale;
 * payments go to the oldest sale first (the ledger keeps no per-sale allocation, so this is how it is worked out).
 * Interest entries are ignored: per-sale interest never compounds. Sales charged before `since` are left out.
 */
export function unpaidByOrder(entries: readonly InterestEntry[], at: number, since: number): Map<string, Money> {
  const unpaid = new Map<string, Money>(); // insertion order = oldest sale first
  for (const e of entries) {
    if (e.at > at) continue;
    if (e.type === 'charge' && e.orderId && e.at >= since) unpaid.set(e.orderId, (unpaid.get(e.orderId) ?? 0) + e.amount);
    else if ((e.type === 'refund' || e.type === 'void') && e.orderId && unpaid.has(e.orderId)) {
      unpaid.set(e.orderId, Math.max(0, unpaid.get(e.orderId)! + e.amount));
    } else if (e.type === 'payment') {
      let left = -e.amount;
      for (const [orderId, owed] of unpaid) {
        if (left <= 0) break;
        const used = Math.min(owed, left);
        unpaid.set(orderId, owed - used);
        left -= used;
      }
    }
  }
  return unpaid;
}

/** What the customer owes in all at time `at`. */
export const balanceAt = (entries: readonly InterestEntry[], at: number): Money => entries.reduce((sum, e) => (e.at <= at ? sum + e.amount : sum), 0);
