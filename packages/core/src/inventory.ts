import type { Money } from './index.js';

/**
 * How stock is tracked for a product: not at all, as one quantity, by batch (lot number), or by batch with an
 * expiry date. The levels build on each other.
 */
export const PRODUCT_TRACKING = ['none', 'quantity', 'batch', 'expiry'] as const;
export type ProductTracking = (typeof PRODUCT_TRACKING)[number];

export const tracksStock = (tracking: ProductTracking): boolean => tracking !== 'none';
/** Each delivery has its own lot number. */
export const tracksBatches = (tracking: ProductTracking): boolean => tracking === 'batch' || tracking === 'expiry';
export const tracksExpiry = (tracking: ProductTracking): boolean => tracking === 'expiry';

/** Why stock moved (see the stock ledger). */
export const STOCK_ADJUSTMENTS = ['adjust', 'waste', 'expired'] as const;
export type StockAdjustmentType = (typeof STOCK_ADJUSTMENTS)[number];

/** Days before expiry when a batch counts as "expiring soon". */
export const EXPIRY_WARN_DAYS = 3;
const DAY_MS = 86_400_000;

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';

/** Where a batch stands against its expiry date: no date, fine, within the warning window, or past. */
export function expiryState(expiresAt: number | null, now: number = Date.now()): ExpiryState {
  if (expiresAt === null) return 'none';
  if (expiresAt <= now) return 'expired';
  return expiresAt - now <= EXPIRY_WARN_DAYS * DAY_MS ? 'soon' : 'ok';
}

/** One delivery of a product with how much of it is left. */
export interface BatchRecord {
  id: string;
  productId: string;
  productName: string;
  /** The product's code (barcode or PLU), to find it by scanning. */
  productCode: string | null;
  unit: string;
  tracking: ProductTracking;
  /** Null for the single unnamed batch of a quantity-only product. */
  batchNumber: string | null;
  /** Epoch milliseconds. */
  receivedAt: number;
  expiresAt: number | null;
  unitCost: Money | null;
  /** The product's selling price (per unit), for the retail value of what is on hand. */
  unitPrice: Money;
  /** Thousandths of the unit. */
  receivedMilli: number;
  onHandMilli: number;
}

/** Stock arriving. Lot number and expiry apply only when the product's tracking asks for them. */
export interface ReceiveStockInput {
  productId: string;
  batchNumber: string | null;
  expiresAt: number | null;
  /** Thousandths of the unit; positive. */
  quantityMilli: number;
  unitCost: Money | null;
  note: string | null;
}

/**
 * Taking stock out or correcting a count. `waste` and `expired` remove `quantityMilli` (a positive amount);
 * `adjust` adds it when positive and removes it when negative.
 */
export interface AdjustStockInput {
  batchId: string;
  type: StockAdjustmentType;
  quantityMilli: number;
  note: string | null;
}

export type StockField = 'product' | 'batchNumber' | 'expiresAt' | 'quantity' | 'unitCost' | 'note';

export type StockResult = { ok: true; batch: BatchRecord } | { ok: false; field: StockField | null; error: string };

/**
 * Opening a pack: `quantityMilli` of the source product (a whole sack, a case) is taken out of its batches,
 * first-expiring-first-out, and the `targets` are put in (loose kilos, smaller bags). Each side is typed in its own
 * unit, so a loss (spillage) is simply a smaller target quantity.
 */
export interface RepackageInput {
  /** The product being opened. */
  productId: string;
  /** Thousandths of the source's unit; positive. */
  quantityMilli: number;
  targets: RepackageTarget[];
  note: string | null;
}

export interface RepackageTarget {
  productId: string;
  /** Thousandths of the target's unit; positive. */
  quantityMilli: number;
  /** Used only when the source batch has no expiry date but the target product tracks expiry. */
  expiresAt: number | null;
}

export type RepackageField = 'source' | 'quantity' | 'targets' | 'note';

export type RepackageResult = { ok: true; repackageId: string } | { ok: false; field: RepackageField | null; error: string };

/** A half-filled Repackage form, kept so closing the dialog or restarting loses nothing. Values are as typed. */
export interface RepackageDraft {
  productId: string | null;
  quantity: string;
  targets: { productId: string | null; quantity: string; expiry: string }[];
  note: string;
}

/** One entry of the stock ledger, as shown in recent activity. */
export interface MovementRecord {
  id: string;
  at: number;
  type: string;
  productName: string;
  unit: string;
  batchNumber: string | null;
  /** Thousandths of the unit; positive added stock, negative removed it. */
  quantityMilli: number;
  note: string | null;
}

/** The numbers behind the Inventory overview page. Money is in cents. */
export interface InventoryOverview {
  /** Products whose stock is tracked, and how many of those have none left. */
  trackedProducts: number;
  /** How many tracked products have no stock left, and the first few of them by name. */
  outOfStockCount: number;
  outOfStockProducts: { id: string; name: string }[];
  /** Value of everything on hand: at what it cost, and at what it sells for. */
  stockValueCost: Money;
  stockValueRetail: Money;
  /** Batches that still hold stock and are past their expiry date, with the cost of what is in them. */
  expired: { batches: number; valueCost: Money };
  /** The same for batches expiring within `EXPIRY_WARN_DAYS`. */
  expiringSoon: { batches: number; valueCost: Money };
  /** What was written off as waste or expired in the last 30 days, at cost. */
  wasteLast30Days: { entries: number; valueCost: Money };
  /** The worst batches first: expired, then soonest to expire (at most 8). */
  attention: BatchRecord[];
  recentMovements: MovementRecord[];
}
