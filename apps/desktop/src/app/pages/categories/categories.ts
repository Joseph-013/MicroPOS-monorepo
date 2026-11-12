import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 } from '@ng-icons/lucide';
import type { CategoryRecord } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { BannerService } from '../../core/banner';
import { CatalogService } from '../../core/data/catalog.service';
import { CategoriesService } from '../../core/data/categories.service';
import { DateRangeFilter } from '../../core/ui/date-range-filter';
import { FilterInput } from '../../core/ui/filter-input';
import { rowTarget } from '../../core/row-target';
import { RowSelection } from '../../core/ui/row-selection';
import { ConfirmItems, type ConfirmItem } from '../../core/ui/confirm-items';
import { AppPager, Pager } from '../../core/ui/pager';
import { SwipeActions, type SwipeAction, type SwipeActionEvent } from '../../core/ui/swipe-actions';
import { CategoryForm, type CategoryFormContext } from './category-form';

type SortKey = 'name' | 'products' | 'order' | 'created';
type SortDirection = 'asc' | 'desc';
type BulkKind = 'delete' | 'restore';

const SORT_VALUES: Record<SortKey, (c: CategoryRecord) => string | number> = {
  name: (c) => c.name,
  products: (c) => c.productCount,
  order: (c) => c.sortOrder,
  created: (c) => c.createdAt,
};

/** Column widths shared by the title row, the filter row and every row. */
export const COLUMNS_TEMPLATE = '3.5rem minmax(14rem,3fr) minmax(8rem,1fr) minmax(7rem,.8fr) 13rem';

/** Categories: add, rename, order and delete the groups products belong to. */
@Component({
  imports: [
    AppPager,
    ConfirmItems,
    DatePipe,
    DateRangeFilter,
    FilterInput,
    NgIcon,
    RouterLink,
    SwipeActions,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmSwitchImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 })],
  templateUrl: './categories.html',
})
export class CategoriesPage {
  protected readonly service = inject(CategoriesService);
  private readonly catalog = inject(CatalogService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);

