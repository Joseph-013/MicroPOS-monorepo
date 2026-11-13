import {
  DEFAULT_INTEREST_DEFAULTS,
  type InterestDefaults,
  type InterestEntry,
  type InterestMode,
  balanceAt,
  interestOn,
  isRateBp,
  orderInterestDueAt,
  totalInterestDueAt,
  unpaidByOrder,
} from '@micropos/core';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../index';
import { customerLedger, settings } from '../schema';

const DEFAULTS_KEY = 'customerInterestDefaults';

/** The rates a customer's interest starts from (the factory values until someone saves their own). */
export function getInterestDefaults(db: AppDatabase): InterestDefaults {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, DEFAULTS_KEY)).get();
  const v = (row?.value ?? {}) as Partial<InterestDefaults>;
  return {
    orderRateBp: isRateBp(v.orderRateBp) ? v.orderRateBp : DEFAULT_INTEREST_DEFAULTS.orderRateBp,
    totalRateBp: isRateBp(v.totalRateBp) ? v.totalRateBp : DEFAULT_INTEREST_DEFAULTS.totalRateBp,
  };
}

/** Saves the defaults; false when a rate is not valid. Customers already on interest keep their own rate. */
export function saveInterestDefaults(db: AppDatabase, raw: unknown, now = Date.now()): boolean {
  const v = (raw ?? {}) as Partial<InterestDefaults>;
  if (!isRateBp(v.orderRateBp) || !isRateBp(v.totalRateBp)) return false;
  const value = { orderRateBp: v.orderRateBp, totalRateBp: v.totalRateBp };
  db.insert(settings).values({ key: DEFAULTS_KEY, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  return true;
}

interface InterestCustomer {
  id: string;
  mode: InterestMode;
  rateBp: number;
  startedAt: number;
}

/**
 * Writes the interest that has fallen due, for customers who have it. Safe to run any time and as often as wanted:
 * each period is charged once (an interest entry dated when the period fell due marks it done), and a period missed while
 * the app was closed is charged when it next runs, dated when it fell due.
 * - Per sales order: each credit sale (charged since interest was switched on) is charged on its own unpaid amount
 *   15 days after the sale and then every month, until it is paid.
 * - On total credit: every month from when it was switched on, on what the customer owes then (if anything).
 * Returns the number of entries written.
 */
export function accrueInterest(db: AppDatabase, now = Date.now()): number {
  const customers = db.$client
    .prepare('SELECT id, interest_mode AS mode, interest_rate_bp AS rateBp, interest_started_at AS startedAt FROM customers WHERE interest_mode IS NOT NULL AND deleted_at IS NULL')
    .all() as InterestCustomer[];
  let written = 0;
  for (const customer of customers) {
    db.transaction((tx) => {
      const rows = db.$client
        .prepare('SELECT type, amount, order_id AS orderId, at FROM customer_ledger WHERE customer_id = ? ORDER BY at, rowid')
        .all(customer.id) as InterestEntry[];
      const add = (amount: number, orderId: string | null, at: number, note: string): void => {
        tx.insert(customerLedger).values({ customerId: customer.id, type: 'interest', amount, orderId, note, employeeId: null, at }).run();
        rows.push({ type: 'interest', amount, orderId, at }); // later periods of this run compound on it
        written++;
      };
      const rate = `${customer.rateBp / 100}%`;
      // A period is identified by when it fell due: the interest entry for it is dated exactly then.
      const charged = new Set(rows.filter((e) => e.type === 'interest').map((e) => `${e.orderId ?? ''}|${e.at}`));
      if (customer.mode === 'order') {
        const sales = new Map<string, number>(); // order id -> when it was charged
        for (const e of rows) if (e.type === 'charge' && e.orderId && e.at >= customer.startedAt && !sales.has(e.orderId)) sales.set(e.orderId, e.at);
        for (const [orderId, chargedAt] of sales) {
          for (let n = 1; orderInterestDueAt(chargedAt, n) <= now; n++) {
            const dueAt = orderInterestDueAt(chargedAt, n);
            if (charged.has(`${orderId}|${dueAt}`)) continue;
            const amount = interestOn(unpaidByOrder(rows, dueAt, customer.startedAt).get(orderId) ?? 0, customer.rateBp);
            if (amount <= 0) break; // paid off or cancelled: nothing more falls due
            add(amount, orderId, dueAt, `Interest ${rate} on a sale`);
          }
        }
      } else {
        for (let n = 1; totalInterestDueAt(customer.startedAt, n) <= now; n++) {
          const dueAt = totalInterestDueAt(customer.startedAt, n);
          if (charged.has(`|${dueAt}`)) continue;
          const amount = interestOn(balanceAt(rows, dueAt), customer.rateBp);
          if (amount > 0) add(amount, null, dueAt, `Interest ${rate} on total credit`);
        }
      }
    });
  }
  return written;
}
