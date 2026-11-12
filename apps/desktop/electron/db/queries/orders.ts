import { eq } from 'drizzle-orm';
import {
  type CompleteOrderResult,
  lineTotal,
  MILLI,
  type OrderLineProblem,
  ORDER_PAYMENT_METHODS,
  type OrderPaymentMethod,
  type ProductUnit,
} from '@micropos/core';
import type { AppDatabase } from '../index';
import { employees, orderLines, orders, payments, products, settings } from '../schema';
import { allocateSale } from './inventory';
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
 * Who rings up sales until sign-in exists: the first active employee, or a "Register" employee made on first use.
 * Its PIN hash is not a valid hash, so nobody can sign in as it.
 */
function sellingEmployee(tx: Pick<AppDatabase, 'select' | 'insert'>): string {
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
    payment?: { method?: unknown; tendered?: unknown; reference?: unknown };
  } | null;
  if (!Array.isArray(input?.lines) || input.lines.length === 0) return fail('The order has no items');
  if (input.lines.length > MAX_LINES) return fail('The order has too many items');
  const discount = input.discount ?? 0;
  if (!isCents(discount)) return fail('The discount is not valid');
  const method = input.payment?.method as OrderPaymentMethod;
  if (!ORDER_PAYMENT_METHODS.includes(method)) return fail('Choose how the order is paid');

  const wanted: { productId: string; quantityMilli: number; unitPrice: number }[] = [];
  for (const item of input.lines as { productId?: unknown; quantityMilli?: unknown; unitPrice?: unknown }[]) {
    const { productId, quantityMilli, unitPrice } = item ?? {};
    if (
      typeof productId !== 'string' ||
      !Number.isInteger(quantityMilli) ||
      (quantityMilli as number) <= 0 ||
      (quantityMilli as number) > MAX_MILLI ||
      !isCents(unitPrice)
    ) {
      return fail('An item on the order is not valid');
    }
    wanted.push({ productId, quantityMilli: quantityMilli as number, unitPrice });
  }
  const reference = typeof input.payment?.reference === 'string' ? input.payment.reference.trim().slice(0, MAX_REFERENCE) || null : null;

  try {
    return db.transaction((tx) => {
      const employeeId = sellingEmployee(tx);
      const orderNumber = nextOrderNumber(db);
      const orderId = tx.insert(orders).values({ orderNumber, employeeId, createdAt: now, updatedAt: now }).returning({ id: orders.id }).get().id;

      const problems: OrderLineProblem[] = [];
      let subtotal = 0;
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
        planned.push({ line, name: product.name, unit: product.unit, lineId: '' });
        subtotal += lineTotal(product.price, line.quantityMilli);
      }
      if (problems.length) throw new Rollback(fail('Some items on the order have changed', problems));
      if ((discount as number) > subtotal) throw new Rollback(fail('The discount is more than the order'));
      const total = subtotal - (discount as number);

      const tendered = input.payment?.tendered;
      if (method === 'cash') {
        if (!isCents(tendered) || tendered < total) throw new Rollback(fail('The cash handed over does not cover the total'));
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

      tx.update(orders).set({ status: 'completed', subtotal, discountTotal: discount as number, total, completedAt: now, updatedAt: now }).where(eq(orders.id, orderId)).run();
      const change = method === 'cash' ? (tendered as number) - total : 0;
      tx.insert(payments)
        .values({ orderId, method, amount: total, tendered: method === 'cash' ? (tendered as number) : null, change: method === 'cash' ? change : null, reference, createdAt: now })
        .run();
      tx.delete(settings).where(eq(settings.key, DRAFT_KEY)).run();

      return { ok: true as const, orderId, orderNumber, total, change };
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    throw error;
  }
}
