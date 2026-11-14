import { eq } from 'drizzle-orm';
import {
  type CompleteOrderResult,
  type OrderActionResult,
  lineTotal,
  MAX_DISCOUNT_REASON,
  MAX_ORDER_NOTE,
  MILLI,
  type OrderLineProblem,
  ORDER_PAYMENT_METHODS,
  type OrderPaymentMethod,
  type SalesOrderDetail,
  type SalesOrderSummary,
  type ProductUnit,
} from '@micropos/core';
import { currentActorId } from '../../auth/actor';
import type { AppDatabase } from '../index';
import { uuid7 } from '../uuid';
import { asc } from 'drizzle-orm';
import { auditLog, customerLedger, customers, employees, orderLines, orders, payments, products, settings } from '../schema';
import { allocateSale, restockSale } from './inventory';
import { DRAFT_KEY } from './draft';

const MAX_LINES = 500;
const MAX_MILLI = 99_999_000;
const MAX_CENTS = 100_000_000_00;
const MAX_REFERENCE = 200;
const FIRST_NUMBER = 1001;

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CENTS;

/** The number the next order gets: SO-1001, SO-1002, ... one more than the highest used. */
export function nextOrderNumber(db: AppDatabase): string {
  const row = db.$client
    .prepare(`SELECT MAX(CAST(SUBSTR(order_number, 4) AS INTEGER)) AS last FROM orders WHERE order_number LIKE 'SO-%'`)
    .get() as { last: number | null };
  return `SO-${Math.max(row.last ?? 0, FIRST_NUMBER - 1) + 1}`;
}

/**
 * Who a sale (or payment) is recorded against: the person signed in. Without one (the seeder, tests) it is the first
 * active employee, or a "Register" employee made on first use whose PIN hash is not a valid hash, so nobody can sign in as it.
 */
export function sellingEmployee(tx: Pick<AppDatabase, 'select' | 'insert'>): string {
  const signedIn = currentActorId();
  if (signedIn) return signedIn;
  const [existing] = tx
    .select({ id: employees.id, deletedAt: employees.deletedAt, active: employees.active })
    .from(employees)
    .orderBy(employees.createdAt)
    .all()
    .filter((e) => e.active && e.deletedAt === null);
  if (existing) return existing.id;
  return tx
    .insert(employees)
    .values({ name: 'Register', employeeNumber: '0000', pinHash: '!', role: 'cashier' })
    .returning({ id: employees.id })
    .get().id;
}

/** What a customer owes right now, read on the open connection (so it sees this transaction's writes). */
function customerBalanceRaw(db: AppDatabase, customerId: string): number {
  const row = db.$client.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM customer_ledger WHERE customer_id = ?').get(customerId) as { total: number };
  return row.total;
}

/** Thrown inside the transaction so everything written so far is rolled back. */
class Rollback extends Error {
  constructor(readonly result: Extract<CompleteOrderResult, { ok: false }>) {
    super(result.error);
  }
}

const fail = (error: string, lines: OrderLineProblem[] = []): Extract<CompleteOrderResult, { ok: false }> => ({ ok: false, error, lines });

/**
 * Completes an order in one transaction. Each line is checked against the live catalog (the product still
 * exists and is active; the price is what the cashier saw) and against stock (tracked products are taken
 * first-expiring-first-out and cannot be oversold). Prices and names stored on the order come from the catalog,
 * never from the renderer. If anything fails nothing is written.
 */
