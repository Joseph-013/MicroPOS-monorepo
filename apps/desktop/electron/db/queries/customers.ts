import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  type CustomerAccount,
  type CustomerField,
  type CustomerInput,
  type CustomerRecord,
  INTEREST_MODES,
  type InterestMode,
  isRateBp,
  type LedgerEntryRecord,
  ORDER_PAYMENT_METHODS,
  type OrderPaymentMethod,
  type ReceivePaymentResult,
  type RemoveCustomersResult,
  type SaveCustomerResult,
} from '@micropos/core';
import type { AppDatabase } from '../index';
import { customerLedger, customers } from '../schema';
import { creditAlerts } from './credit-alerts';
import { sellingEmployee } from './orders';

const MAX_BULK = 1000;
const MAX_CENTS = 100_000_000_00;
const MAX_REFERENCE = 200;
type Invalid = { field: CustomerField | null; error: string };

const text = (value: unknown, max: number): string | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length > max ? undefined : clean || null;
};

/** Validates what the renderer sent; returns clean input or the first problem found. */
export function sanitizeCustomerInput(value: unknown): CustomerInput | Invalid {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v['name'] === 'string' ? v['name'].trim().replace(/\s+/g, ' ') : '';
  if (!name) return { field: 'name', error: 'Enter a name' };
  if (name.length > 100) return { field: 'name', error: 'Name is too long' };
  const phone = text(v['phone'], 40);
  if (phone === undefined) return { field: 'phone', error: 'Phone number is too long' };
  const note = text(v['note'], 200);
  if (note === undefined) return { field: 'note', error: 'Note is too long' };
  const limit = v['creditLimit'] ?? null;
  if (limit !== null && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > MAX_CENTS)) {
    return { field: 'creditLimit', error: 'Enter a valid credit limit' };
  }
  const mode = v['interestMode'] ?? null;
  if (mode !== null && !INTEREST_MODES.includes(mode as InterestMode)) return { field: 'interest', error: 'Choose how interest is charged' };
  const rate = v['interestRateBp'] ?? null;
  if (mode !== null && !isRateBp(rate)) return { field: 'interest', error: 'Enter a rate between 0.01% and 100%' };
  return { name, phone, note, creditLimit: limit as number | null, interestMode: mode as InterestMode | null, interestRateBp: mode === null ? null : (rate as number) };
}

const isInvalid = (r: CustomerInput | Invalid): r is Invalid => 'error' in r;

interface Row {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  creditLimit: number | null;
  interestMode: InterestMode | null;
  interestRateBp: number | null;
  interestStartedAt: number | null;
  createdAt: number;
  deletedAt: number | null;
  balance: number;
  lastActivityAt: number | null;
}

function selectRecords(db: AppDatabase, where: string, params: unknown[] = []): CustomerRecord[] {
  const rows = db.$client
    .prepare(
      `SELECT c.id AS id, c.name AS name, c.phone AS phone, c.note AS note, c.credit_limit AS creditLimit,
              c.interest_mode AS interestMode, c.interest_rate_bp AS interestRateBp, c.interest_started_at AS interestStartedAt,
              c.created_at AS createdAt, c.deleted_at AS deletedAt,
              COALESCE((SELECT SUM(amount) FROM customer_ledger l WHERE l.customer_id = c.id), 0) AS balance,
              (SELECT MAX(at) FROM customer_ledger l WHERE l.customer_id = c.id) AS lastActivityAt
         FROM customers c ${where} ORDER BY lower(c.name), c.id`,
    )
    .all(...params) as Row[];
  const alerts = creditAlerts(db);
  return rows.map((r) => ({ ...r, alert: alerts.get(r.id) ?? null }));
}

/** Live customers with their balances; deleted ones too when asked. */
export function listCustomers(db: AppDatabase, includeDeleted = false): CustomerRecord[] {
  return selectRecords(db, includeDeleted ? '' : 'WHERE c.deleted_at IS NULL');
}

function record(db: AppDatabase, id: string): CustomerRecord | undefined {
  return selectRecords(db, 'WHERE c.id = ?', [id])[0];
}

function save(db: AppDatabase, id: string | null, raw: unknown, now: number): SaveCustomerResult {
  const input = sanitizeCustomerInput(raw);
  if (isInvalid(input)) return { ok: false, ...input };
  let savedId: string;
  if (id === null) {
    savedId = db.insert(customers).values({ ...input, interestStartedAt: input.interestMode ? now : null }).returning({ id: customers.id }).get().id;
  } else {
    const [existing] = db.select({ id: customers.id, interestMode: customers.interestMode, interestStartedAt: customers.interestStartedAt }).from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt))).all();
    if (!existing) return { ok: false, field: null, error: 'Customer not found' };
    // Interest is only charged from when it was switched on; a different kind starts afresh, a new rate keeps the start.
    const interestStartedAt = input.interestMode === null ? null : input.interestMode === existing.interestMode ? existing.interestStartedAt : now;
    db.update(customers).set({ ...input, interestStartedAt }).where(eq(customers.id, id)).run();
    savedId = id;
  }
  return { ok: true, customer: record(db, savedId)! };
}

