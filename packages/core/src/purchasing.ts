import type { OrderPaymentMethod } from './draft.js';
import type { Money } from './index.js';
import type { ProductTracking } from './inventory.js';

export type SupplierField = 'name' | 'phone' | 'note';

/** What the supplier form sends. Empty text is null. */
export interface SupplierInput {
  name: string;
  phone: string | null;
  note: string | null;
}

/** A supplier with what the store currently owes them across its purchase orders. */
export interface SupplierRecord extends SupplierInput {
  id: string;
  /** Cents still unpaid on orders that are not cancelled. */
  owed: Money;
  /** Orders placed but not yet received. */
  openOrders: number;
  createdAt: number;
  deletedAt: number | null;
}

export type SaveSupplierResult = { ok: true; supplier: SupplierRecord } | { ok: false; field: SupplierField | null; error: string };

/** A supplier we still owe money to, or with orders on the way, cannot be removed; they are named in `blocked`. */
export interface RemoveSuppliersResult {
  removed: number;
  blocked: string[];
}

/**
 * Ordered: placed with the supplier, stock not here yet. Received: the stock arrived and went into inventory.
 * Cancelled: called off before it arrived.
 */
export const PURCHASE_STATUSES = ['ordered', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export type PurchaseField = 'supplier' | 'lines' | 'product' | 'quantity' | 'unitCost' | 'expectedAt' | 'dueAt' | 'reference' | 'note';

export interface PurchaseLineInput {
  productId: string;
  /** Thousandths of the product's unit; positive. */
  quantityMilli: number;
  /** Cents per unit. */
  unitCost: Money;
}

/** What the purchase form sends. Dates are epoch milliseconds; null when not known. */
export interface PurchaseInput {
  supplierId: string;
  expectedAt: number | null;
  dueAt: number | null;
  /** The supplier's own invoice or order number. */
  reference: string | null;
  note: string | null;
  lines: PurchaseLineInput[];
}

export interface PurchaseLineRecord {
  id: string;
  productId: string;
  productName: string;
  /** The product's barcode or PLU, so a scan can find its line. */
  productCode: string | null;
  unit: string;
  tracking: ProductTracking;
  quantityMilli: number;
  /** How much of it has arrived so far (receipts against this line); always 0 for a product that tracks no stock. */
  receivedMilli: number;
  unitCost: Money;
  total: Money;
}

export interface PurchasePaymentRecord {
  id: string;
  amount: Money;
  method: OrderPaymentMethod;
  reference: string | null;
  note: string | null;
  employeeName: string | null;
  at: number;
}

/** One row of the Purchases table. */
export interface PurchaseSummary {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  orderedAt: number;
  expectedAt: number | null;
  dueAt: number | null;
  receivedAt: number | null;
  reference: string | null;
  lineCount: number;
  /** Ordered, with some of it already received (the rest is still to come). */
  partlyReceived: boolean;
  total: Money;
  paid: Money;
  /** Refunds from the supplier for stock sent back, which reduced what is owed. */
  credited: Money;
  /** Total less paid and credited; 0 for a cancelled order. */
  owed: Money;
}

/** A purchase order with its lines and payments (payments newest first). */
export interface PurchaseDetail extends PurchaseSummary {
  note: string | null;
  employeeName: string | null;
  lines: PurchaseLineRecord[];
  payments: PurchasePaymentRecord[];
  /** Stock sent back to the supplier from this order, newest first. */
  returns: SupplierReturnRecord[];
}

export type SavePurchaseResult = { ok: true; purchase: PurchaseDetail } | { ok: false; field: PurchaseField | null; error: string };

/** The batch details of one line being received; lot and expiry only count for products that track them. */
export interface ReceiveLineInput {
  lineId: string;
  /**
   * How much of the line arrives now (thousandths; 0 skips it, never more than is left). Left out, everything still
   * to come of the line arrives.
   */
  quantityMilli?: number;
  batchNumber: string | null;
  expiresAt: number | null;
}

export interface ReceivePurchaseInput {
  purchaseId: string;
  lines: ReceiveLineInput[];
}

/** Receiving writes nothing unless every line is accepted; `lineId` names the line that was not. */
export type ReceivePurchaseResult =
  | { ok: true; purchase: PurchaseDetail }
  | { ok: false; lineId: string | null; field: 'batchNumber' | 'expiresAt' | 'quantity' | null; error: string };

export interface PayPurchaseInput {
  purchaseId: string;
  amount: Money;
  method: OrderPaymentMethod;
  reference: string | null;
}

export type PayPurchaseResult =
  | { ok: true; purchase: PurchaseDetail }
  | { ok: false; field: 'amount' | 'method' | 'reference' | null; error: string };

export type CancelPurchaseResult = { ok: true; purchase: PurchaseDetail } | { ok: false; error: string };

/** Stock sent back to a supplier, usually for a partial refund. */
export interface SupplierReturnRecord {
  id: string;
  at: number;
  supplierName: string;
  /** The order the batch was received on, when known. */
  purchaseNumber: string | null;
  productId: string;
  productName: string;
  unit: string;
  batchNumber: string | null;
  /** Thousandths of the unit that went back. */
  quantityMilli: number;
  /** What the supplier refunds, in cents. */
  refundAmount: Money;
  /** The part of it that reduced what was owed on the order. */
  creditedAmount: Money;
  note: string | null;
  employeeName: string | null;
}

/** Stock going back to a supplier: which batch, how much, and what the supplier refunds (0 for nothing). */
export interface ReturnToSupplierInput {
  batchId: string;
  quantityMilli: number;
  /** Needed only when the batch did not come on a purchase order (the order names its supplier). */
  supplierId: string | null;
  refundAmount: Money;
  note: string | null;
}

export type ReturnToSupplierField = 'quantity' | 'supplier' | 'refundAmount' | 'note';

export type ReturnToSupplierResult =
  | { ok: true; return: SupplierReturnRecord }
  | { ok: false; field: ReturnToSupplierField | null; error: string };
