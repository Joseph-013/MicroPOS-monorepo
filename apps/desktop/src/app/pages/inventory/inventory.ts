import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2 } from '@ng-icons/lucide';
import { type BatchRecord, expiryState, type ExpiryState, formatQuantity } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { BannerService } from '../../core/banner';
import { InventoryService } from '../../core/data/inventory.service';
import { ProductsService } from '../../core/data/products.service';
import { MoneyPipe } from '../../core/money.pipe';
import { DateRangeFilter } from '../../core/ui/date-range-filter';
import { FilterInput } from '../../core/ui/filter-input';
import { SwipeActions, type SwipeAction, type SwipeActionEvent } from '../../core/ui/swipe-actions';
import { AdjustStockForm, type AdjustStockContext } from './adjust-stock-form';
import { ReceiveStockForm, type ReceiveStockContext } from './receive-stock-form';
import { rowTarget } from '../../core/row-target';
import { AppPager, Pager } from '../../core/ui/pager';
import { openRepackage } from './repackage-form';

const STATUSES = { all: 'All', expired: 'Expired', soon: 'Expiring soon', ok: 'OK', none: 'No expiry' } as const;
type Status = keyof typeof STATUSES;

type SortKey = 'product' | 'batch' | 'expires' | 'status' | 'onHand' | 'received' | 'cost' | 'receivedAt';
type SortDirection = 'asc' | 'desc';

/** Order of the status column when sorting: the most urgent first. */
const STATE_RANK: Record<ExpiryState, number> = { expired: 0, soon: 1, ok: 2, none: 3 };

const SORT_VALUES: Record<SortKey, (b: BatchRecord, now: number) => string | number | null> = {
  product: (b) => b.productName,
  batch: (b) => b.batchNumber,
  expires: (b) => b.expiresAt,
  status: (b, now) => STATE_RANK[expiryState(b.expiresAt, now)],
  onHand: (b) => b.onHandMilli,
  received: (b) => b.receivedMilli,
  cost: (b) => b.unitCost,
  receivedAt: (b) => b.receivedAt,
};

/** Column widths shared by the title row, the filter row and every batch row. */
export const COLUMNS_TEMPLATE =
  '3.5rem minmax(12rem,2fr) minmax(8rem,1fr) 13rem 9rem minmax(7rem,.8fr) minmax(7rem,.8fr) minmax(7rem,.8fr) 11rem';

