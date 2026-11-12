import { faker } from '@faker-js/faker';
import type { NewProductBatch, NewStockMovement, ProductTracking } from '../schema';
import { uuid7 } from '../uuid';

const DAY = 24 * 3_600_000;

interface StockProduct {
  id: string;
  tracking: ProductTracking;
  unit: string;
  cost: number | null;
  shelfLifeDays: number | null;
}

interface SeedBatch {
  id: string;
  productId: string;
  expiresAt: number | null;
  receivedAt: number;
  unitCost: number | null;
  left: number;
}

/**
 * Dummy stock for the tracked products: each gets one to three deliveries before sales start (an old one that has
 * expired by now, one that expires within days, a fresh one), and `allocate` then draws sales out of them
 * first-expiring-first-out, producing the same `sale` movements the app writes. Everything stays consistent: no
 * batch goes below zero, and sold lines carry the cost of the stock they used.
 */
export class SeedStock {
  readonly batches: NewProductBatch[] = [];
  readonly movements: NewStockMovement[] = [];
  private readonly byProduct = new Map<string, SeedBatch[]>();

  constructor(products: StockProduct[], now: number, firstSale: number) {
    const received = firstSale - DAY;
    for (const product of products) {
      if (product.tracking === 'none') continue;
      const weighed = product.unit !== 'each';
      // Whole units, or kilos in tenths; plenty, so seeded sales are rarely short.
      const quantity = (): number => (weighed ? faker.number.int({ min: 400, max: 900 }) * 100 : faker.number.int({ min: 80, max: 240 }) * 1000);
      const shelf = (product.shelfLifeDays ?? 10) * DAY;
      const plan: { expiresAt: number | null; lot: string | null; scale: number }[] =
        product.tracking === 'quantity'
          ? [{ expiresAt: null, lot: null, scale: 1 }]
          : product.tracking === 'batch'
            ? [
                { expiresAt: null, lot: `L${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`, scale: 0.5 },
                { expiresAt: null, lot: `L${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`, scale: 1 },
              ]
            : [
                { expiresAt: now - 3 * DAY, lot: `L${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`, scale: 0.1 },
                { expiresAt: now + 2 * DAY, lot: `L${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`, scale: 0.4 },
                { expiresAt: now + shelf, lot: `L${faker.string.alphanumeric({ length: 5, casing: 'upper' })}`, scale: 1 },
              ];
      const list: SeedBatch[] = [];
      for (const p of plan) {
        const id = uuid7(received);
        const qty = Math.max(weighed ? 1000 : 1000, Math.round((quantity() * p.scale) / (weighed ? 100 : 1000)) * (weighed ? 100 : 1000));
        const unitCost = product.cost;
        this.batches.push({ id, productId: product.id, batchNumber: p.lot, receivedAt: received, expiresAt: p.expiresAt, unitCost, createdAt: received, updatedAt: received });
        this.movements.push({ id: uuid7(received), productId: product.id, batchId: id, type: 'receive', quantityMilli: qty, at: received, note: 'Opening stock' });
        list.push({ id, productId: product.id, expiresAt: p.expiresAt, receivedAt: received, unitCost, left: qty });
      }
      this.byProduct.set(product.id, list);
    }
  }

  /** A refund puts a sold line's stock back into the batches it came from. */
  restock(soldLineId: string, refundLineId: string, at: number): void {
    for (const m of this.movements.filter((x) => x.orderLineId === soldLineId && x.type === 'sale')) {
      this.movements.push({ id: uuid7(at), productId: m.productId, batchId: m.batchId, type: 'refund', quantityMilli: -m.quantityMilli, orderLineId: refundLineId, at });
      const batch = this.byProduct.get(m.productId)?.find((b) => b.id === m.batchId);
      if (batch) batch.left -= m.quantityMilli;
    }
  }

  /** Takes a sale line's quantity out of the batches (never an expired one) and returns the average unit cost used. */
  allocate(productId: string, orderLineId: string, quantityMilli: number, at: number): number | null {
    const list = this.byProduct.get(productId);
    if (!list) return null;
    const usable = list
      .filter((b) => b.left > 0 && (b.expiresAt === null || b.expiresAt > at))
      .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.receivedAt - b.receivedAt);
    let remaining = quantityMilli;
    let costTotal = 0;
    let costQty = 0;
    for (const batch of usable) {
      if (remaining <= 0) break;
      const take = Math.min(batch.left, remaining);
      batch.left -= take;
      remaining -= take;
      this.movements.push({ id: uuid7(at), productId, batchId: batch.id, type: 'sale', quantityMilli: -take, orderLineId, at });
      if (batch.unitCost !== null) {
        costTotal += batch.unitCost * take;
        costQty += take;
      }
    }
    return costQty > 0 ? Math.round(costTotal / costQty) : null;
  }
}
