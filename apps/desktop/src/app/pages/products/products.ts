import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 } from '@ng-icons/lucide';
import { isPlu, isWeighed, type ProductRecord } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { BannerService } from '../../core/banner';
import { CatalogService } from '../../core/data/catalog.service';
import { ProductsService } from '../../core/data/products.service';
import { MoneyPipe } from '../../core/money.pipe';
import { claimScanner } from '../../core/scanner';
import { FilterInput } from '../../core/ui/filter-input';
import { SwipeActions, type SwipeAction, type SwipeActionEvent } from '../../core/ui/swipe-actions';
import { ProductForm, type ProductFormContext } from './product-form';

export const ALL_CATEGORIES = 'All categories';
const STATUSES = { all: 'All', active: 'Active', inactive: 'Inactive' } as const;
type Status = keyof typeof STATUSES;

export type SortKey = 'name' | 'sku' | 'barcode' | 'categories' | 'cost' | 'price' | 'status' | 'created';
type SortDirection = 'asc' | 'desc';

type BulkKind = 'delete' | 'restore';

/** Column widths shared by the title row, the filter row and every product row. */
export const COLUMNS_TEMPLATE =
  '3.5rem minmax(12rem,2fr) minmax(8rem,1fr) minmax(9rem,1fr) minmax(12rem,1.5fr) minmax(7rem,.8fr) minmax(8rem,.9fr) 9rem 17rem';

/** What each column sorts by. Empty values (no SKU, no cost) always sort last. */
const SORT_VALUES: Record<SortKey, (p: ProductRecord) => string | number | null> = {
  name: (p) => p.name,
  sku: (p) => p.sku,
  barcode: (p) => p.barcode,
  categories: (p) => p.categories.map((c) => c.name).join(', ') || null,
  cost: (p) => p.cost,
  price: (p) => p.price,
  status: (p) => (p.deletedAt ? 2 : p.active ? 0 : 1),
  created: (p) => p.createdAt,
};

/** Products: search, filter and manage the catalog. */
@Component({
  imports: [
    DatePipe,
    FilterInput,
    NgIcon,
    MoneyPipe,
    SwipeActions,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmComboboxImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmInputImports,
    HlmSelectImports,
    HlmSwitchImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 })],
  templateUrl: './products.html',
})
export class ProductsPage {
  protected readonly service = inject(ProductsService);
  private readonly catalog = inject(CatalogService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);

  // Column filters (second header row); they combine.
  protected readonly nameFilter = signal('');
  protected readonly skuFilter = signal('');
  protected readonly codeFilter = signal('');
  /** Created date range as `yyyy-mm-dd` (the date inputs' value), both ends inclusive; empty means open. */
  protected readonly createdFrom = signal('');
  protected readonly createdTo = signal('');
  protected readonly allCategories = ALL_CATEGORIES;
  protected readonly category = signal<string | null>(ALL_CATEGORIES);
  protected readonly status = signal<Status>('all');
  protected readonly statusLabel = (status: Status): string => STATUSES[status] ?? '';
  protected readonly statuses = Object.keys(STATUSES) as Status[];