/** Inventory: every batch with stock left, its expiry and quantity; receive, adjust and write off stock. */
@Component({
  imports: [
    AppPager,
    DatePipe,
    DateRangeFilter,
    FilterInput,
    NgIcon,
    MoneyPipe,
    SwipeActions,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmSelectImports,
    HlmSwitchImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2 })],
  templateUrl: './inventory.html',
})
export class InventoryPage {
  protected readonly service = inject(InventoryService);
  private readonly products = inject(ProductsService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly route = inject(ActivatedRoute);

  protected readonly columnsTemplate = COLUMNS_TEMPLATE;
  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'product', label: 'Product' },
    { key: 'batch', label: 'Batch' },
    { key: 'expires', label: 'Expires' },
    { key: 'status', label: 'Status' },
    { key: 'onHand', label: 'On hand', right: true },
    { key: 'received', label: 'Received', right: true },
    { key: 'cost', label: 'Cost', right: true },
    { key: 'receivedAt', label: 'Received on' },
  ];
  protected readonly statuses = Object.keys(STATUSES) as Status[];
  protected readonly statusLabel = (s: Status): string => STATUSES[s] ?? '';
  protected readonly formatQuantity = formatQuantity;

  // Column filters (second header row); they combine.
  protected readonly productFilter = signal('');
  protected readonly batchFilter = signal('');
  protected readonly status = signal<Status>('all');
  /** Expiry date range as `yyyy-mm-dd`, both ends inclusive. */
  protected readonly expiresFrom = signal('');
  protected readonly expiresTo = signal('');
  protected readonly filtered = computed(
    () => !!(this.productFilter() || this.batchFilter() || this.expiresFrom() || this.expiresTo()) || this.status() !== 'all',
  );

  protected readonly sortKey = signal<SortKey>('expires');
  protected readonly sortDirection = signal<SortDirection>('asc');

  /** The moment "now" is measured at; refreshed when the list reloads so badges stay honest. */
  private readonly now = signal(Date.now());

  protected state(batch: BatchRecord): ExpiryState {
    return expiryState(batch.expiresAt, this.now());
  }

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortKey.set(key);
      this.sortDirection.set('asc');
    }
  }
  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() !== key ? 'none' : this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  protected readonly visible = computed(() => {
    const now = this.now();
    const product = this.productFilter().trim().toLowerCase();
    const batch = this.batchFilter().trim().toLowerCase();
    const from = this.expiresFrom() ? new Date(`${this.expiresFrom()}T00:00:00`).getTime() : -Infinity;
    const to = this.expiresTo() ? new Date(`${this.expiresTo()}T23:59:59.999`).getTime() : Infinity;
    const status = this.status();
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: BatchRecord, b: BatchRecord): number => {
      const x = value(a, now);
      const y = value(b, now);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empty last, whichever direction
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return order * sign;
    };
    return this.service
      .batches()
      .filter(
        (b) =>
          (!product || b.productName.toLowerCase().includes(product)) &&
          (!batch || !!b.batchNumber?.toLowerCase().includes(batch)) &&
          (status === 'all' || expiryState(b.expiresAt, now) === status) &&
          (b.expiresAt === null ? !this.expiresFrom() && !this.expiresTo() : b.expiresAt >= from && b.expiresAt <= to),
      )
      .sort(compare);
  });

  // Selection (leftmost column): only rows on screen count.
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly selected = computed(() => this.pager.rows().filter((b) => this.selectedIds().has(b.id)));
  protected readonly allSelected = computed(() => this.pager.rows().length > 0 && this.selected().length === this.pager.rows().length);
  protected readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());
  /** Selected batches that still hold stock: what a write-off can act on. */
  protected readonly selectedWithStock = computed(() => this.selected().filter((b) => b.onHandMilli > 0));

  protected isSelected(batch: BatchRecord): boolean {
    return this.selectedIds().has(batch.id);
  }
  protected toggleRow(batch: BatchRecord, on: boolean): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (on) next.add(batch.id);
      else next.delete(batch.id);
      return next;
    });
  }
  protected toggleAll(on: boolean): void {
    this.selectedIds.set(on ? new Set(this.pager.rows().map((b) => b.id)) : new Set());
  }
  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }
  protected resetFilters(): void {
    this.productFilter.set('');
    this.batchFilter.set('');
    this.status.set('all');
    this.expiresFrom.set('');
    this.expiresTo.set('');
  }

  // Write-off (always confirmed): takes the whole remaining quantity out as expired or waste.
  protected readonly swipeWriteOff: SwipeAction[] = [{ id: 'writeoff', label: 'Write off', icon: 'lucideTrash2', tone: 'destructive' }];
  protected readonly pending = signal<BatchRecord[] | null>(null);
  protected readonly confirmTitle = signal('');

  protected askWriteOff(batches: BatchRecord[]): void {
    const withStock = batches.filter((b) => b.onHandMilli > 0);
    if (withStock.length === 0) return;
    this.confirmTitle.set(withStock.length === 1 ? `Write off ${withStock[0]!.productName}${withStock[0]!.batchNumber ? ' ' + withStock[0]!.batchNumber : ''}?` : `Write off ${withStock.length} batches?`);
    this.pending.set(withStock);
  }

  /** Right-click or swipe: acts on the whole selection when the row is part of one, else on the row. */
  protected targetsFor(row: BatchRecord): BatchRecord[] {
    return this.isSelected(row) && this.selectedWithStock().length > 1 ? this.selectedWithStock() : [row];
  }
  protected onSwipe(_event: SwipeActionEvent, row: BatchRecord): void {
    this.askWriteOff(this.targetsFor(row));
  }
  protected batchById(id: string): BatchRecord | undefined {
    return this.service.batches().find((b) => b.id === id);
  }

  protected async confirmWriteOff(): Promise<void> {
    const batches = this.pending();
    this.pending.set(null);
    if (!batches) return;
    let failed = 0;
    for (const batch of batches) {
      const expired = expiryState(batch.expiresAt, Date.now()) === 'expired';
      const result = await this.service.adjust({
        batchId: batch.id,
        type: expired ? 'expired' : 'waste',
        quantityMilli: batch.onHandMilli,
        note: 'Written off',
      });
      if (!result.ok) failed++;
    }
    void this.products.load();
    const written = batches.length - failed;
    if (failed) this.banner.warning(`${written} written off, ${failed} could not be`, { key: 'inventory-bulk', duration: 'long' });
    else this.banner.success(`${written === 1 ? '1 batch' : `${written} batches`} written off`, { key: 'inventory-bulk' });
    const ids = batches.map((b) => b.id);
    this.selectedIds.update((current) => new Set([...current].filter((id) => !ids.includes(id))));
  }

  protected readonly pager = new Pager(
    () => this.visible(),
    () => [this.productFilter(), this.batchFilter(), this.status(), this.expiresFrom(), this.expiresTo(), this.sortKey(), this.sortDirection(), this.service.includeEmpty()],
  );
  /** The batch a dialog is open for: highlighted, not selected. */
  protected readonly target = rowTarget();

  protected receive(): void {
    this.dialogs.open<boolean, ReceiveStockContext>(ReceiveStockForm, {
      id: 'receive-stock',
      contentClass: 'w-[min(34rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: {},
    }).closed$.subscribe((saved) => {
      if (saved) this.banner.success('Stock received', { key: 'inventory-saved' });
    });
  }

  /** Opens the Repackage dialog, for the batch's product when started from a row. */
  protected repackage(batch?: BatchRecord): void {
    if (batch) this.target.set(batch.id);
    void openRepackage(this.dialogs, this.banner, this.service, batch && this.products.products().find((p) => p.id === batch.productId));
  }

  protected adjust(batch: BatchRecord): void {
    this.target.set(batch.id);
    this.dialogs.open<boolean, AdjustStockContext>(AdjustStockForm, {
      id: 'adjust-stock',
      contentClass: 'w-[min(30rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { batch },
    }).closed$.subscribe((saved) => {
      if (saved) this.banner.success('Stock updated', { key: 'inventory-saved' });
    });
  }

  protected toggleEmpty(on: boolean): void {
    this.clearSelection();
    void this.service.setIncludeEmpty(on);
  }

  constructor() {
    // The overview links here with a status (`?status=expired`) already filtered.
    const wanted = this.route.snapshot.queryParamMap.get('status');
    if (wanted && wanted in STATUSES) this.status.set(wanted as Status);
    void this.service.load();
    void this.products.load(); // the receive form lists tracked products
    // Badges are measured against the moment the list was loaded.
    effect(() => {
      this.service.batches();
      this.now.set(Date.now());
    });
  }
}
