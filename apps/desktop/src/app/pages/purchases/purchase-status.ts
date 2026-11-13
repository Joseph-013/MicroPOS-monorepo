import type { PurchaseStatus, PurchaseSummary } from '@micropos/core';

export const STATUS_LABELS: Record<PurchaseStatus, string> = { ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' };

export const statusVariant = (status: PurchaseStatus): 'success' | 'destructive' | 'outline' =>
  status === 'received' ? 'success' : status === 'cancelled' ? 'destructive' : 'outline';

/** Still owed money past its due date. */
export const isOverdue = (p: Pick<PurchaseSummary, 'owed' | 'dueAt'>, now = Date.now()): boolean => p.owed > 0 && p.dueAt !== null && p.dueAt < now;
