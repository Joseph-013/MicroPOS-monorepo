import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { formatQuantity, STOCK_CONCERN_KINDS, STOCK_CONCERN_LABELS, type StockConcern, type StockConcernKind } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { InventoryService } from '../../core/data/inventory.service';
import { ProductViewer } from '../../core/product-viewer';
import { FilterInput } from '../../core/ui/filter-input';

const ALL = 'all';
type KindFilter = typeof ALL | StockConcernKind;

/** What needs attention in stock (the Inventory badge): expired and expiring batches, products out of stock or low. A row opens the product. */
@Component({
  host: { class: 'contents' },
  imports: [DatePipe, FilterInput, HlmButtonImports, HlmDialogImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Stock concerns</h3>
    </hlm-dialog-header>

    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <app-filter-input [(value)]="nameFilter" placeholder="Product" label="Filter product" />
      <hlm-select [(value)]="kindFilter" [itemToString]="kindLabel" class="block">
        <hlm-select-trigger class="w-44" aria-label="Filter kind">
          <hlm-select-value />
        </hlm-select-trigger>
        <hlm-select-content *hlmSelectPortal>
          @for (k of kinds; track k) {
            <hlm-select-item [value]="k">{{ kindLabel(k) }}</hlm-select-item>
          }
        </hlm-select-content>
      </hlm-select>
    </div>

    <ul class="divide-border -mx-2 flex min-h-0 flex-col divide-y overflow-y-auto border-y px-2" aria-label="Stock concerns">
      @for (concern of shown(); track $index) {
        <li>
          <button type="button" class="hover:bg-muted/40 grid min-h-(--control-height) w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-2 py-2 text-left" (click)="open(concern.productId)">
            <span class="min-w-0">
              <span class="block truncate text-base">{{ concern.productName }}</span>
              <span class="block truncate text-xs {{ tone(concern.kind) }}">{{ detail(concern) }}</span>
            </span>
            <span class="text-right text-sm {{ tone(concern.kind) }}">{{ kindLabel(concern.kind) }}</span>
          </button>
        </li>
      } @empty {
        <li class="text-muted-foreground py-6 text-center text-sm">{{ all().length ? 'No concerns match' : 'Nothing needs attention' }}</li>
      }
    </ul>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
    </hlm-dialog-footer>
  `,
})
export class StockConcerns {
  private readonly inventory = inject(InventoryService);
  private readonly viewer = inject(ProductViewer);

  protected readonly all = signal<StockConcern[]>([]);
  protected readonly nameFilter = signal('');
  protected readonly kinds: KindFilter[] = [ALL, ...STOCK_CONCERN_KINDS];
  protected readonly kindFilter = signal<KindFilter>(ALL);
  protected readonly kindLabel = (k: KindFilter): string => (k === ALL ? 'All kinds' : STOCK_CONCERN_LABELS[k]);

  protected readonly shown = computed(() => {
    const name = this.nameFilter().trim().toLowerCase();
    const kind = this.kindFilter();
    return this.all().filter((c) => c.productName.toLowerCase().includes(name) && (kind === ALL || c.kind === kind));
  });

  constructor() {
    void this.inventory.concerns().then((list) => this.all.set(list));
  }

  protected tone(kind: StockConcernKind): string {
    return kind === 'expired' || kind === 'out' ? 'text-destructive' : 'text-warning';
  }

  /** "Lot L1 · expired Jun 14 · 4 left", "5 left, critical level 6", "None left". */
  protected detail(c: StockConcern): string {
    const left = (milli: number): string => `${formatQuantity(milli)}${c.unit === 'each' ? '' : ' ' + c.unit}`;
    const date = (ms: number): string => new DatePipe('en-US').transform(ms, 'MMM d, y') ?? '';
    switch (c.kind) {
      case 'expired':
      case 'expiring':
        return [c.batchNumber ? `Lot ${c.batchNumber}` : '', `${c.kind === 'expired' ? 'expired' : 'expires'} ${date(c.expiresAt!)}`, `${left(c.onHandMilli)} left`].filter(Boolean).join(' · ');
      case 'low':
        return `${left(c.onHandMilli)} left, critical level ${left(c.criticalLevelMilli!)}`;
      default:
        return 'None left';
    }
  }

  protected open(productId: string): void {
    void this.viewer.open(productId);
  }
}
