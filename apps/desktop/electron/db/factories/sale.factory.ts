import { faker } from '@faker-js/faker';
import type { NewOrder, NewOrderLine, NewPayment, PaymentMethod, Product } from '../schema';
import { uuid7 } from '../uuid';

export interface SaleDraft {
  order: NewOrder & {
    id: string;
    orderNumber: string;
    employeeId: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    createdAt: number;
    updatedAt: number;
  };
  lines: (NewOrderLine & { id: string })[];
  payments: (NewPayment & { id: string })[];
}

export interface SaleOptions {
  orderNumber: string;
  employeeId: string;
  products: readonly Pick<Product, 'id' | 'name' | 'price'>[];
  /** Creation time, epoch ms. */
  at: number;
  status?: 'completed' | 'voided';
  lineCount?: number;
  method?: PaymentMethod;
}

/** Cents for `unitPrice` x `quantityMilli` thousandths of a unit, rounded to the nearest cent. */
export const lineTotalFor = (unitPrice: number, quantityMilli: number): number =>
  Math.round((unitPrice * quantityMilli) / 1000);

/** A completed (or voided) sale with consistent lines, totals and payments. */
export function buildSale(opts: SaleOptions): SaleDraft {
  const status = opts.status ?? 'completed';
  const orderId = uuid7(opts.at);
  const chosen = faker.helpers.arrayElements(opts.products, opts.lineCount ?? faker.number.int({ min: 1, max: 6 }));

  const lines = chosen.map((product) => {
    const quantityMilli = faker.number.int({ min: 1, max: 4 }) * 1000;
    return {
      id: uuid7(opts.at),
      orderId,
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantityMilli,
      lineTotal: lineTotalFor(product.price, quantityMilli),
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const discountTotal = faker.datatype.boolean(0.2) ? Math.round(subtotal * 0.1) : 0;
  const total = subtotal - discountTotal;
  const completedAt = opts.at + faker.number.int({ min: 20_000, max: 180_000 });

  const method = opts.method ?? faker.helpers.weightedArrayElement<PaymentMethod>([
    { weight: 5, value: 'cash' },
    { weight: 4, value: 'card' },
    { weight: 1, value: 'other' },
  ]);

  const payments: SaleDraft['payments'] = [];
  if (status === 'completed') {
    const tendered = method === 'cash' ? Math.ceil(total / 500) * 500 : null; // bills in $5 steps
    payments.push({
      id: uuid7(completedAt),
      orderId,
      method,
      amount: total,
      tendered,
      change: tendered === null ? null : tendered - total,
      reference: method === 'card' ? faker.string.alphanumeric({ length: 8, casing: 'upper' }) : null,
      createdAt: completedAt,
    });
  }

  return {
    order: {
      id: orderId,
      orderNumber: opts.orderNumber,
      employeeId: opts.employeeId,
      status,
      subtotal,
      discountTotal,
      total,
      completedAt: status === 'completed' ? completedAt : null,
      createdAt: opts.at,
      updatedAt: completedAt,
    },
    lines,
    payments,
  };
}

/** A full refund of `original`: negative amounts, linked back through `refundOfOrderId`. */
export function buildRefund(
  original: SaleDraft,
  opts: { orderNumber: string; employeeId: string; at: number },
): SaleDraft {
  const orderId = uuid7(opts.at);
  return {
    order: {
      id: orderId,
      orderNumber: opts.orderNumber,
      employeeId: opts.employeeId,
      refundOfOrderId: original.order.id,
      status: 'completed',
      subtotal: -original.order.subtotal,
      discountTotal: -original.order.discountTotal,
      total: -original.order.total,
      completedAt: opts.at,
      createdAt: opts.at,
      updatedAt: opts.at,
    },
    lines: original.lines.map((l) => ({
      id: uuid7(opts.at),
      orderId,
      productId: l.productId,
      name: l.name,
      unitPrice: l.unitPrice,
      quantityMilli: -l.quantityMilli,
      lineTotal: -l.lineTotal,
    })),
    payments: original.payments.map((p) => ({
      id: uuid7(opts.at),
      orderId,
      method: p.method,
      amount: -p.amount,
      tendered: null,
      change: null,
      reference: p.reference,
      createdAt: opts.at,
    })),
  };
}
