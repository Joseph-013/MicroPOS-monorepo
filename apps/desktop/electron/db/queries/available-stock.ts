import type { AppDatabase } from '../index';
import { listBatches } from './inventory';

/**
 * What can be sold now of each product asked about: the stock in batches that have not expired (what a sale may take,
 * see `allocateSale`). null for a product whose stock is not tracked or that does not exist. Read-only.
 */
export function availableStock(db: AppDatabase, productIds: unknown, now = Date.now()): { productId: string; availableMilli: number | null }[] {
  if (!Array.isArray(productIds)) return [];
  const ids = [...new Set(productIds.filter((id): id is string => typeof id === 'string'))].slice(0, 500);
  if (!ids.length) return [];
  const tracking = new Map(
    (db.$client.prepare(`SELECT id, tracking FROM products WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; tracking: string }[]).map((p) => [p.id, p.tracking]),
  );
  const sellable = new Map<string, number>();
  for (const b of listBatches(db)) if (b.expiresAt === null || b.expiresAt > now) sellable.set(b.productId, (sellable.get(b.productId) ?? 0) + b.onHandMilli);
  return ids.map((productId) => {
    const mode = tracking.get(productId);
    return { productId, availableMilli: !mode || mode === 'none' ? null : sellable.get(productId) ?? 0 };
  });
}
