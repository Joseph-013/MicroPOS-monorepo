import { inject, Service, signal } from '@angular/core';
import type { RemoveSuppliersResult, SaveSupplierResult, SupplierInput, SupplierRecord } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import type { LoadStatus } from './catalog.service';

/** Suppliers over IPC. Every change refreshes the list so what is owed is never stale. */
@Service()
export class SuppliersService {
  private readonly api = inject(DESKTOP_API);

  readonly suppliers = signal<SupplierRecord[]>([]);
  readonly status = signal<LoadStatus>('idle');
  /** Also list deleted suppliers (the page then shows only those). */
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
      this.suppliers.set(await this.api.suppliers.list({ includeDeleted: this.includeDeleted() }));
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load suppliers', error);
      this.status.set('error');
    }
  }

  /** Creates (no `id`) or updates a supplier and refreshes the list. A rule violation comes back as `ok: false`. */
  async save(id: string | null, input: SupplierInput): Promise<SaveSupplierResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: SaveSupplierResult;
    try {
      result = id ? await this.api.suppliers.update(id, input) : await this.api.suppliers.create(input);
    } catch (error) {
      console.error('Failed to save the supplier', error);
      return { ok: false, field: null, error: 'Could not save the supplier' };
    }
    if (result.ok) await this.load();
    return result;
  }

  /** Removes suppliers; those still owed money or with orders on the way are left alone and named. Null when the call failed. */
  async remove(ids: string[]): Promise<RemoveSuppliersResult | null> {
    if (!this.api) return null;
    try {
      const result = await this.api.suppliers.remove(ids);
      await this.load();
      return result;
    } catch (error) {
      console.error('Failed to delete suppliers', error);
      return null;
    }
  }

  async restore(ids: string[]): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.suppliers.restore(ids);
    } catch (error) {
      console.error('Failed to restore suppliers', error);
      return false;
    }
    await this.load();
    return true;
  }
}
