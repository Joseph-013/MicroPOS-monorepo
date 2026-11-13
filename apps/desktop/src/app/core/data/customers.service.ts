import { inject, Service, signal } from '@angular/core';
import { type CreditAlertSettings, DEFAULT_CREDIT_ALERTS, DEFAULT_INTEREST_DEFAULTS, type InterestDefaults } from '@micropos/core';
import type {
  CustomerAccount,
  CustomerInput,
  CustomerRecord,
  ReceivePaymentInput,
  ReceivePaymentResult,
  RemoveCustomersResult,
  SaveCustomerResult,
} from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { NavBadges } from '../nav-badges';
import type { LoadStatus } from './catalog.service';

/** Customers and their accounts over IPC. Every change refreshes the list so balances are never stale. */
@Service()
export class CustomersService {
  private readonly api = inject(DESKTOP_API);
  private readonly badges = inject(NavBadges);

  readonly customers = signal<CustomerRecord[]>([]);
  readonly status = signal<LoadStatus>('idle');
  /** What interest starts from for a customer (the factory values until loaded). Needs the permission to manage customers. */
  readonly interestDefaults = signal<InterestDefaults>(DEFAULT_INTEREST_DEFAULTS);
  /** Also list deleted customers (the page then shows only those). */
  readonly includeDeleted = signal(false);

  async setIncludeDeleted(value: boolean): Promise<void> {
    this.includeDeleted.set(value);
    await this.load();
  }

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    this.status.set('loading');
    try {
      this.customers.set(await this.api.customers.list({ includeDeleted: this.includeDeleted() }));
      this.status.set('ready');
      void this.badges.refresh(); // balances changed: so may who needs attention
    } catch (error) {
      console.error('Failed to load customers', error);
      this.status.set('error');
    }
  }

  /** Creates (no `id`) or updates a customer and refreshes the list. A rule violation comes back as `ok: false`. */
  async save(id: string | null, input: CustomerInput): Promise<SaveCustomerResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: SaveCustomerResult;
    try {
      result = id ? await this.api.customers.update(id, input) : await this.api.customers.create(input);
    } catch (error) {
      console.error('Failed to save the customer', error);
      return { ok: false, field: null, error: 'Could not save the customer' };
    }
    if (result.ok) await this.load();
    return result;
  }

  /** Removes customers; those with a balance are left alone and named in the result. Null when the call failed. */
  async remove(ids: string[]): Promise<RemoveCustomersResult | null> {
    if (!this.api) return null;
    try {
      const result = await this.api.customers.remove(ids);
      await this.load();
      return result;
    } catch (error) {
      console.error('Failed to delete customers', error);
      return null;
    }
  }

  async restore(ids: string[]): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.customers.restore(ids);
    } catch (error) {
      console.error('Failed to restore customers', error);
      return false;
    }
    await this.load();
    return true;
  }

  /** A customer with their ledger, or null when there is none (or it cannot be read). */
  async account(id: string): Promise<CustomerAccount | null> {
    try {
      return (await this.api?.customers.account(id)) ?? null;
    } catch (error) {
      console.error('Failed to load the customer account', error);
      return null;
    }
  }

  /** Records money received from a customer and refreshes the list. */
  async receivePayment(input: ReceivePaymentInput): Promise<ReceivePaymentResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: ReceivePaymentResult;
    try {
      result = await this.api.customers.receivePayment(input);
    } catch (error) {
      console.error('Failed to record the payment', error);
      return { ok: false, field: null, error: 'Could not record the payment' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async loadInterestDefaults(): Promise<void> {
    try {
      const defaults = await this.api?.customers.interestDefaults();
      if (defaults) this.interestDefaults.set(defaults);
    } catch (error) {
      console.error('Failed to load the interest defaults', error);
    }
  }

  /** Saves the defaults; false when they could not be saved. */
  async saveInterestDefaults(input: InterestDefaults): Promise<boolean> {
    try {
      if (!(await this.api?.customers.saveInterestDefaults(input))) return false;
    } catch (error) {
      console.error('Failed to save the interest defaults', error);
      return false;
    }
    this.interestDefaults.set(input);
    return true;
  }

  async loadAlertSettings(): Promise<CreditAlertSettings> {
    try {
      return (await this.api?.customers.alertSettings()) ?? DEFAULT_CREDIT_ALERTS;
    } catch (error) {
      console.error('Failed to load the credit alert limits', error);
      return DEFAULT_CREDIT_ALERTS;
    }
  }

  /** Saves the limits and refreshes the badge; false when they could not be saved. */
  async saveAlertSettings(input: CreditAlertSettings): Promise<boolean> {
    try {
      if (!(await this.api?.customers.saveAlertSettings(input))) return false;
    } catch (error) {
      console.error('Failed to save the credit alert limits', error);
      return false;
    }
    void this.badges.refresh();
    return true;
  }
}
