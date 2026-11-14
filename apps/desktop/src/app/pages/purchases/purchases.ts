import { ColumnConfig } from '../../core/ui/column-config';
import { AppCol } from '../../core/ui/table-column.directive';
import { tableLayout } from '../../core/ui/table-columns';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX } from '@ng-icons/lucide';
import type { PurchaseDetail, PurchaseStatus, PurchaseSummary } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { BannerService } from '../../core/banner';
import { PurchasesService } from '../../core/data/purchases.service';
import { MoneyPipe } from '../../core/money.pipe';
import { PurchaseViewer, VIEW_PURCHASE_PARAM } from '../../core/purchase-viewer';
import { HIGHLIGHT_PARAM, rowTarget, scrollToRow } from '../../core/row-target';
import { DateRangeFilter } from '../../core/ui/date-range-filter';
import { FilterInput } from '../../core/ui/filter-input';
import { ConcernsButton } from '../../core/ui/concerns-button';
import { NavBadges } from '../../core/nav-badges';
import { PurchaseConcerns } from './purchase-concerns';
import { AppPager, Pager } from '../../core/ui/pager';
import { PurchaseForm, type PurchaseFormContext } from './purchase-form';
import { isOverdue, STATUS_LABELS, statusText, statusVariant } from './purchase-status';

type SortKey = 'number' | 'supplier' | 'ordered' | 'due' | 'status' | 'total' | 'owed';
type SortDirection = 'asc' | 'desc';

const ALL = 'all';
const STATUS_FILTERS = { [ALL]: 'All', ...STATUS_LABELS } as const;
type StatusFilter = keyof typeof STATUS_FILTERS;
const OWED_FILTERS = { [ALL]: 'All', owed: 'Owed', overdue: 'Overdue', settled: 'Settled' } as const;
type OwedFilter = keyof typeof OWED_FILTERS;

const SORT_VALUES: Record<SortKey, (p: PurchaseSummary) => string | number | null> = {
  number: (p) => Number(p.number.replace(/\D/g, '')),
  supplier: (p) => p.supplierName,
  ordered: (p) => p.orderedAt,
  due: (p) => p.dueAt,
  status: (p) => p.status,
  total: (p) => p.total,
  owed: (p) => p.owed,
};

/** The columns and their widths, shared by the title row, the filter row and every row (an admin may reorder them). */
const COLUMN_DEFS = [
  { key: 'number', label: 'Order', width: 'minmax(6rem,0.8fr)' },
  { key: 'supplier', label: 'Supplier', width: 'minmax(10rem,1.6fr)' },
  { key: 'ordered', label: 'Ordered', width: '10rem' },
  { key: 'due', label: 'Due', width: '9rem' },
  { key: 'status', label: 'Status', width: '7rem' },
  { key: 'total', label: 'Total', width: '8rem' },
  { key: 'owed', label: 'Owed', width: '8rem' },
];

