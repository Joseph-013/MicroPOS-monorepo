import { inject, Service } from '@angular/core';
import type { ProductDraft } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';

const SAVE_DELAY_MS = 300;

/**
 * Keeps a half-filled product form saved in the local database, one draft per form (`new`, or a product id when
 * editing). `save` is debounced; `flush` writes at once (call it when the form closes so the last keystroke is kept).
 */
@Service()
export class ProductDraftService {
  private readonly api = inject(DESKTOP_API);
  private pending = new Map<string, ProductDraft>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  async load(form: string): Promise<ProductDraft | null> {
    try {
      return (await this.api?.products.loadDraft(form)) ?? null;
    } catch (error) {
      console.error('Failed to load the saved product form', error);
      return null;
    }
  }

  save(form: string, draft: ProductDraft): void {
    this.pending.set(form, draft);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    clearTimeout(this.timer);
    for (const [form, draft] of this.pending) {
      this.api?.products.saveDraft(form, draft).catch((error: unknown) => console.error('Failed to save the product form', error));
    }
    this.pending.clear();
  }

  /** Discards the saved draft right away (and any save of it still waiting). */
  clear(form: string): void {
    this.pending.delete(form);
    this.api?.products.clearDraft(form).catch((error: unknown) => console.error('Failed to clear the product form draft', error));
  }
}
