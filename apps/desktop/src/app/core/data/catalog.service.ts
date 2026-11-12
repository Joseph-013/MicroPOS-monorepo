import { inject, Service, signal } from '@angular/core';
import type { CatalogCategory, CatalogProduct } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Products and categories from the local database, loaded over IPC. */
@Service()
export class CatalogService {
  private readonly api = inject(DESKTOP_API);

  readonly products = signal<CatalogProduct[]>([]);
  readonly categories = signal<CatalogCategory[]>([]);
  readonly status = signal<LoadStatus>('idle');

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    this.status.set('loading');
    try {
      const [products, categories] = await Promise.all([
        this.api.catalog.listProducts(),
        this.api.catalog.listCategories(),
      ]);
      this.products.set(products);
      this.categories.set(categories);
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load the catalog', error);
      this.status.set('error');
    }
  }

  /** Exact match on barcode (or PLU) or SKU (what a scanner or a typed code identifies). */
  findByCode(code: string): CatalogProduct | undefined {
    return this.products().find((p) => p.barcode === code || p.sku === code);
  }
}