  protected readonly categoryNames = computed(() => [
    ALL_CATEGORIES,
    ...this.catalog
      .categories()
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b)),
  ]);

  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barcode / PLU' },
    { key: 'categories', label: 'Categories' },
    { key: 'cost', label: 'Cost', right: true },
    { key: 'price', label: 'Price', right: true },
    { key: 'status', label: 'Status' },
    { key: 'created', label: 'Created' },
  ];
  protected readonly sortKey = signal<SortKey>('created');
  protected readonly sortDirection = signal<SortDirection>('desc'); // newest first

  /** Click a column title: sort by it ascending; click again to reverse. */
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
    const category = this.category() ?? ALL_CATEGORIES;
    const status = this.status();
    const name = this.nameFilter().trim().toLowerCase();
    const sku = this.skuFilter().trim().toLowerCase();
    const code = this.codeFilter().trim().toLowerCase();
    // Local midnight at the start of the first day, and just before midnight at the end of the last.
    const from = this.createdFrom() ? new Date(`${this.createdFrom()}T00:00:00`).getTime() : -Infinity;
    const to = this.createdTo() ? new Date(`${this.createdTo()}T23:59:59.999`).getTime() : Infinity;
    const has = (value: string | null, text: string): boolean => !text || !!value?.toLowerCase().includes(text);
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: ProductRecord, b: ProductRecord): number => {
      const x = value(a);
      const y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empty last, whichever direction
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return order * sign;
    };
    const deletedOnly = this.deletedOnly();
    return this.service.products().filter(
      (p) =>
        !!p.deletedAt === deletedOnly &&
        (category === ALL_CATEGORIES || p.categories.some((c) => c.name === category)) &&
        (deletedOnly || status === 'all' || (!p.deletedAt && p.active === (status === 'active'))) &&
        has(p.name, name) &&
        has(p.sku, sku) &&
        has(p.barcode, code) &&
        p.createdAt >= from &&
        p.createdAt <= to,
    ).sort(compare);
  });

  protected readonly columnsTemplate = COLUMNS_TEMPLATE;

  /** True while any column filter is set; enables the reset button. */
  protected readonly filtered = computed(
    () =>
      !!(this.nameFilter() || this.skuFilter() || this.codeFilter() || this.createdFrom() || this.createdTo()) ||
      (this.category() ?? ALL_CATEGORIES) !== ALL_CATEGORIES ||
      this.status() !== 'all',
  );

  protected resetFilters(): void {
    this.nameFilter.set('');
    this.skuFilter.set('');
    this.codeFilter.set('');
    this.createdFrom.set('');
    this.createdTo.set('');
    this.category.set(ALL_CATEGORIES);
    this.status.set('all');
  }

  // Selection (leftmost column). Only rows that are on screen count, so a filter can never hide a selected row
  // that a bulk action would still hit.
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly selected = computed(() => this.visible().filter((p) => this.selectedIds().has(p.id)));
  protected readonly selectedLive = computed(() => this.selected().filter((p) => !p.deletedAt));
  protected readonly selectedDeleted = computed(() => this.selected().filter((p) => !!p.deletedAt));
  /** Some, but not every, visible row is ticked: the select-all checkbox shows a dash. */
  protected readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());
  protected readonly allSelected = computed(() => this.visible().length > 0 && this.selected().length === this.visible().length);

  protected isSelected(product: ProductRecord): boolean {
    return this.selectedIds().has(product.id);
  }

  protected toggleRow(product: ProductRecord, on: boolean): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (on) next.add(product.id);
      else next.delete(product.id);
      return next;
    });
  }

  protected toggleAll(on: boolean): void {
    this.selectedIds.set(on ? new Set(this.visible().map((p) => p.id)) : new Set());
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  // Delete / restore. Every route (button, context menu, swipe) goes through `ask`, which always confirms.
  protected readonly swipeDelete: SwipeAction[] = [{ id: 'delete', label: 'Delete', icon: 'lucideTrash2', tone: 'destructive' }];
  protected readonly swipeRestore: SwipeAction[] = [{ id: 'restore', label: 'Restore', icon: 'lucideUndo2', tone: 'success' }];
  protected swipeFor(product: ProductRecord): SwipeAction[] {
    return product.deletedAt ? this.swipeRestore : this.swipeDelete;
  }

  /** What is being confirmed; `confirmTitle`/`confirmText` are kept after closing so the text does not blank mid-fade. */
  protected readonly pending = signal<{ kind: BulkKind; products: ProductRecord[] } | null>(null);
  protected readonly confirmTitle = signal('');
  protected readonly confirmText = signal('');
  protected readonly confirmLabel = signal('Delete');

  protected ask(kind: BulkKind, products: ProductRecord[]): void {
    if (products.length === 0) return;
    const what = products.length === 1 ? products[0]!.name : `${products.length} products`;
    this.confirmTitle.set(kind === 'delete' ? `Delete ${what}?` : `Restore ${what}?`);
    this.confirmText.set(
      kind === 'delete' ? 'They will no longer appear at checkout. Past orders keep them.' : 'They will be back in the catalog.',
    );
    this.confirmLabel.set(kind === 'delete' ? 'Delete' : 'Restore');
    this.pending.set({ kind, products });
  }

  /** Right-click or swipe on a row: acts on the whole selection when the row is part of one, else on the row. */
  protected targetsFor(row: ProductRecord): ProductRecord[] {
    const group = row.deletedAt ? this.selectedDeleted() : this.selectedLive();
    return this.isSelected(row) && group.length > 1 ? group : [row];
  }

  protected productById(id: string): ProductRecord | undefined {
    return this.service.products().find((p) => p.id === id);
  }

  /** Whether any product the menu would act on has this status, so only a change that does something is offered. */
  protected hasStatus(row: ProductRecord, active: boolean): boolean {
    return this.targetsFor(row).some((p) => p.active === active);
  }

  protected onSwipe(event: SwipeActionEvent, row: ProductRecord): void {
    this.ask(event.action.id === 'restore' ? 'restore' : 'delete', this.targetsFor(row));
  }

  /** Context menu: set every target active or inactive at once (no confirmation: it is easily undone). */
  protected async setActive(targets: ProductRecord[], active: boolean): Promise<void> {
    const ids = targets.filter((p) => p.active !== active).map((p) => p.id);
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? '1 product' : `${ids.length} products`;
    if (await this.service.setActive(ids, active)) this.banner.success(`${noun} set ${active ? 'active' : 'inactive'}`, { key: 'products-bulk' });
    else this.banner.error('Could not change status', { key: 'products-bulk' });
  }

  protected async confirm(): Promise<void> {
    const pending = this.pending();
    this.pending.set(null);
    if (!pending) return;
    const ids = pending.products.map((p) => p.id);
    const n = ids.length;
    const noun = n === 1 ? '1 product' : `${n} products`;
    if (pending.kind === 'delete') {
      if (await this.service.remove(ids)) this.banner.success(`${noun} deleted`, { key: 'products-bulk' });
      else this.banner.error('Could not delete', { key: 'products-bulk' });
    } else {
      const result = await this.service.restore(ids);
      if (!result) this.banner.error('Could not restore', { key: 'products-bulk' });
      else if (result.conflicts.length) {
        this.banner.warning(`${result.restored} restored. Code in use, not restored: ${result.conflicts.join(', ')}`, {
          key: 'products-bulk',
          duration: 'long',
        });
      } else this.banner.success(`${result.restored === 1 ? '1 product' : `${result.restored} products`} restored`, { key: 'products-bulk' });
    }
    this.selectedIds.update((current) => new Set([...current].filter((id) => !ids.includes(id))));
  }

  // Row motion. New rows grow in (not on the very first load), removed rows fold away, and a row whose data
  // changed flashes for a moment (`row-enter`, `row-leave`, `row-flash` in styles.css).
  protected readonly animateRows = signal(false);
  protected readonly flashing = signal<ReadonlySet<string>>(new Set());
  private snapshot = new Map<string, string>();
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const products = this.service.products();
      const next = new Map(products.map((p) => [p.id, JSON.stringify(p)]));
      const changed = products.filter((p) => this.snapshot.has(p.id) && this.snapshot.get(p.id) !== next.get(p.id)).map((p) => p.id);
      this.snapshot = next;
      if (this.service.status() === 'ready') setTimeout(() => this.animateRows.set(true)); // after the first render
      if (changed.length) {
        this.flashing.set(new Set(changed));
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => this.flashing.set(new Set()), 1500);
      }
    });
    void this.service.load();
    void this.catalog.load();

    // A scan looks the code up: other filters are cleared and the barcode / PLU filter is set to the code. While a
    // dialog is open the form claims the scanner instead, so scans never change the table behind it.
    claimScanner(({ code }) => {
      this.resetFilters();
      this.codeFilter.set(code);
      this.clearSelection();
      if (!this.service.products().some((p) => p.barcode === code)) {
        this.banner.warning(`No product with barcode ${code}`, { duration: 'long', key: 'unknown-barcode' });
      }
    });
  }

  protected readonly isPlu = isPlu;

  /** " / kg" after the money of a weighed product. */
  protected per(product: ProductRecord): string {
    return isWeighed(product.unit) ? ` / ${product.unit}` : '';
  }

  /** Deleted only: lists just the deleted products (the others are hidden), so they can be restored. */
  protected readonly deletedOnly = signal(false);

  protected toggleDeleted(on: boolean): void {
    this.deletedOnly.set(on);
    this.clearSelection(); // a selection from the other list must not carry over
    void this.service.setIncludeDeleted(on);
  }

  protected add(): void {
    this.open();
  }

  /**
   * Enter on a focused row opens it. The scanner blocks (preventDefault) the Enter that ends a scan, so ignore
   * those: after a dialog closes the row has focus again, and a scanned code must not reopen it.
   */
  protected onRowEnter(event: Event, product: ProductRecord): void {
    if (!event.defaultPrevented) this.edit(product);
  }

  protected edit(product: ProductRecord): void {
    if (!product.deletedAt) this.open(product); // deleted products are read-only here
  }

  private open(product?: ProductRecord): void {
    const ref = this.dialogs.open<boolean, ProductFormContext>(ProductForm, {
      // Service dialogs count their ids separately from <hlm-dialog>/<hlm-alert-dialog>; a clash ("brn-dialog-3")
      // stops the Delete confirmation inside this form from opening, so give this one an id of its own.
      id: 'product-form',
      contentClass: 'w-[min(40rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { product },
    });
    void ref.closed$.subscribe((saved) => {
      if (saved) this.banner.success(product ? 'Product saved' : 'Product added', { key: 'product-saved' });
    });
  }
}