export function completeOrder(db: AppDatabase, raw: unknown, now = Date.now()): CompleteOrderResult {
  const input = raw as {
    lines?: unknown;
    discount?: unknown;
    discountReason?: unknown;
    note?: unknown;
    customerId?: unknown;
    amountPaid?: unknown;
    payment?: { method?: unknown; tendered?: unknown; reference?: unknown };
  } | null;
  if (!Array.isArray(input?.lines) || input.lines.length === 0) return fail('The order has no items');
  if (input.lines.length > MAX_LINES) return fail('The order has too many items');
  const discount = input.discount ?? 0;
  if (!isCents(discount)) return fail('The discount is not valid');
  const customerId = typeof input.customerId === 'string' ? input.customerId : null;
  if (input.customerId !== undefined && input.customerId !== null && customerId === null) return fail('The customer is not valid');
  if (input.amountPaid !== undefined && !isCents(input.amountPaid)) return fail('The amount paid is not valid');
  const method = input.payment?.method as OrderPaymentMethod;
  if (!ORDER_PAYMENT_METHODS.includes(method)) return fail('Choose how the order is paid');

  const wanted: { productId: string; quantityMilli: number; unitPrice: number; discount: number }[] = [];
  for (const item of input.lines as { productId?: unknown; quantityMilli?: unknown; unitPrice?: unknown; discount?: unknown }[]) {
    const { productId, quantityMilli, unitPrice } = item ?? {};
    const lineDiscount = item?.discount ?? 0;
    if (
      typeof productId !== 'string' ||
      !Number.isInteger(quantityMilli) ||
      (quantityMilli as number) <= 0 ||
      (quantityMilli as number) > MAX_MILLI ||
      !isCents(unitPrice) ||
      !isCents(lineDiscount)
    ) {
      return fail('An item on the order is not valid');
    }
    wanted.push({ productId, quantityMilli: quantityMilli as number, unitPrice, discount: lineDiscount });
  }
  const discountReason = typeof input.discountReason === 'string' ? input.discountReason.trim().slice(0, MAX_DISCOUNT_REASON) || null : null;
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_ORDER_NOTE) || null : null;
  const reference = typeof input.payment?.reference === 'string' ? input.payment.reference.trim().slice(0, MAX_REFERENCE) || null : null;

  try {
    return db.transaction((tx) => {
      const employeeId = sellingEmployee(tx);
      const orderNumber = nextOrderNumber(db);
      const orderId = tx.insert(orders).values({ orderNumber, employeeId, createdAt: now, updatedAt: now }).returning({ id: orders.id }).get().id;

      const problems: OrderLineProblem[] = [];
      let subtotal = 0;
      let lineDiscounts = 0;
      const planned: { line: (typeof wanted)[number]; name: string; unit: ProductUnit; lineId: string }[] = [];
      for (const line of wanted) {
        const [product] = tx.select().from(products).where(eq(products.id, line.productId)).all();
        if (!product || product.deletedAt !== null || !product.active) {
          problems.push({ productId: line.productId, kind: 'unavailable', error: `${product?.name ?? 'An item'} is no longer available` });
          continue;
        }
        if (product.price !== line.unitPrice) {
          problems.push({
            productId: line.productId,
            kind: 'price',
            error: `The price of ${product.name} has changed`,
            current: { name: product.name, unitPrice: product.price, unit: product.unit },
          });
          continue;
        }
        const gross = lineTotal(product.price, line.quantityMilli);
        if (line.discount > gross) {
          throw new Rollback(fail(`The discount on ${product.name} is more than the item`));
        }
        planned.push({ line, name: product.name, unit: product.unit, lineId: '' });
        subtotal += gross;
        lineDiscounts += line.discount;
      }
      if (problems.length) throw new Rollback(fail('Some items on the order have changed', problems));
      if ((discount as number) > subtotal - lineDiscounts) throw new Rollback(fail('The discount is more than the order'));
      const discountTotal = lineDiscounts + (discount as number);
      const total = subtotal - discountTotal;

      // A credit sale pays part now (possibly nothing) and puts the rest on the customer's account.
      const amountPaid = input.amountPaid === undefined ? total : (input.amountPaid as number);
      if (amountPaid > total) throw new Rollback(fail('The amount paid is more than the total'));
      const onAccount = total - amountPaid;
      if (onAccount > 0 && !customerId) throw new Rollback(fail('Choose a customer to put the rest on account'));
      if (customerId) {
        const [customer] = tx.select().from(customers).where(eq(customers.id, customerId)).all();
        if (!customer || customer.deletedAt !== null) throw new Rollback(fail('Customer not found'));
        if (onAccount > 0 && customer.creditLimit !== null) {
          const owed = customerBalanceRaw(db, customerId);
          if (owed + onAccount > customer.creditLimit) {
            throw new Rollback(fail(`${customer.name} would owe more than their credit limit`));
          }
        }
      }

      const tendered = input.payment?.tendered;
      if (method === 'cash' && amountPaid > 0) {
        if (!isCents(tendered) || tendered < amountPaid) throw new Rollback(fail('The cash handed over does not cover the amount paid'));
      }

      for (const item of planned) {
        const lineId = tx
          .insert(orderLines)
          .values({
            orderId,
            productId: item.line.productId,
            name: item.name,
            unitPrice: item.line.unitPrice,
            quantityMilli: item.line.quantityMilli,
            lineTotal: lineTotal(item.line.unitPrice, item.line.quantityMilli),
            discount: item.line.discount,
          })
          .returning({ id: orderLines.id })
          .get().id;
        item.lineId = lineId;
        const sale = allocateSale(db, { productId: item.line.productId, orderLineId: lineId, quantityMilli: item.line.quantityMilli, employeeId, at: now, tx });
        if (sale.shortfallMilli > 0) {
          const available = item.line.quantityMilli - sale.shortfallMilli;
          problems.push({
            productId: item.line.productId,
            kind: 'stock',
            error: `Only ${available / MILLI} of ${item.name} in stock`,
          });
          continue;
        }
        if (sale.unitCost !== null) tx.update(orderLines).set({ unitCost: sale.unitCost }).where(eq(orderLines.id, lineId)).run();
      }
      if (problems.length) throw new Rollback(fail('Not enough stock for some items', problems));

      tx.update(orders).set({ status: 'completed', subtotal, discountTotal, total, discountReason: discountTotal > 0 ? discountReason : null, note, completedAt: now, updatedAt: now }).where(eq(orders.id, orderId)).run();
      const cashIn = method === 'cash' && amountPaid > 0;
      const change = cashIn ? (tendered as number) - amountPaid : 0;
      if (amountPaid > 0) {
        tx.insert(payments)
          .values({ orderId, method, amount: amountPaid, tendered: cashIn ? (tendered as number) : null, change: cashIn ? change : null, reference, createdAt: now })
          .run();
      }
      if (customerId) tx.update(orders).set({ customerId }).where(eq(orders.id, orderId)).run();
      if (onAccount > 0) {
        tx.insert(customerLedger).values({ customerId: customerId!, type: 'charge', amount: onAccount, orderId, employeeId, at: now }).run();
      }
      tx.delete(settings).where(eq(settings.key, DRAFT_KEY)).run();

      return { ok: true as const, orderId, orderNumber, total, change, onAccount };
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    throw error;
  }
}

/** The id of the order with this number ("SO-1001"), or null. */
export function orderIdByNumber(db: AppDatabase, orderNumber: unknown): string | null {
  if (typeof orderNumber !== 'string') return null;
  return db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, orderNumber.trim())).get()?.id ?? null;
}