/** Purchases: stock ordered from suppliers, often in advance and paid later. Open one to receive it or record payments. */
@Component({
  imports: [AppCol, ColumnConfig, AppPager, ConcernsButton, DatePipe, DateRangeFilter, FilterInput, MoneyPipe, NgIcon, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmSelectImports],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX })],
  templateUrl: './purchases.html',
})
export class PurchasesPage {
  protected readonly service = inject(PurchasesService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly viewer = inject(PurchaseViewer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly layout = tableLayout('purchases', COLUMN_DEFS);
  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'number', label: 'Order' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'ordered', label: 'Ordered' },
    { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status' },
    { key: 'total', label: 'Total', right: true },
    { key: 'owed', label: 'Owed', right: true },
  ];
  protected readonly statusFilters = Object.keys(STATUS_FILTERS) as StatusFilter[];
  protected readonly statusFilterLabel = (f: StatusFilter): string => STATUS_FILTERS[f] ?? '';
  protected readonly owedFilters = Object.keys(OWED_FILTERS) as OwedFilter[];
  protected readonly owedFilterLabel = (f: OwedFilter): string => OWED_FILTERS[f] ?? '';
  protected readonly statusText = statusText;
  protected readonly statusVariant = statusVariant;
  protected readonly isOverdue = isOverdue;

  // Column filters (second header row); they combine.
  protected readonly numberFilter = signal('');
  protected readonly supplierFilter = signal('');
  protected readonly statusFilter = signal<StatusFilter>(ALL);
  protected readonly owedFilter = signal<OwedFilter>(ALL);
  protected readonly orderedFrom = signal('');
  protected readonly orderedTo = signal('');
  protected readonly filtered = computed(
    () => !!(this.numberFilter() || this.supplierFilter() || this.orderedFrom() || this.orderedTo()) || this.statusFilter() !== ALL || this.owedFilter() !== ALL,
  );

  protected readonly sortKey = signal<SortKey>('ordered');
  protected readonly sortDirection = signal<SortDirection>('desc');

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortKey.set(key);
      this.sortDirection.set(key === 'supplier' || key === 'status' ? 'asc' : 'desc');
    }
  }
  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() !== key ? 'none' : this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  protected readonly visible = computed(() => {
    const number = this.numberFilter().trim().toLowerCase();
    const supplier = this.supplierFilter().trim().toLowerCase();
    const status = this.statusFilter();
    const owed = this.owedFilter();
    const from = this.orderedFrom() ? new Date(`${this.orderedFrom()}T00:00:00`).getTime() : -Infinity;
    const to = this.orderedTo() ? new Date(`${this.orderedTo()}T23:59:59.999`).getTime() : Infinity;
    const now = Date.now();
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: PurchaseSummary, b: PurchaseSummary): number => {
      const x = value(a);
      const y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empty last, whichever direction
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign;
    };
    return this.service
      .purchases()
      .filter(
        (p) =>
          (!number || p.number.toLowerCase().includes(number) || !!p.reference?.toLowerCase().includes(number)) &&
          (!supplier || p.supplierName.toLowerCase().includes(supplier)) &&
          (status === ALL || p.status === (status as PurchaseStatus)) &&
          (owed === ALL || (owed === 'owed' ? p.owed > 0 : owed === 'overdue' ? isOverdue(p, now) : p.owed === 0)) &&
          p.orderedAt >= from &&
          p.orderedAt <= to,
      )
      .sort(compare);
  });

  protected readonly pager = new Pager(
    () => this.visible(),
    () => [this.numberFilter(), this.supplierFilter(), this.statusFilter(), this.owedFilter(), this.orderedFrom(), this.orderedTo(), this.sortKey(), this.sortDirection()],
  );
  /** The order whose dialog is open, or that a link named: highlighted, not selected. */
  protected readonly target = rowTarget();

  /** What is owed across the orders listed (not cancelled). */
  protected readonly owedTotal = computed(() => this.visible().reduce((sum, p) => sum + p.owed, 0));

  protected resetFilters(): void {
    this.numberFilter.set('');
    this.supplierFilter.set('');
    this.statusFilter.set(ALL);
    this.owedFilter.set(ALL);
    this.orderedFrom.set('');
    this.orderedTo.set('');
  }

  protected view(purchase: PurchaseSummary): void {
    void this.viewer.open(purchase.id);
  }
  /** Enter on a focused row opens it (ignored when something already handled the key). */
  protected onRowEnter(event: Event, purchase: PurchaseSummary): void {
    if (!event.defaultPrevented) this.view(purchase);
  }

  /** Orders late or overdue: the same number as the badge on Purchases in the nav rail. */
  private readonly badges = inject(NavBadges);
  protected readonly concerns = computed(() => this.badges.count('purchases'));

  protected showConcerns(): void {
    this.dialogs.open(PurchaseConcerns, { id: 'purchase-concerns', contentClass: 'w-[min(36rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_auto_minmax(0,1fr)_auto]' });
  }

  protected add(): void {
    this.dialogs
      .open<PurchaseDetail | undefined, PurchaseFormContext>(PurchaseForm, {
        id: 'purchase-form',
        contentClass: 'w-[min(40rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: {},
      })
      .closed$.subscribe((placed) => {
        if (!placed) return;
        this.banner.success(`${placed.number} placed`, { key: 'purchase-saved' });
        this.reveal(placed.id);
      });
  }

  /** Rows fade in only after the first load. */
  protected readonly animateRows = signal(false);

  constructor() {
    const loaded = this.service.load();
    effect(() => {
      if (this.service.status() === 'ready') setTimeout(() => this.animateRows.set(true));
    });
    // `?view-purchase=<id>` (its dialog is open) and `?highlight=<id>` (a link from another page) target a row: show
    // the page that holds it and highlight it. `highlight` is then removed from the address. `?supplier=<id>` lists
    // only that supplier's orders.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const highlight = params.get(HIGHLIGHT_PARAM);
      const id = highlight ?? params.get(VIEW_PURCHASE_PARAM);
      const supplier = params.get('supplier');
      void loaded.then(() => {
        if (supplier) this.showSupplier(supplier);
        if (id) this.reveal(id, !!highlight);
      });
    });
  }

  private showSupplier(supplierId: string): void {
    const name = this.service.purchases().find((p) => p.supplierId === supplierId)?.supplierName;
    if (name) this.supplierFilter.set(name);
    void this.router.navigate([], { queryParams: { supplier: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Highlights an order and shows its page; filters that hide it are cleared first. */
  private reveal(id: string, consume = false): void {
    if (consume) void this.router.navigate([], { queryParams: { [HIGHLIGHT_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!this.service.purchases().some((p) => p.id === id)) return;
    this.target.set(id);
    if (!this.pager.showItem((p) => p.id === id)) {
      this.resetFilters();
      this.pager.showItem((p) => p.id === id);
    }
    scrollToRow(id);
  }
}
