import {
  CASH_MOVEMENT_TYPES,
  type CashDrawerState,
  type CashFlow,
  type CashMovementRecord,
  type CashMovementType,
  type CashResult,
  type CashSessionRecord,
  type CashField,
  expectedCash,
  MAX_CASH_NOTE,
  MAX_CASH_REASON,
} from '@micropos/core';
import { currentActorId } from '../../auth/actor';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../index';
import { auditLog, cashMovements, cashSessions } from '../schema';

const MAX_CENTS = 100_000_000_00;
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CENTS;
const fail = (field: CashField | null, error: string): { ok: false; field: CashField | null; error: string } => ({ ok: false, field, error });
const sum = (db: AppDatabase, sql: string, ...params: unknown[]): number => (db.$client.prepare(sql).get(...params) as { v: number }).v;

/**
 * The cash that came in and went out between `from` (included) and `to` (excluded), from the records:
 * - sales: cash payments (refunds are negative payments, so they come off), less the cash of sales voided in that
 *   time (a void leaves the sale's payments as history, but the cash goes back);
 * - cash customers paid towards what they owe, and cash paid to suppliers (by method);
 * - cash put in and taken out by hand.
 */
export function cashFlow(db: AppDatabase, from: number, to: number): CashFlow {
  const sales =
    sum(db, "SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE method = 'cash' AND created_at >= ? AND created_at < ?", from, to) -
    sum(
      db,
      `SELECT COALESCE(SUM(p.amount), 0) AS v FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.method = 'cash' AND p.amount > 0 AND o.status = 'voided' AND o.updated_at >= ? AND o.updated_at < ?`,
      from,
      to,
    );
  return {
    sales,
    customerPayments: sum(db, "SELECT COALESCE(-SUM(amount), 0) AS v FROM customer_ledger WHERE type = 'payment' AND method = 'cash' AND at >= ? AND at < ?", from, to),
    supplierPayments: sum(db, "SELECT COALESCE(SUM(amount), 0) AS v FROM purchase_payments WHERE method = 'cash' AND at >= ? AND at < ?", from, to),
    movementsIn: sum(db, "SELECT COALESCE(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'in' AND at >= ? AND at < ?", from, to),
    movementsOut: sum(db, "SELECT COALESCE(SUM(amount), 0) AS v FROM cash_movements WHERE type = 'out' AND at >= ? AND at < ?", from, to),
  };
}

const SESSION_SELECT = `SELECT s.id AS id, s.opened_at AS openedAt, o.name AS openedBy, s.opening_float AS openingFloat,
        s.closed_at AS closedAt, c.name AS closedBy, s.counted_cash AS countedCash, s.expected_cash AS expectedCash,
        s.variance AS variance, s.note AS note
   FROM cash_sessions s LEFT JOIN employees o ON o.id = s.opened_by LEFT JOIN employees c ON c.id = s.closed_by`;

function movementsOf(db: AppDatabase, sessionId: string): CashMovementRecord[] {
  return db.$client
    .prepare(
      `SELECT m.id AS id, m.type AS type, m.amount AS amount, m.reason AS reason, e.name AS employeeName, m.at AS at
         FROM cash_movements m LEFT JOIN employees e ON e.id = m.employee_id WHERE m.session_id = ? ORDER BY m.at, m.rowid`,
    )
    .all(sessionId) as CashMovementRecord[];
}

/** Sessions that were open at some time between `from` and `to`, oldest first (what a day report lists). */
export function sessionsOverlapping(db: AppDatabase, from: number, to: number): CashSessionRecord[] {
  return db.$client.prepare(`${SESSION_SELECT} WHERE s.opened_at < ? AND (s.closed_at IS NULL OR s.closed_at >= ?) ORDER BY s.opened_at`).all(to, from) as CashSessionRecord[];
}

/** The drawer as the till shows it: the open session and its movements; never what it should hold (the count is blind). */
export function drawerState(db: AppDatabase): CashDrawerState {
  const open = db.$client.prepare(`${SESSION_SELECT} WHERE s.closed_at IS NULL ORDER BY s.opened_at DESC LIMIT 1`).get() as CashSessionRecord | undefined;
  const lastClosed = db.$client.prepare(`${SESSION_SELECT} WHERE s.closed_at IS NOT NULL ORDER BY s.closed_at DESC, s.rowid DESC LIMIT 1`).get() as CashSessionRecord | undefined;
  return {
    session: open ? { id: open.id, openedAt: open.openedAt, openedBy: open.openedBy, openingFloat: open.openingFloat, note: open.note } : null,
    movements: open ? movementsOf(db, open.id) : [],
    lastClosed: lastClosed ?? null,
  };
}

