import type { Permission } from '@micropos/core';
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
    if (!this.api) return this.counts.set({});
    const ask = async (id: string, permission: Permission, read: () => Promise<number>): Promise<[string, number]> => {
      if (!this.auth.can(permission)) return [id, 0];
      try {
        return [id, await read()];
      } catch (error) {
        console.error(`Failed to read the "${id}" badge`, error);
        return [id, this.count(id)];
      }
    };
    const api = this.api;
    const entries = await Promise.all([
      ask('customers', 'customers.view', () => api.customers.alertCount()),
      ask('inventory', 'inventory.manage', async () => (await api.inventory.concerns()).length),
      ask('purchases', 'purchasing.manage', async () => (await api.purchases.concerns()).length),
    ]);
    this.counts.set(Object.fromEntries(entries.filter(([, n]) => n > 0)));
  }
}
