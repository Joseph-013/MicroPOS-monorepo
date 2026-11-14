import { ColumnConfig } from '../../core/ui/column-config';
import { AppCol } from '../../core/ui/table-column.directive';
import { tableLayout } from '../../core/ui/table-columns';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideEllipsisVertical, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 } from '@ng-icons/lucide';
import type { SupplierRecord } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { BannerService } from '../../core/banner';
import { SuppliersService } from '../../core/data/suppliers.service';
import { MoneyPipe } from '../../core/money.pipe';
import { HIGHLIGHT_PARAM, rowTarget, scrollToRow } from '../../core/row-target';
import { ConfirmItems, type ConfirmItem } from '../../core/ui/confirm-items';
import { FilterInput } from '../../core/ui/filter-input';
import { AppPager, Pager } from '../../core/ui/pager';
import { RowSelection } from '../../core/ui/row-selection';
import { SupplierForm, type SupplierFormContext } from './supplier-form';

type SortKey = 'name' | 'phone' | 'open' | 'owed';
type SortDirection = 'asc' | 'desc';
type BulkKind = 'delete' | 'restore';

const ALL = 'all';
const BALANCE_FILTERS = { [ALL]: 'All', owed: 'We owe', settled: 'Settled' } as const;
type BalanceFilter = keyof typeof BALANCE_FILTERS;

const SORT_VALUES: Record<SortKey, (s: SupplierRecord) => string | number | null> = {
  name: (s) => s.name,
  phone: (s) => s.phone,
  open: (s) => s.openOrders,
  owed: (s) => s.owed,
};

/** The columns and their widths, shared by the title row, the filter row and every row (an admin may reorder them). */
const COLUMN_DEFS = [
  { key: 'name', label: 'Name', width: 'minmax(12rem,2fr)' },
  { key: 'phone', label: 'Phone', width: 'minmax(8rem,1fr)' },
  { key: 'open', label: 'On order', width: '8rem' },
  { key: 'owed', label: 'We owe', width: '10rem' },
];