  protected readonly columnsTemplate = COLUMNS_TEMPLATE;
  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'products', label: 'Products', right: true },
    { key: 'order', label: 'Order', right: true },
    { key: 'created', label: 'Created' },
  ];

  // Column filters (second header row); they combine.
  protected readonly nameFilter = signal('');
  protected readonly createdFrom = signal('');
  protected readonly createdTo = signal('');
  protected readonly filtered = computed(() => !!(this.nameFilter() || this.createdFrom() || this.createdTo()));

  protected readonly sortKey = signal<SortKey>('created');
  protected readonly sortDirection = signal<SortDirection>('desc'); // newest first

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

  /** Deleted only: lists just the deleted categories (the others are hidden), so they can be restored. */
  protected readonly deletedOnly = signal(false);

  protected readonly visible = computed(() => {
    const name = this.nameFilter().trim().toLowerCase();
    const from = this.createdFrom() ? new Date(`${this.createdFrom()}T00:00:00`).getTime() : -Infinity;
    const to = this.createdTo() ? new Date(`${this.createdTo()}T23:59:59.999`).getTime() : Infinity;
    const deletedOnly = this.deletedOnly();
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: CategoryRecord, b: CategoryRecord): number => {
      const x = value(a);
      const y = value(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign;
    };
    return this.service
      .categories()
      .filter((c) => !!c.deletedAt === deletedOnly && (!name || c.name.toLowerCase().includes(name)) && c.createdAt >= from && c.createdAt <= to)
      .sort(compare);
  });

  protected readonly pager = new Pager(
    () => this.visible(),
    () => [this.nameFilter(), this.createdFrom(), this.createdTo(), this.sortKey(), this.sortDirection(), this.deletedOnly()],
  );
  /** The row being edited: highlighted, not selected. */
  protected readonly target = rowTarget();

  protected resetFilters(): void {
    this.nameFilter.set('');
    this.createdFrom.set('');
    this.createdTo.set('');
  }

  // Selection (leftmost column): only rows on screen count.
  protected readonly selection = new RowSelection(() => this.visible());
  /** How many rows of the current page are ticked: the header checkbox reflects this page only. */
  private readonly pageSelected = computed(() => this.pager.rows().filter((row) => this.selection.has(row.id)).length);
  protected readonly selected = computed(() => this.visible().filter((c) => this.selection.has(c.id)));
  protected readonly selectedLive = computed(() => this.selected().filter((c) => !c.deletedAt));
  protected readonly selectedDeleted = computed(() => this.selected().filter((c) => !!c.deletedAt));
  protected readonly allSelected = computed(() => this.pager.rows().length > 0 && this.pageSelected() === this.pager.rows().length);
  protected readonly someSelected = computed(() => this.pageSelected() > 0 && !this.allSelected());

  protected isSelected(category: CategoryRecord): boolean {
    return this.selection.has(category.id);
  }
  protected toggleRow(category: CategoryRecord, on: boolean): void {
    this.selection.toggle(category.id, on);
  }
  protected toggleAll(on: boolean): void {
    this.selection.setMany(this.pager.rows().map((row) => row.id), on); // this page only; other pages keep theirs
  }
  /** A click on a row: Shift or Ctrl/Cmd selects (like a file explorer); a plain click opens it. */
  protected onRowClick(event: MouseEvent, row: CategoryRecord): void {
    if (!this.selection.click(row.id, event)) this.edit(row);
  }

  protected clearSelection(): void {
    this.selection.clear();
  }

  // Delete / restore. Every route (button, context menu, swipe) goes through `ask`, which always confirms.
  protected readonly swipeDelete: SwipeAction[] = [{ id: 'delete', label: 'Delete', icon: 'lucideTrash2', tone: 'destructive' }];
  protected readonly swipeRestore: SwipeAction[] = [{ id: 'restore', label: 'Restore', icon: 'lucideUndo2', tone: 'success' }];
  protected swipeFor(category: CategoryRecord): SwipeAction[] {
    return category.deletedAt ? this.swipeRestore : this.swipeDelete;
  }

  protected readonly pending = signal<{ kind: BulkKind; categories: CategoryRecord[] } | null>(null);
  protected readonly confirmTitle = signal('');
  protected readonly confirmText = signal('');
  protected readonly confirmLabel = signal('Delete');
  /** What the dialog is about to act on. */
  protected readonly confirmItems = signal<ConfirmItem[]>([]);

  protected ask(kind: BulkKind, categories: CategoryRecord[]): void {
    if (categories.length === 0) return;
    const what = categories.length === 1 ? categories[0]!.name : `${categories.length} categories`;
    this.confirmTitle.set(kind === 'delete' ? `Delete ${what}?` : `Restore ${what}?`);
    this.confirmText.set(kind === 'delete' ? 'Products keep their other categories.' : 'Their products return to them.');
    this.confirmLabel.set(kind === 'delete' ? 'Delete' : 'Restore');
    this.confirmItems.set(categories.map((c) => ({ label: c.name, detail: c.productCount === 1 ? '1 product' : `${c.productCount} products` })));
    this.pending.set({ kind, categories });
  }

  /** Right-click or swipe on a row: acts on the whole selection when the row is part of one, else on the row. */
  protected targetsFor(row: CategoryRecord): CategoryRecord[] {
    const group = row.deletedAt ? this.selectedDeleted() : this.selectedLive();
    return this.isSelected(row) && group.length > 1 ? group : [row];
  }
  protected onSwipe(event: SwipeActionEvent, row: CategoryRecord): void {
    this.ask(event.action.id === 'restore' ? 'restore' : 'delete', this.targetsFor(row));
  }
  /** The menu is given only a row id (the trigger keeps its first data), so the row is looked up fresh. */
  protected categoryById(id: string): CategoryRecord | undefined {
    return this.service.categories().find((c) => c.id === id);
  }

  protected async confirm(): Promise<void> {
    const pending = this.pending();
    this.pending.set(null);
    if (!pending) return;
    const ids = pending.categories.map((c) => c.id);
    const noun = ids.length === 1 ? '1 category' : `${ids.length} categories`;
    if (pending.kind === 'delete') {
      if (await this.service.remove(ids)) this.banner.success(`${noun} deleted`, { key: 'categories-bulk' });
      else this.banner.error('Could not delete', { key: 'categories-bulk' });
    } else {
      const result = await this.service.restore(ids);
      if (!result) this.banner.error('Could not restore', { key: 'categories-bulk' });
      else if (result.conflicts.length) {
        this.banner.warning(`${result.restored} restored. Name in use, not restored: ${result.conflicts.join(', ')}`, { key: 'categories-bulk', duration: 'long' });
      } else this.banner.success(`${result.restored === 1 ? '1 category' : `${result.restored} categories`} restored`, { key: 'categories-bulk' });
    }
    void this.catalog.load(); // checkout and the product form list categories too
    this.selection.remove(ids);
  }

  protected toggleDeleted(on: boolean): void {
    this.deletedOnly.set(on);
    this.clearSelection();
    void this.service.setIncludeDeleted(on);
  }

  protected add(): void {
    this.open();
  }
  protected edit(category: CategoryRecord): void {
    if (!category.deletedAt) this.open(category); // deleted categories are read-only here
  }
  /** Enter on a focused row opens it (ignored when something already handled the key). */
  protected onRowEnter(event: Event, category: CategoryRecord): void {
    if (!event.defaultPrevented) this.edit(category);
  }

  private open(category?: CategoryRecord): void {
    if (category) this.target.set(category.id);
    this.dialogs
      .open<boolean, CategoryFormContext>(CategoryForm, {
        // A service dialog needs an id of its own (see the Products page) so the Delete confirmation inside can open.
        id: 'category-form',
        contentClass: 'w-[min(28rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { category },
      })
      .closed$.subscribe((saved) => {
        if (saved) this.banner.success(category ? 'Category saved' : 'Category added', { key: 'category-saved' });
      });
  }

  constructor() {
    void this.service.load();
    // Row motion: rows fade in after the first load (see styles.css).
    effect(() => {
      if (this.service.status() === 'ready') setTimeout(() => this.animateRows.set(true));
    });
  }
  protected readonly animateRows = signal(false);
}
