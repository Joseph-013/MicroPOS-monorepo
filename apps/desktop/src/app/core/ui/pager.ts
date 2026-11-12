import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideChevronsLeft, lucideChevronsRight } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSelectImports } from '@spartan-ng/helm/select';

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Offset paging over a list that is already filtered and sorted: page `n` is rows `n * size` up to `(n + 1) * size`.
 * `resetKey` is read inside an effect; whenever it changes (a filter or the sort) the table goes back to page 1.
 * Create it as a field of a component (it needs an injection context for that effect).
 */
export class Pager<T> {
  readonly pageSize = signal<number>(DEFAULT_PAGE_SIZE);
  private readonly requested = signal(0);

  readonly total = computed(() => this.items().length);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  /** Zero-based, kept inside the list when it shrinks. */
  readonly page = computed(() => Math.min(this.requested(), this.pageCount() - 1));
  /** The rows on the current page. */
  readonly rows = computed(() => this.items().slice(this.page() * this.pageSize(), (this.page() + 1) * this.pageSize()));
  /** One-based position of the first and last row shown ("26-50 of 120"); 0 when empty. */
  readonly first = computed(() => (this.total() ? this.page() * this.pageSize() + 1 : 0));
  readonly last = computed(() => this.page() * this.pageSize() + this.rows().length);

  private lastKey: string | null = null;
  /** The reset key `showItem` was called under: that change of filters must not send the table back to page 1. */
  private shownKey: string | null = null;

  constructor(
    private readonly items: () => T[],
    private readonly resetKey: () => unknown,
  ) {
    effect(() => {
      const key = this.keyNow();
      untracked(() => {
        const first = this.lastKey === null;
        if (key === this.lastKey) return;
        this.lastKey = key;
        if (!first && key !== this.shownKey) this.requested.set(0);
      });
    });
  }

  private keyNow(): string {
    return JSON.stringify([this.resetKey(), this.pageSize()]);
  }

  goTo(page: number): void {
    this.requested.set(Math.max(0, Math.min(page, this.pageCount() - 1)));
  }
  setPageSize(size: number): void {
    this.pageSize.set(size);
  }

  /** Shows the page that holds the first item matching `match`; false when none does. */
  showItem(match: (item: T) => boolean): boolean {
    const index = this.items().findIndex(match);
    if (index < 0) return false;
    this.shownKey = untracked(() => this.keyNow());
    this.requested.set(Math.floor(index / this.pageSize()));
    return true;
  }
}

/** The footer of a table: which rows are shown, the page size, and first / previous / next / last. */
@Component({
  selector: 'app-pager',
  imports: [NgIcon, HlmButtonImports, HlmSelectImports],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideChevronsLeft, lucideChevronsRight })],
  template: `
    @if (pager().total() > 0) {
      <footer class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-sm [--control-height:var(--control-height-sm)]">
        <span class="text-muted-foreground" aria-live="polite">{{ pager().first() }}–{{ pager().last() }} of {{ pager().total() }}</span>
        <div class="flex items-center gap-3">
          <hlm-select [value]="pager().pageSize()" (valueChange)="pager().setPageSize($event ?? pager().pageSize())" [itemToString]="sizeLabel">
            <hlm-select-trigger size="sm" class="w-28" aria-label="Rows per page">
              <hlm-select-value />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (size of sizes; track size) {
                <hlm-select-item [value]="size">{{ sizeLabel(size) }}</hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select>
          <div class="flex items-center gap-1">
            <button hlmBtn variant="outline" size="icon" type="button" aria-label="First page" [disabled]="pager().page() === 0" (click)="pager().goTo(0)">
              <ng-icon name="lucideChevronsLeft" size="18" />
            </button>
            <button hlmBtn variant="outline" size="icon" type="button" aria-label="Previous page" [disabled]="pager().page() === 0" (click)="pager().goTo(pager().page() - 1)">
              <ng-icon name="lucideChevronLeft" size="18" />
            </button>
            <span class="min-w-24 text-center">Page {{ pager().page() + 1 }} of {{ pager().pageCount() }}</span>
            <button hlmBtn variant="outline" size="icon" type="button" aria-label="Next page" [disabled]="pager().page() >= pager().pageCount() - 1" (click)="pager().goTo(pager().page() + 1)">
              <ng-icon name="lucideChevronRight" size="18" />
            </button>
            <button hlmBtn variant="outline" size="icon" type="button" aria-label="Last page" [disabled]="pager().page() >= pager().pageCount() - 1" (click)="pager().goTo(pager().pageCount() - 1)">
              <ng-icon name="lucideChevronsRight" size="18" />
            </button>
          </div>
        </div>
      </footer>
    }
  `,
})
export class AppPager {
  readonly pager = input.required<Pager<unknown>>();
  protected readonly sizes = PAGE_SIZES;
  protected readonly sizeLabel = (size: number): string => `${size} rows`;
}
