import { inject, Service, signal } from '@angular/core';
import type { CategoryInput, CategoryRecord, RestoreCategoriesResult, SaveCategoryResult } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import type { LoadStatus } from './catalog.service';

/** Category management over IPC. Checkout and the product form read `CatalogService` for the live list instead. */
@Service()
export class CategoriesService {
  private readonly api = inject(DESKTOP_API);

  readonly categories = signal<CategoryRecord[]>([]);
  readonly status = signal<LoadStatus>('idle');
  /** Also list deleted categories (the page then shows only those). */
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
      this.categories.set(await this.api.categories.list({ includeDeleted: this.includeDeleted() }));
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load categories', error);
      this.status.set('error');
    }
  }

  /** Creates (no `id`) or updates a category and refreshes the list. A rule violation comes back as `ok: false`. */
  async save(id: string | null, input: CategoryInput): Promise<SaveCategoryResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: SaveCategoryResult;
    try {
      result = id ? await this.api.categories.update(id, input) : await this.api.categories.create(input);
    } catch (error) {
      console.error('Failed to save the category', error);
      return { ok: false, field: null, error: 'Could not save the category' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async remove(ids: string[]): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.categories.remove(ids);
    } catch (error) {
      console.error('Failed to delete categories', error);
      return false;
    }
    await this.load();
    return true;
  }

  /** Undeletes categories; the result names any skipped because the name is in use. Null when the call failed. */
  async restore(ids: string[]): Promise<RestoreCategoriesResult | null> {
    if (!this.api) return null;
    try {
      const result = await this.api.categories.restore(ids);
      await this.load();
      return result;
    } catch (error) {
      console.error('Failed to restore categories', error);
      return null;
    }
  }
}