/** Suppliers: who the store buys from and what is still owed to each. Their purchase orders are on the Purchases page. */
@Component({
  imports: [
    AppCol, ColumnConfig, AppPager,
    ConfirmItems,
    FilterInput,
    MoneyPipe,
    NgIcon,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmSelectImports,
    HlmSwitchImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideEllipsisVertical, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 })],
  templateUrl: './suppliers.html',
})
export class SuppliersPage {
  protected readonly service = inject(SuppliersService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly layout = tableLayout('suppliers', COLUMN_DEFS, '3.5rem');
  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'open', label: 'On order', right: true },
    { key: 'owed', label: 'We owe', right: true },
  ];
  protected readonly balanceFilters = Object.keys(BALANCE_FILTERS) as BalanceFilter[];
  protected readonly balanceFilterLabel = (f: BalanceFilter): string => BALANCE_FILTERS[f] ?? '';

  // Column filters (second header row); they combine.
  protected readonly nameFilter = signal('');
  protected readonly phoneFilter = signal('');
  protected readonly balanceFilter = signal<BalanceFilter>(ALL);
  protected readonly filtered = computed(
    () => !!(this.nameFilter() || this.phoneFilter()) || this.balanceFilter() !== ALL,
  );

  protected readonly sortKey = signal<SortKey>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortKey.set(key);
      this.sortDirection.set(key === 'owed' || key === 'open' ? 'desc' : 'asc');
    }
  }
  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() !== key ? 'none' : this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  /** Deleted only: lists just the deleted suppliers (the others are hidden), so they can be restored. */
  protected readonly deletedOnly = signal(false);

  protected readonly visible = computed(() => {
    const name = this.nameFilter().trim().toLowerCase();
    const phone = this.phoneFilter().trim().toLowerCase();
    const balance = this.balanceFilter();
    const deletedOnly = this.deletedOnly();
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: SupplierRecord, b: SupplierRecord): number => {
      const x = value(a);
      const y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empty last, whichever direction
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign;
    };
    return this.service
      .suppliers()
      .filter(
        (c) =>
          !!c.deletedAt === deletedOnly &&
          (!name || c.name.toLowerCase().includes(name)) &&
          (!phone || !!c.phone?.toLowerCase().includes(phone)) &&
          (balance === ALL || (balance === 'owed' ? c.owed > 0 : c.owed === 0)),
      )
      .sort(compare);
  });

  protected readonly pager = new Pager(
    () => this.visible(),
    () => [this.nameFilter(), this.phoneFilter(), this.balanceFilter(), this.sortKey(), this.sortDirection(), this.deletedOnly()],
  );
  /** The supplier whose account is open, or that a link named: highlighted, not selected. */
  protected readonly target = rowTarget();

  protected resetFilters(): void {
    this.nameFilter.set('');
    this.phoneFilter.set('');
    this.balanceFilter.set(ALL);
  }

  // Selection (leftmost column), the same as the other tables.
  protected readonly selection = new RowSelection(() => this.visible());
  private readonly pageSelected = computed(() => this.pager.rows().filter((c) => this.selection.has(c.id)).length);
  protected readonly selected = computed(() => this.visible().filter((c) => this.selection.has(c.id)));
  /** Suppliers with a balance cannot be deleted, so the bulk Delete counts only those without one. */
  protected readonly selectedLive = computed(() => this.selected().filter((c) => !c.deletedAt));
  protected readonly selectedDeletable = computed(() => this.selectedLive().filter((c) => c.owed === 0 && c.openOrders === 0));
  protected readonly selectedDeleted = computed(() => this.selected().filter((c) => !!c.deletedAt));
  protected readonly allSelected = computed(() => this.pager.rows().length > 0 && this.pageSelected() === this.pager.rows().length);
  protected readonly someSelected = computed(() => this.pageSelected() > 0 && !this.allSelected());

  protected isSelected(supplier: SupplierRecord): boolean {
    return this.selection.has(supplier.id);
  }
  protected toggleRow(supplier: SupplierRecord, on: boolean): void {
    this.selection.toggle(supplier.id, on);
  }
  protected toggleAll(on: boolean): void {
    this.selection.setMany(this.pager.rows().map((c) => c.id), on);
  }
  /** A click on a row: Shift or Ctrl/Cmd selects (like a file explorer); a plain click opens it for editing. */
  protected onRowClick(event: MouseEvent, supplier: SupplierRecord): void {
    if (!this.selection.click(supplier.id, event)) this.edit(supplier);
  }
  protected clearSelection(): void {
    this.selection.clear();
  }

  // Delete / restore. Every route (button, context menu) goes through `ask`, which always confirms.

  protected readonly pending = signal<{ kind: BulkKind; suppliers: SupplierRecord[] } | null>(null);
  protected readonly confirmTitle = signal('');
  protected readonly confirmText = signal('');
  protected readonly confirmLabel = signal('Delete');
  protected readonly confirmItems = signal<ConfirmItem[]>([]);

  protected ask(kind: BulkKind, suppliers: SupplierRecord[]): void {
    const rows = kind === 'delete' ? suppliers.filter((c) => c.owed === 0 && c.openOrders === 0) : suppliers;
    if (rows.length < suppliers.length) {
      this.banner.warning('A supplier we owe money, or with an order on the way, cannot be deleted', { key: 'suppliers-bulk', duration: 'long' });
    }
    if (rows.length === 0) return;
    const what = rows.length === 1 ? rows[0]!.name : `${rows.length} suppliers`;
    this.confirmTitle.set(kind === 'delete' ? `Delete ${what}?` : `Restore ${what}?`);
    this.confirmText.set(kind === 'delete' ? 'Their past purchase orders are kept.' : 'They can be ordered from again.');
    this.confirmLabel.set(kind === 'delete' ? 'Delete' : 'Restore');
    this.confirmItems.set(rows.map((c) => ({ label: c.name, detail: c.phone ?? undefined })));
    this.pending.set({ kind, suppliers: rows });
  }

  /** Right-click or long-press on a row: acts on the whole selection when the row is part of one, else on the row. */
  protected targetsFor(row: SupplierRecord): SupplierRecord[] {
    const group = row.deletedAt ? this.selectedDeleted() : this.selectedLive();
    return this.isSelected(row) && group.length > 1 ? group : [row];
  }
  /** The menu is given only a row id (the trigger keeps its first data), so the row is looked up fresh. */
  protected supplierById(id: string): SupplierRecord | undefined {
    return this.service.suppliers().find((c) => c.id === id);
  }

  protected async confirm(): Promise<void> {
    const pending = this.pending();
    this.pending.set(null);
    if (!pending) return;
    const ids = pending.suppliers.map((c) => c.id);
    const noun = ids.length === 1 ? '1 supplier' : `${ids.length} suppliers`;
    if (pending.kind === 'delete') {
      const result = await this.service.remove(ids);
      if (!result) this.banner.error('Could not delete', { key: 'suppliers-bulk' });
      else if (result.blocked.length) this.banner.warning(`Not deleted, still owed money or on order: ${result.blocked.join(', ')}`, { key: 'suppliers-bulk', duration: 'long' });
      else this.banner.success(`${noun} deleted`, { key: 'suppliers-bulk' });
    } else if (await this.service.restore(ids)) this.banner.success(`${noun} restored`, { key: 'suppliers-bulk' });
    else this.banner.error('Could not restore', { key: 'suppliers-bulk' });
    this.selection.remove(ids);
  }

  protected toggleDeleted(on: boolean): void {
    this.deletedOnly.set(on);
    this.clearSelection();
    void this.service.setIncludeDeleted(on);
  }

  /** Rows fade in only after the first load. */
  protected readonly animateRows = signal(false);

  constructor() {
    const loaded = this.service.setIncludeDeleted(false);
    effect(() => {
      if (this.service.status() === 'ready') setTimeout(() => this.animateRows.set(true));
    });
    // `?highlight=<id>` (a link from another page) targets a row: show the page that holds it and highlight it.
    // It is then removed from the address.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const highlight = params.get(HIGHLIGHT_PARAM);
      if (highlight) void loaded.then(() => this.reveal(highlight));
    });
  }

  /** Highlights a supplier and shows its page; filters that hide it are cleared first. */
  private reveal(id: string): void {
    void this.router.navigate([], { queryParams: { [HIGHLIGHT_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
    const supplier = this.service.suppliers().find((c) => c.id === id);
    if (!supplier) return;
    this.target.set(id);
    if (!this.pager.showItem((c) => c.id === id)) {
      this.resetFilters();
      this.pager.showItem((c) => c.id === id);
    }
    scrollToRow(id);
  }

  /** The purchases from this supplier. */
  protected viewPurchases(supplier: SupplierRecord): void {
    void this.router.navigate(['/purchases'], { queryParams: { supplier: supplier.id } });
  }
  protected add(): void {
    this.open();
  }
  protected edit(supplier: SupplierRecord): void {
    if (!supplier.deletedAt) this.open(supplier); // deleted suppliers are read-only here
  }
  /** Enter on a focused row opens it for editing (ignored when something already handled the key). */
  protected onRowEnter(event: Event, supplier: SupplierRecord): void {
    if (!event.defaultPrevented) this.edit(supplier);
  }

  private open(supplier?: SupplierRecord): void {
    if (supplier) this.target.set(supplier.id);
    this.dialogs
      .open<boolean, SupplierFormContext>(SupplierForm, {
        // A service dialog needs an id of its own (see the Products page) so the Delete confirmation inside can open.
        id: 'supplier-form',
        contentClass: 'w-[min(28rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { supplier },
      })
      .closed$.subscribe((saved) => {
        if (saved) this.banner.success(supplier ? 'Supplier saved' : 'Supplier added', { key: 'supplier-saved' });
      });
  }
}