export const createCustomer = (db: AppDatabase, raw: unknown, now = Date.now()): SaveCustomerResult => save(db, null, raw, now);
export const updateCustomer = (db: AppDatabase, id: unknown, raw: unknown, now = Date.now()): SaveCustomerResult =>
  typeof id === 'string' ? save(db, id, raw, now) : { ok: false, field: null, error: 'Customer not found' };

const idList = (ids: unknown): string[] =>
  Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_BULK) : [];

/** Removes customers from the list. One whose balance is not zero stays (their ledger would have nowhere to be seen) and is reported. */
export function deleteCustomers(db: AppDatabase, ids: unknown, now = Date.now()): RemoveCustomersResult {
  const wanted = idList(ids);
  const result: RemoveCustomersResult = { removed: 0, blocked: [] };
  if (!wanted.length) return result;
  const rows = listCustomers(db).filter((c) => wanted.includes(c.id));
  const removable = rows.filter((c) => c.balance === 0).map((c) => c.id);
  result.blocked = rows.filter((c) => c.balance !== 0).map((c) => c.name);
  if (removable.length) db.update(customers).set({ deletedAt: now }).where(inArray(customers.id, removable)).run();
  result.removed = removable.length;
  return result;
}

export function restoreCustomers(db: AppDatabase, ids: unknown): void {
  const wanted = idList(ids);
  if (wanted.length) db.update(customers).set({ deletedAt: null }).where(inArray(customers.id, wanted)).run();
}

/** A customer with their ledger, newest first, each entry showing what they owed right after it. */
export function getCustomerAccount(db: AppDatabase, id: unknown): CustomerAccount | null {
  if (typeof id !== 'string') return null;
  const customer = record(db, id);
  if (!customer) return null;
  const rows = db.$client
    .prepare(
      `SELECT l.id AS id, l.type AS type, l.amount AS amount, l.order_id AS orderId, o.order_number AS orderNumber,
              l.method AS method, l.reference AS reference, l.note AS note, e.name AS employeeName, l.at AS at
         FROM customer_ledger l
         LEFT JOIN orders o ON o.id = l.order_id
         LEFT JOIN employees e ON e.id = l.employee_id
        WHERE l.customer_id = ?
        ORDER BY l.at, l.rowid`,
    )
    .all(id) as Omit<LedgerEntryRecord, 'balanceAfter'>[];
  let running = 0;
  const entries = rows.map((r) => ({ ...r, balanceAfter: (running += r.amount) })).reverse();
  return { customer, entries };
}

/**
 * Money received from a customer towards what they owe. It can never be more than they owe (a larger amount is
 * almost always a typo), and needs a payment method; a reference (receipt, transfer or wallet number) is optional.
 */
export function receivePayment(db: AppDatabase, raw: unknown, now = Date.now()): ReceivePaymentResult {
  const v = (raw ?? {}) as Record<string, unknown>;
  if (typeof v['customerId'] !== 'string') return { ok: false, field: null, error: 'Choose a customer' };
  const amount = v['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) {
    return { ok: false, field: 'amount', error: 'Enter the amount received' };
  }
  const method = v['method'] as OrderPaymentMethod;
  if (!ORDER_PAYMENT_METHODS.includes(method)) return { ok: false, field: 'method', error: 'Choose how they paid' };
  const reference = typeof v['reference'] === 'string' ? v['reference'].trim().slice(0, MAX_REFERENCE) || null : null;

  return db.transaction((tx) => {
    const customer = record(db, v['customerId'] as string);
    if (!customer || customer.deletedAt) return { ok: false as const, field: null, error: 'Customer not found' };
    if (customer.balance <= 0) return { ok: false as const, field: 'amount' as const, error: 'This customer owes nothing' };
    if (amount > customer.balance) return { ok: false as const, field: 'amount' as const, error: 'That is more than they owe' };
    tx.insert(customerLedger)
      .values({ customerId: customer.id, type: 'payment', amount: -amount, method, reference, employeeId: sellingEmployee(tx), at: now })
      .run();
    return { ok: true as const, balance: customer.balance - amount };
  });
}

/** What a customer owes right now (0 when they have no entries). */
export const customerBalance = (db: AppDatabase, customerId: string): number =>
  (db.select({ total: sql<number>`COALESCE(SUM(${customerLedger.amount}), 0)` }).from(customerLedger).where(eq(customerLedger.customerId, customerId)).get()?.total ?? 0);
