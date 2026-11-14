import type { OrderPaymentMethod } from './draft.js';
import type { Money } from './index.js';

/**
 * The cash drawer. A **session** runs from counting the starting cash (the float) to counting what is in the drawer
 * at the end; in between, cash that is not a sale goes in or out as **movements**. When it is closed, what the
 * drawer should hold (computed from the records) is compared with what was counted.
 */

export const CASH_MOVEMENT_TYPES = ['in', 'out'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const MAX_CASH_REASON = 100;
export const MAX_CASH_NOTE = 200;

export interface CashMovementRecord {
  id: string;
  type: CashMovementType;
  /** Cents, always positive; `type` says which way. */
  amount: Money;
  reason: string;
  employeeName: string | null;
  at: number;
}

export interface CashSessionRecord {
  id: string;
  openedAt: number;
  openedBy: string | null;
  openingFloat: Money;
  closedAt: number | null;
  closedBy: string | null;
  /** What was counted at closing; null while open. */
  countedCash: Money | null;
  /** What the records said the drawer should hold, fixed when it was closed; null while open. */
  expectedCash: Money | null;
  /** Counted minus expected: negative is short, positive is over; null while open. */
  variance: Money | null;
  note: string | null;
}

/** The drawer as the person at the till sees it: no expected amount while it is open, so the count is made blind. */
export interface CashDrawerState {
  /** The open session, or null when the drawer is closed. */
  session: Omit<CashSessionRecord, 'expectedCash' | 'variance' | 'countedCash' | 'closedAt' | 'closedBy'> | null;
  movements: CashMovementRecord[];
  /** The session closed last, to show how it ended. */
  lastClosed: CashSessionRecord | null;
}

export interface OpenDrawerInput {
  openingFloat: Money;
}
export interface CashMovementInput {
  type: CashMovementType;
  amount: Money;
  reason: string;
}
export interface CloseDrawerInput {
  countedCash: Money;
  note: string | null;
}

export type CashField = 'openingFloat' | 'amount' | 'reason' | 'countedCash' | 'note';
export type CashResult<T> = { ok: true; value: T } | { ok: false; field: CashField | null; error: string };

/** The parts that make up the cash that came in or went out over a stretch of time. Money in cents; out is positive too. */
export interface CashFlow {
  /** Cash taken for sales, less cash given back for refunds and voids. */
  sales: Money;
  /** Cash customers paid towards what they owe. */
  customerPayments: Money;
  /** Cash paid to suppliers. */
  supplierPayments: Money;
  /** Cash put in and taken out by hand (paid in, paid out, drops). */
  movementsIn: Money;
  movementsOut: Money;
}

/** What the net movement of cash was: everything in, less everything out. */
export const cashFlowNet = (flow: CashFlow): Money => flow.sales + flow.customerPayments - flow.supplierPayments + flow.movementsIn - flow.movementsOut;

/** What the drawer should hold: the float plus the net movement. */
export const expectedCash = (openingFloat: Money, flow: CashFlow): Money => openingFloat + cashFlowNet(flow);

export const PAYMENT_METHOD_ORDER: readonly OrderPaymentMethod[] = ['cash', 'card', 'ewallet', 'bank_transfer', 'other'];
