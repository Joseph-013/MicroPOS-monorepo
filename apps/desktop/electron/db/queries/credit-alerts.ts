import { creditAlert, type CreditAlertSettings, DEFAULT_CREDIT_ALERTS, type InterestEntry, isAlertAmount, isAlertDays } from '@micropos/core';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../index';
import { settings } from '../schema';

const KEY = 'creditAlerts';

/** The limits that flag a customer's credit (the factory values until someone saves their own; null = that limit is off). */
export function getCreditAlertSettings(db: AppDatabase): CreditAlertSettings {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
  const v = row?.value as Partial<CreditAlertSettings> | undefined;
  if (!v) return { ...DEFAULT_CREDIT_ALERTS };
  return { amount: isAlertAmount(v.amount) ? v.amount : null, days: isAlertDays(v.days) ? v.days : null };
}

/** Saves the limits; false when one is not null and not a valid amount or number of days. */
export function saveCreditAlertSettings(db: AppDatabase, raw: unknown, now = Date.now()): boolean {
  const v = (raw ?? {}) as Partial<CreditAlertSettings>;
  const amount = v.amount ?? null;
  const days = v.days ?? null;
  if ((amount !== null && !isAlertAmount(amount)) || (days !== null && !isAlertDays(days))) return false;
  const value = { amount, days };
  db.insert(settings).values({ key: KEY, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  return true;
}

/** How many customers are flagged: over the amount, or with a sale unpaid for longer than the days. */
export function countCreditAlerts(db: AppDatabase, now = Date.now()): number {
  const limits = getCreditAlertSettings(db);
  if (limits.amount === null && limits.days === null) return 0;
  const rows = db.$client
    .prepare(
      `SELECT l.customer_id AS customerId, l.type AS type, l.amount AS amount, l.order_id AS orderId, l.at AS at
         FROM customer_ledger l JOIN customers c ON c.id = l.customer_id
        WHERE c.deleted_at IS NULL ORDER BY l.customer_id, l.at, l.rowid`,
    )
    .all() as (InterestEntry & { customerId: string })[];
  const byCustomer = new Map<string, InterestEntry[]>();
  for (const r of rows) (byCustomer.get(r.customerId) ?? byCustomer.set(r.customerId, []).get(r.customerId)!).push(r);
  let count = 0;
  for (const entries of byCustomer.values()) {
    const alert = creditAlert(entries, limits, now);
    if (alert.overAmount || alert.overdue) count++;
  }
  return count;
}
