import { creditAlertDueAt, DATA_DOMAINS, type DataDomain, type InterestEntry, EXPIRY_WARN_DAYS, purchaseConcernDueAt } from '@micropos/core';
import type { AppDatabase } from './db';
import { getCreditAlertSettings } from './db/queries/credit-alerts';
import { listBatches } from './db/queries/inventory';
import { listPurchases } from './db/queries/purchases';
import { onDataChanged } from './ipc/changes';

const DAY_MS = 86_400_000;
/** Never sleep longer than this, so a changed system clock or a long sleep is caught up soon. */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
const MIN_WAIT_MS = 1000;

/**
 * The next moment (epoch ms, after `now`) at which something becomes a concern with nothing being written: a batch
 * entering its expiry window or expiring, an order falling late or overdue, a customer's oldest unpaid sale passing
 * the days limit. Null when nothing is still to come.
 */
export function nextConcernAt(db: AppDatabase, now = Date.now()): number | null {
  const times: number[] = [];
  for (const b of listBatches(db)) {
    if (b.expiresAt === null) continue;
    times.push(b.expiresAt - EXPIRY_WARN_DAYS * DAY_MS, b.expiresAt);
  }
  for (const p of listPurchases(db)) {
    const due = purchaseConcernDueAt(p, now);
    if (due !== null) times.push(due);
  }
  const limits = getCreditAlertSettings(db);
  if (limits.days !== null) {
    const rows = db.$client
      .prepare(
        `SELECT l.customer_id AS customerId, l.type AS type, l.amount AS amount, l.order_id AS orderId, l.at AS at
           FROM customer_ledger l JOIN customers c ON c.id = l.customer_id
          WHERE c.deleted_at IS NULL ORDER BY l.customer_id, l.at, l.rowid`,
      )
      .all() as (InterestEntry & { customerId: string })[];
    const byCustomer = new Map<string, InterestEntry[]>();
    for (const r of rows) (byCustomer.get(r.customerId) ?? byCustomer.set(r.customerId, []).get(r.customerId)!).push(r);
    for (const entries of byCustomer.values()) {
      const due = creditAlertDueAt(entries, limits, now);
      if (due !== null) times.push(due);
    }
  }
  const future = times.filter((t) => t > now);
  return future.length ? Math.min(...future) : null;
}

/**
 * Wakes at the moment the next concern appears and tells the windows (`emit`), then sets the next alarm. It also
 * sets it again whenever data changes (a write can bring that moment forward or push it back). Replaces polling.
 */
export function startConcernsClock(db: AppDatabase, emit: (domains: readonly DataDomain[]) => void, now: () => number = Date.now) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    const at = nextConcernAt(db, now());
    const wait = Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, (at ?? Infinity) - now() + 50));
    timer = setTimeout(() => {
      // Waking early (the longest sleep) only looks again; the windows hear of it when the moment has really come.
      if (at !== null && now() >= at) emit(DATA_DOMAINS);
      schedule();
    }, wait);
  };
  const stopListening = onDataChanged(schedule);
  schedule();
  return {
    /** The computer woke up (timers may have slept through a deadline): announce everything and set the alarm again. */
    resume(): void {
      emit(DATA_DOMAINS);
      schedule();
    },
    stop(): void {
      clearTimeout(timer);
      stopListening();
    },
  };
}