const openSessionId = (db: AppDatabase): string | undefined => (db.$client.prepare('SELECT id FROM cash_sessions WHERE closed_at IS NULL LIMIT 1').get() as { id: string } | undefined)?.id;

/** Starts a session with the counted float. Refused while one is open. */
export function openDrawer(db: AppDatabase, raw: unknown, now = Date.now()): CashResult<CashDrawerState> {
  const input = (raw ?? {}) as { openingFloat?: unknown };
  if (!isCents(input.openingFloat)) return fail('openingFloat', 'Enter the cash counted');
  return db.transaction((tx) => {
    if (openSessionId(db)) return fail(null, 'The drawer is already open');
    const id = tx.insert(cashSessions).values({ openedAt: now, openedBy: currentActorId(), openingFloat: input.openingFloat as number }).returning({ id: cashSessions.id }).get().id;
    tx.insert(auditLog).values({ employeeId: currentActorId(), action: 'cash.open', entity: 'cash_session', entityId: id, detail: { openingFloat: input.openingFloat }, at: now }).run();
    return { ok: true as const, value: drawerState(db) };
  });
}

/** Cash put in or taken out by hand while a session is open. */
export function addCashMovement(db: AppDatabase, raw: unknown, now = Date.now()): CashResult<CashDrawerState> {
  const input = (raw ?? {}) as { type?: unknown; amount?: unknown; reason?: unknown };
  if (!CASH_MOVEMENT_TYPES.includes(input.type as CashMovementType)) return fail(null, 'Choose in or out');
  if (!isCents(input.amount) || input.amount <= 0) return fail('amount', 'Enter an amount');
  const reason = typeof input.reason === 'string' ? input.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason) return fail('reason', 'Say what it is for');
  if (reason.length > MAX_CASH_REASON) return fail('reason', 'That is too long');
  return db.transaction((tx) => {
    const sessionId = openSessionId(db);
    if (!sessionId) return fail(null, 'Open the drawer first');
    tx.insert(cashMovements).values({ sessionId, type: input.type as CashMovementType, amount: input.amount as number, reason, employeeId: currentActorId(), at: now }).run();
    tx.insert(auditLog).values({ employeeId: currentActorId(), action: `cash.${input.type as string}`, entity: 'cash_session', entityId: sessionId, detail: { amount: input.amount, reason }, at: now }).run();
    return { ok: true as const, value: drawerState(db) };
  });
}

/**
 * Closes the open session with the counted cash. What the drawer should have held is worked out here, from the records
 * between opening and now (`cashFlow` plus the float), and stored with the count and the difference.
 */
export function closeDrawer(db: AppDatabase, raw: unknown, now = Date.now()): CashResult<CashSessionRecord> {
  const input = (raw ?? {}) as { countedCash?: unknown; note?: unknown };
  if (!isCents(input.countedCash)) return fail('countedCash', 'Enter the cash counted');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  if (note !== null && note.length > MAX_CASH_NOTE) return fail('note', 'That is too long');
  return db.transaction((tx) => {
    const session = db.$client.prepare('SELECT id, opened_at AS openedAt, opening_float AS openingFloat FROM cash_sessions WHERE closed_at IS NULL LIMIT 1').get() as { id: string; openedAt: number; openingFloat: number } | undefined;
    if (!session) return fail(null, 'The drawer is not open');
    const expected = expectedCash(session.openingFloat, cashFlow(db, session.openedAt, now + 1));
    const counted = input.countedCash as number;
    tx.update(cashSessions).set({ closedAt: now, closedBy: currentActorId(), countedCash: counted, expectedCash: expected, variance: counted - expected, note }).where(eq(cashSessions.id, session.id)).run();
    tx.insert(auditLog).values({ employeeId: currentActorId(), action: 'cash.close', entity: 'cash_session', entityId: session.id, detail: { counted, expected, variance: counted - expected }, at: now }).run();
    return { ok: true as const, value: db.$client.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(session.id) as CashSessionRecord };
  });
}
