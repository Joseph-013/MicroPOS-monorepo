import type { OrderPaymentMethod } from './draft.js';
import type { InterestMode } from './credit-interest.js';
import type { Money } from './index.js';

export type CustomerField = 'name' | 'phone' | 'note' | 'creditLimit' | 'interest';

/** What the customer form sends. Empty text is null; money is integer cents. */
export interface CustomerInput {
  name: string;
  phone: string | null;
  note: string | null;
  /** The most the customer may owe at once, in cents; null for no limit. */
  creditLimit: Money | null;
  /** Interest on what they owe; null for none (most customers). */
  interestMode: InterestMode | null;
  /** Monthly rate in basis points (300 = 3%); set exactly when `interestMode` is. */
  interestRateBp: number | null;
}

/** A customer with what they currently owe. */
export interface CustomerRecord extends CustomerInput {
  id: string;
  /** Cents the customer owes the store; negative when the store owes them (for example after a refund of something already paid off). */
  balance: Money;
  /** Epoch milliseconds of the latest ledger entry, or null when there is none. */
  lastActivityAt: number | null;
  /** When interest was switched on (it is only charged from then); null without interest. */
  interestStartedAt: number | null;
  createdAt: number;
  deletedAt: number | null;
}

export type SaveCustomerResult = { ok: true; customer: CustomerRecord } | { ok: false; field: CustomerField | null; error: string };

/** Customers with a balance cannot be removed; they are named in `blocked`. */
export interface RemoveCustomersResult {
  removed: number;
  blocked: string[];
}

export const CUSTOMER_LEDGER_TYPES = ['charge', 'payment', 'refund', 'void', 'adjustment', 'interest'] as const;
export type CustomerLedgerType = (typeof CUSTOMER_LEDGER_TYPES)[number];

/** One line of a customer's account. */
export interface LedgerEntryRecord {
  id: string;
  type: CustomerLedgerType;
  /** Cents; positive adds to what the customer owes, negative reduces it. */
  amount: Money;
  /** What they owed right after this entry. */
  balanceAfter: Money;
  orderId: string | null;
  orderNumber: string | null;
  method: OrderPaymentMethod | null;
  reference: string | null;
  note: string | null;
  employeeName: string | null;
  at: number;
}

/** A customer and their ledger, newest entry first. */
export interface CustomerAccount {
  customer: CustomerRecord;
  entries: LedgerEntryRecord[];
}

/** Money the customer hands over towards what they owe. */
export interface ReceivePaymentInput {
  customerId: string;
  amount: Money;
  method: OrderPaymentMethod;
  reference: string | null;
}

export type ReceivePaymentResult =
  | { ok: true; /** What the customer owes afterwards. */ balance: Money }
  | { ok: false; field: 'amount' | 'method' | 'reference' | null; error: string };