/** One order with its lines and payments for viewing, or null when `id` is not an order. */
export function getOrder(db: AppDatabase, id: unknown): SalesOrderDetail | null {
  if (typeof id !== 'string') return null;
  const [order] = db
    .select({ order: orders, employeeName: employees.name })
    .from(orders)
    .innerJoin(employees, eq(employees.id, orders.employeeId))
    .where(eq(orders.id, id))
    .all();
  if (!order) return null;
  const lines = db
    .select({ line: orderLines, unit: products.unit })
    .from(orderLines)
    .leftJoin(products, eq(products.id, orderLines.productId))
    .where(eq(orderLines.orderId, id))
    .orderBy(asc(orderLines.id))
    .all();
  const paid = db.select().from(payments).where(eq(payments.orderId, id)).orderBy(asc(payments.createdAt)).all();
  const o = order.order;
  const refundOf = o.refundOfOrderId
    ? db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, o.refundOfOrderId)).get()
    : undefined;
  const refundedBy = db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.refundOfOrderId, id)).get();
  const customer = o.customerId ? db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, o.customerId)).get() : undefined;
  const onAccount = (db.$client.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM customer_ledger WHERE order_id = ? AND type IN ('charge', 'refund')").get(id) as { total: number }).total;
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    employeeName: order.employeeName,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    total: o.total,
    discountReason: o.discountReason,
    note: o.note,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
    customer: customer ?? null,
    onAccount,
    refundOf: refundOf ?? null,
    refundedBy: refundedBy ?? null,
    lines: lines.map(({ line, unit }) => ({ id: line.id, productId: line.productId, name: line.name, unitPrice: line.unitPrice, quantityMilli: line.quantityMilli, lineTotal: line.lineTotal, discount: line.discount, unit })),
    payments: paid.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, change: p.change, reference: p.reference })),
  };
}

/** Every order for the Sales Orders list, newest first. */
export function listOrders(db: AppDatabase): SalesOrderSummary[] {
  const rows = db.$client
    .prepare(
      `SELECT o.id AS id, o.order_number AS orderNumber, o.status AS status, e.name AS employeeName, o.total AS total,
              o.created_at AS createdAt, o.refund_of_order_id IS NOT NULL AS isRefund, c.name AS customerName,
              COALESCE((SELECT SUM(amount) FROM customer_ledger cl WHERE cl.order_id = o.id AND cl.type IN ('charge', 'refund')), 0) AS onAccount,
              (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS itemCount,
              (SELECT GROUP_CONCAT(method) FROM (SELECT method FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at, p.id)) AS methods
         FROM orders o JOIN employees e ON e.id = o.employee_id LEFT JOIN customers c ON c.id = o.customer_id
        ORDER BY o.created_at DESC, o.order_number DESC`,
    )
    .all() as (Omit<SalesOrderSummary, 'methods' | 'isRefund'> & { methods: string | null; isRefund: number })[];
  return rows.map((r) => ({ ...r, isRefund: !!r.isRefund, methods: r.methods ? (r.methods.split(',') as OrderPaymentMethod[]) : [] }));
}

