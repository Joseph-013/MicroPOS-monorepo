import { inject, Service, signal } from '@angular/core';
import type { OrderActionResult, SalesOrderDetail, SalesOrderSummary } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import type { LoadStatus } from './catalog.service';

/** Recorded sales orders over IPC (orders are created by Checkout and never edited here). */
@Service()
export class OrdersService {
  private readonly api = inject(DESKTOP_API);

  readonly orders = signal<SalesOrderSummary[]>([]);
  readonly status = signal<LoadStatus>('idle');

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    this.status.set('loading');
    try {
      this.orders.set(await this.api.orders.list());
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load sales orders', error);
      this.status.set('error');
    }
  }

  /** Voids or refunds one completed order. The list is not refreshed here: `OrderActions` does that once per batch. */
  async reverse(kind: 'void' | 'refund', orderId: string, reason: string): Promise<OrderActionResult> {
    if (!this.api) return { ok: false, error: 'Not connected to the database' };
    try {
      return await this.api.orders[kind]({ orderId, reason });
    } catch (error) {
      console.error(`Could not ${kind} the order`, error);
      return { ok: false, error: `Could not ${kind} the order` };
    }
  }

  /** One order with its lines and payments; null when it does not exist or cannot be read. */
  async get(id: string): Promise<SalesOrderDetail | null> {
    try {
      return (await this.api?.orders.get(id)) ?? null;
    } catch (error) {
      console.error('Failed to load the sales order', error);
      return null;
    }
  }
}
