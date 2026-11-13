import type { Permission, PurchaseConcern, StockConcern } from '@micropos/core';
import { DestroyRef, effect, inject, Service, signal } from '@angular/core';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';

/** How often the counts are asked for again (time passing can flag a customer without anything being changed). */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * The small numbers on navigation links, by nav entry id (`NavItem.badge`). An entry with no count, or 0, shows none.
 * To add one: read its count in `refresh` under the entry's id and set `badge` on that entry in the nav rail.
 */
@Service()
export class NavBadges {
  private readonly api = inject(DESKTOP_API);
  private readonly auth = inject(AuthService);

  readonly counts = signal<Readonly<Record<string, number>>>({});
  /**
   * The lists behind the Inventory and Purchases numbers. The concerns dialogs read these, so a dialog left open
   * (or opened over another one) follows every refresh: after a sale, a payment, a delivery, or the periodic check.
   */
  readonly stockConcerns = signal<readonly StockConcern[]>([]);
  readonly purchaseConcerns = signal<readonly PurchaseConcern[]>([]);

  constructor() {
    // Asked for whenever someone signs in (or out), and then every few minutes.
    effect(() => {
      this.auth.user();
      void this.refresh();
    });
    const timer = setInterval(() => void this.refresh(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  count(id: string): number {
    return this.counts()[id] ?? 0;
  }

  /**
   * The counts: customers needing attention (Settings > Credit Alerts), stock needing attention (expired, expiring,
   * out or low) and purchase orders that are late or overdue. Each is only asked for by someone who may see that page.
   */
  async refresh(): Promise<void> {
    if (!this.api) {
      this.stockConcerns.set([]);
      this.purchaseConcerns.set([]);
      return this.counts.set({});
    }
    const api = this.api;
    const ask = async <T>(permission: Permission, read: () => Promise<T>, keep: T): Promise<T> => {
      if (!this.auth.can(permission)) return Array.isArray(keep) ? ([] as unknown as T) : (0 as unknown as T);
      try {
        return await read();
      } catch (error) {
        console.error('Failed to read a navigation badge', error);
        return keep;
      }
    };
    const [customers, stock, purchases] = await Promise.all([
      ask('customers.view', () => api.customers.alertCount(), this.count('customers')),
      ask<readonly StockConcern[]>('inventory.manage', () => api.inventory.concerns(), this.stockConcerns()),
      ask<readonly PurchaseConcern[]>('purchasing.manage', () => api.purchases.concerns(), this.purchaseConcerns()),
    ]);
    this.stockConcerns.set(stock);
    this.purchaseConcerns.set(purchases);
    const counts = { customers, inventory: stock.length, purchases: purchases.length };
    this.counts.set(Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)));
  }
}
