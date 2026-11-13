import { faker } from '@faker-js/faker';
import { lineTotal } from '@micropos/core';
import type {
  NewProductBatch,
  NewPurchaseOrder,
  NewPurchaseOrderLine,
  NewPurchasePayment,
  NewStockMovement,
  NewSupplier,
  ProductTracking,
} from '../schema';
import { PAYMENT_METHODS } from '../schema';
import { uuid7 } from '../uuid';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A supplier with a landline-style phone number. */
export function buildSupplier(overrides: Partial<NewSupplier> = {}, now = Date.now()): NewSupplier {
  return {
    id: uuid7(now),
    name: `${faker.company.name().split(/[ ,]/)[0]} ${faker.helpers.arrayElement(['Wholesale', 'Trading', 'Distribution', 'Supply Co.', 'Foods'])}`,
    phone: faker.phone.number({ style: 'national' }),
    note: faker.datatype.boolean(0.3) ? faker.lorem.words(3) : null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface PurchasableProduct {
  id: string;
  tracking: ProductTracking;
  unit: string;
  cost: number | null;
  price: number;
}

export interface SeededPurchases {
  orders: NewPurchaseOrder[];
  lines: NewPurchaseOrderLine[];
  payments: NewPurchasePayment[];
  /** `receive` movements for the received orders, into batches the stock seed already made. */
  movements: NewStockMovement[];
}

/**
 * Purchase orders over the last stretch: most were received (their stock goes into the product's existing batch, so
 * quantities on hand stay consistent with the stock ledger), some are still on the way, a few were cancelled. Payments
 * are mixed: settled in full, paid in parts, a deposit only, or not at all, some already past their due date.
 */
export function buildPurchases(
  count: number,
  suppliers: NewSupplier[],
  products: PurchasableProduct[],
  batches: NewProductBatch[],
  employeeId: string,
  start: number,
  now: number,
): SeededPurchases {
  const out: SeededPurchases = { orders: [], lines: [], payments: [], movements: [] };
  // Received orders only use products whose stock sits in one unnamed batch (or is not tracked), so no batch is invented.
  const simple = products.filter((p) => p.tracking === 'none' || p.tracking === 'quantity');
  // Orders mostly hold products whose stock is counted (the point of receiving them); a few track nothing.
  const counted = simple.filter((p) => p.tracking === 'quantity');
  const pick = (): PurchasableProduct[] => [
    ...faker.helpers.arrayElements(counted, { min: 2, max: Math.min(4, counted.length) }),
    ...(faker.datatype.boolean(0.3) ? faker.helpers.arrayElements(simple.filter((p) => p.tracking === 'none'), 1) : []),
  ];
  const unnamed = new Map(batches.filter((b) => b.batchNumber == null).map((b) => [b.productId, b.id!]));
  const times = Array.from({ length: count }, () => faker.number.int({ min: start, max: now - 12 * HOUR })).sort((a, b) => a - b);

  times.forEach((orderedAt, i) => {
    const supplier = faker.helpers.arrayElement(suppliers);
    const chosen = counted.length >= 2 ? pick() : faker.helpers.arrayElements(simple, { min: 2, max: 5 });
    const id = uuid7(orderedAt);
    const expectedAt = orderedAt + faker.number.int({ min: 2, max: 7 }) * DAY;
    const wanted = faker.helpers.weightedArrayElement([
      { weight: 6, value: 'received' as const },
      { weight: 3, value: 'ordered' as const },
      { weight: 1, value: 'cancelled' as const },
    ]);
    // An order cannot have arrived before its expected date has passed.
    const status = wanted === 'received' && expectedAt > now ? 'ordered' : wanted;
    const receivedAt = status === 'received' ? expectedAt : null;

    let total = 0;
    const lines: NewPurchaseOrderLine[] = chosen.map((p) => {
      const quantityMilli = p.unit === 'each' ? faker.number.int({ min: 12, max: 120 }) * 1000 : faker.number.int({ min: 10, max: 50 }) * 1000;
      const unitCost = p.cost ?? Math.max(100, Math.round(p.price * 0.7));
      total += lineTotal(unitCost, quantityMilli);
      return { id: uuid7(orderedAt), purchaseOrderId: id, productId: p.id, quantityMilli, unitCost };
    });
    const dueAt = faker.datatype.boolean(0.7) ? (receivedAt ?? expectedAt) + faker.helpers.arrayElement([7, 14, 30]) * DAY : null;
    out.orders.push({
      id,
      poNumber: `PO-${1001 + i}`,
      supplierId: supplier.id!,
      status,
      orderedAt,
      expectedAt,
      dueAt,
      receivedAt,
      reference: faker.datatype.boolean(0.6) ? `INV-${faker.string.numeric(5)}` : null,
      note: null,
      total,
      employeeId,
      createdAt: orderedAt,
      updatedAt: receivedAt ?? orderedAt,
    });
    out.lines.push(...lines);

    if (status === 'received') {
      for (const line of lines) {
        const batchId = unnamed.get(line.productId);
        if (batchId) {
          out.movements.push({ id: uuid7(receivedAt!), productId: line.productId, batchId, type: 'receive', quantityMilli: line.quantityMilli, purchaseOrderLineId: line.id, employeeId, at: receivedAt!, note: `Received on PO-${1001 + i}` });
        }
      }
    }

    // Payments: how much of the total is paid, in one or two instalments after the order was placed.
    const share =
      status === 'cancelled'
        ? 0
        : status === 'received'
          ? faker.helpers.arrayElement([1, 1, 1, 0.5, 0.6, 0])
          : faker.helpers.arrayElement([0, 0, 0.3, 0.5]);
    let left = Math.round(total * share);
    const instalments = left > 0 && faker.datatype.boolean(0.4) ? 2 : 1;
    for (let n = 0; n < instalments && left > 0; n++) {
      const amount = n === instalments - 1 ? left : Math.round(left / 2);
      left -= amount;
      const at = Math.min(now - HOUR, orderedAt + faker.number.int({ min: 1, max: 12 }) * DAY + n * DAY);
      if (amount > 0) out.payments.push({ id: uuid7(at), purchaseOrderId: id, amount, method: faker.helpers.arrayElement(PAYMENT_METHODS.filter((m) => m !== 'card')), reference: faker.datatype.boolean(0.5) ? faker.string.alphanumeric({ length: 8, casing: 'upper' }) : null, employeeId, at });
    }
  });
  return out;
}
