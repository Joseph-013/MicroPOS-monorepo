import { inject, Service, signal } from '@angular/core';
import type { ProductInput, ProductRecord, RestoreProductsResult, SaveProductResult } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { NavBadges } from '../nav-badges';
import type { LoadStatus } from './catalog.service';

/** Product management over IPC: every live product, active or not. Checkout reads `CatalogService` instead. */
@Service()
export class ProductsService {
  private readonly api = inject(DESKTOP_API);
  private readonly badges = inject(NavBadges);

  readonly products = signal<ProductRecord[]>([]);
  readonly status = signal<LoadStatus>('idle');
  /** Also list deleted products (shown marked, not editable). */
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
      this.products.set(await this.api.products.list({ includeDeleted: this.includeDeleted() }));
      this.status.set('ready');
      void this.badges.refresh(); // a product changed (active, critical level, deleted): so may what needs attention
    } catch (error) {
      console.error('Failed to load products', error);
      this.status.set('error');
    }
  }

  /** One product by id, deleted ones included, whatever the list is showing; undefined when there is none. */
  async find(id: string): Promise<ProductRecord | undefined> {
    const known = this.products().find((p) => p.id === id);
    if (known || !this.api) return known;
    try {
      return (await this.api.products.list({ includeDeleted: true })).find((p) => p.id === id);
    } catch (error) {
      console.error('Failed to look up the product', error);
      return undefined;
    }
  }

  /** Creates (no `id`) or updates a product and refreshes the list. A rule violation comes back as `ok: false`. */
  async save(id: string | null, input: ProductInput): Promise<SaveProductResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: SaveProductResult;
    try {
      result = id ? await this.api.products.update(id, input) : await this.api.products.create(input);
    } catch (error) {
      console.error('Failed to save the product', error);
      return { ok: false, field: null, error: 'Could not save the product' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async remove(ids: string[]): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.products.remove(ids);
    } catch (error) {
      console.error('Failed to delete products', error);
      return false;
    }
    await this.load();
    return true;
  }

  async setActive(ids: string[], active: boolean): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.products.setActive(ids, active);
    } catch (error) {
      console.error('Failed to change product status', error);
      return false;
    }
    await this.load();
    return true;
  }

  /** Undeletes products; the result names any skipped because their code is in use. Null when the call failed. */
  async restore(ids: string[]): Promise<RestoreProductsResult | null> {
    if (!this.api) return null;
    try {
      const result = await this.api.products.restore(ids);
      await this.load();
      return result;
    } catch (error) {
      console.error('Failed to restore products', error);
      return null;
    }
  }
}
