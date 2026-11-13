import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { employees } from './employees';
import { createdAt, id, updatedAt } from './_columns';
import { suppliers } from './suppliers';

/** Ordered: placed with the supplier, stock not here yet. Received: the stock arrived and went into inventory. */
export const PURCHASE_STATUSES = ['ordered', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/**
 * Stock bought from a supplier, often ordered in advance and paid later (or in parts). What is still owed is the
 * total less the payments in `purchase_payments`; a cancelled order owes nothing.
 */
export const purchaseOrders = sqliteTable(
  'purchase_orders',
  {
    id: id(),
    /** Human-readable, sequential, unique: PO-1001, PO-1002, ... */
    poNumber: text().notNull(),
    supplierId: text()
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    status: text({ enum: PURCHASE_STATUSES }).notNull().default('ordered'),
    /** Epoch ms when it was placed. */
    orderedAt: integer().notNull(),
    /** Epoch ms the delivery is promised for; null when unknown. */
    expectedAt: integer(),
    /** Epoch ms payment is due (the supplier's terms); null when there is no date. */
    dueAt: integer(),
    /** Epoch ms the stock was received; set when the status becomes received. */
    receivedAt: integer(),
    /** The supplier's own invoice or order number. */
    reference: text(),
    note: text(),
    /** Cents; the sum of the lines. */
    total: integer().notNull().default(0),
    /** Who placed it; null before sign-in exists. */
    employeeId: text().references(() => employees.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('purchase_orders_po_number_unique').on(t.poNumber),
    index('purchase_orders_supplier_id_idx').on(t.supplierId),
    index('purchase_orders_status_idx').on(t.status),
    index('purchase_orders_ordered_at_idx').on(t.orderedAt),
  ],
);

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
