import { inject, Service, signal } from '@angular/core';
import type {
  CancelPurchaseResult,
  PayPurchaseInput,
  PayPurchaseResult,
  PurchaseConcern,
  PurchaseDetail,
  PurchaseInput,
  PurchaseSummary,
  ReceivePurchaseInput,
  ReceivePurchaseResult,
  SavePurchaseResult,
} from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { NavBadges } from '../nav-badges';
import type { LoadStatus } from './catalog.service';

/** Purchase orders over IPC. Every change refreshes the list so what is owed is never stale. */
@Service()
export class PurchasesService {
  private readonly api = inject(DESKTOP_API);
  private readonly badges = inject(NavBadges);

  readonly purchases = signal<PurchaseSummary[]>([]);
  readonly status = signal<LoadStatus>('idle');

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    this.status.set('loading');
    try {
      this.purchases.set(await this.api.purchases.list());
      this.status.set('ready');
      void this.badges.refresh(); // an order arrived or was paid: so may what needs attention
    } catch (error) {
      console.error('Failed to load purchases', error);
      this.status.set('error');
    }
  }

  /** One purchase order with its lines and payments, or null when there is none (or it cannot be read). */
  async get(id: string): Promise<PurchaseDetail | null> {
    try {
      return (await this.api?.purchases.get(id)) ?? null;
    } catch (error) {
      console.error('Failed to load the purchase order', error);
      return null;
    }
  }

  /** Places (no `id`) or changes an order. A rule violation comes back as `ok: false`. */
  async save(id: string | null, input: PurchaseInput): Promise<SavePurchaseResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: SavePurchaseResult;
    try {
      result = id ? await this.api.purchases.update(id, input) : await this.api.purchases.create(input);
    } catch (error) {
      console.error('Failed to save the purchase order', error);
      return { ok: false, field: null, error: 'Could not save the purchase order' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async receive(input: ReceivePurchaseInput): Promise<ReceivePurchaseResult> {
    if (!this.api) return { ok: false, lineId: null, field: null, error: 'Not connected to the database' };
    let result: ReceivePurchaseResult;
    try {
      result = await this.api.purchases.receive(input);
    } catch (error) {
      console.error('Failed to receive the purchase order', error);
      return { ok: false, lineId: null, field: null, error: 'Could not receive the order' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async pay(input: PayPurchaseInput): Promise<PayPurchaseResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: PayPurchaseResult;
    try {
      result = await this.api.purchases.pay(input);
    } catch (error) {
      console.error('Failed to record the payment', error);
      return { ok: false, field: null, error: 'Could not record the payment' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async cancel(id: string): Promise<CancelPurchaseResult> {
    if (!this.api) return { ok: false, error: 'Not connected to the database' };
    let result: CancelPurchaseResult;
    try {
      result = await this.api.purchases.cancel(id);
    } catch (error) {
      console.error('Failed to cancel the purchase order', error);
      return { ok: false, error: 'Could not cancel the order' };
    }
    if (result.ok) await this.load();
    return result;
  }

  /** Orders that are late or overdue for payment (the Purchases badge): empty when it cannot be read. */
  async concerns(): Promise<PurchaseConcern[]> {
    try {
      return (await this.api?.purchases.concerns()) ?? [];
    } catch (error) {
      console.error('Failed to load the purchase concerns', error);
      return [];
    }
  }
}