/** Thrown inside the transaction so everything written so far is rolled back. */
class ActionFailure extends Error {}

const MAX_REASON = 200;

type ReverseKind = 'void' | 'refund';

/**
 * Voids or refunds a completed sale in one transaction. Both put the stock back into the batches it came from,
 * write an audit entry (who, what, why) and refuse an order that is not a completed sale. A void keeps the order and
 * marks it voided; a refund records a new order with negative lines and payments (linked back through
 * `refundOfOrderId`) and marks the sale refunded. The whole order is reversed (partial refunds are not supported).
 */
function reverseOrder(db: AppDatabase, kind: ReverseKind, raw: unknown, now: number): OrderActionResult {
  const input = raw as { orderId?: unknown; reason?: unknown } | null;
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, MAX_REASON) : '';
  if (typeof input?.orderId !== 'string') return { ok: false, error: 'Choose an order' };
  if (!reason) return { ok: false, error: 'Give a reason' };
  const orderId = input.orderId;

  try {
    return db.transaction((tx) => {
      const [order] = tx.select().from(orders).where(eq(orders.id, orderId)).all();
      if (!order) throw new ActionFailure('Order not found');
      if (order.refundOfOrderId) throw new ActionFailure(`${order.orderNumber} is a refund and cannot be ${kind === 'void' ? 'voided' : 'refunded'}`);
      if (order.status !== 'completed') throw new ActionFailure(`${order.orderNumber} is already ${order.status}`);

      const employeeId = sellingEmployee(tx);
      const lines = tx.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.id)).all();
      for (const line of lines) restockSale(db, line.id, kind, employeeId, now, tx);

      let refund: { id: string; orderNumber: string } | undefined;
      if (kind === 'refund') {
        refund = { id: uuid7(now), orderNumber: nextOrderNumber(db) };
        tx.insert(orders)
          .values({
            id: refund.id,
            orderNumber: refund.orderNumber,
            employeeId,
            refundOfOrderId: orderId,
            customerId: order.customerId,
            status: 'completed',
            subtotal: -order.subtotal,
            discountTotal: -order.discountTotal,
            discountReason: order.discountReason,
            total: -order.total,
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        for (const line of lines) {
          tx.insert(orderLines)
            .values({ orderId: refund.id, productId: line.productId, name: line.name, unitPrice: line.unitPrice, unitCost: line.unitCost, quantityMilli: -line.quantityMilli, lineTotal: -line.lineTotal, discount: -line.discount })
            .run();
        }
        for (const payment of tx.select().from(payments).where(eq(payments.orderId, orderId)).all()) {
          tx.insert(payments).values({ orderId: refund.id, method: payment.method, amount: -payment.amount, tendered: null, change: null, reference: payment.reference, createdAt: now }).run();
        }
      }
      // What the sale left on the customer's account comes off it again: a void or refund cancels the debt.
      if (order.customerId) {
        const charged = (db.$client.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM customer_ledger WHERE order_id = ? AND type = 'charge'").get(orderId) as { total: number }).total;
        if (charged > 0) {
          tx.insert(customerLedger)
            .values({ customerId: order.customerId, type: kind, amount: -charged, orderId: refund?.id ?? orderId, employeeId, at: now })
            .run();
        }
      }
      tx.update(orders).set({ status: kind === 'void' ? 'voided' : 'refunded', updatedAt: now }).where(eq(orders.id, orderId)).run();
      tx.insert(auditLog)
        .values({
          employeeId,
          action: `order.${kind}`,
          entity: 'order',
          entityId: orderId,
          detail: { orderNumber: order.orderNumber, reason, ...(refund ? { refundOrderNumber: refund.orderNumber } : {}) },
          at: now,
        })
        .run();
      return { ok: true as const, orderId, orderNumber: order.orderNumber, ...(refund ? { refundOrderId: refund.id, refundOrderNumber: refund.orderNumber } : {}) };
    });
  } catch (error) {
    if (error instanceof ActionFailure) return { ok: false, error: error.message };
    throw error;
  }
}

export const voidOrder = (db: AppDatabase, raw: unknown, now = Date.now()): OrderActionResult => reverseOrder(db, 'void', raw, now);
export const refundOrder = (db: AppDatabase, raw: unknown, now = Date.now()): OrderActionResult => reverseOrder(db, 'refund', raw, now);
