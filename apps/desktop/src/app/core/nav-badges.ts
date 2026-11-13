import type { Permission, PurchaseConcern, StockConcern } from '@micropos/core';
import { DestroyRef, effect, inject, Service, signal, untracked } from '@angular/core';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';

/**
 * A slow safety net only: the main process announces every change (`data.onChanged`), including the moments when
 * time alone makes something a concern, so nothing depends on this timer.
 */
const SAFETY_REFRESH_MS = 30 * 60 * 1000;
/** Announcements that arrive together (a sale touches customers and stock) become one refresh. */
const COALESCE_MS = 100;

/**
 * The small numbers on navigation links, by nav entry id (`NavItem.badge`). An entry with no count, or 0, shows none.
 * They refresh when the main process says the data changed, and on sign-in.
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
    // Asked for whenever someone signs in (or out). Untracked: refresh reads the lists it is about to replace, and
    // tracking those would make every refresh start another.
    effect(() => {
      this.auth.user();
      untracked(() => void this.refresh());
    });
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stopListening = this.api?.data?.onChanged(() => {
      clearTimeout(pending);
      pending = setTimeout(() => void this.refresh(), COALESCE_MS);
    });
    const timer = setInterval(() => void this.refresh(), SAFETY_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(pending);
      stopListening?.();
    });
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
