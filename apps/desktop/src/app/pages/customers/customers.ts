import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 } from '@ng-icons/lucide';
import type { CustomerRecord } from '@micropos/core';
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
import { CustomerViewer, VIEW_CUSTOMER_PARAM } from '../../core/customer-viewer';
import { CustomersService } from '../../core/data/customers.service';
import { MoneyPipe } from '../../core/money.pipe';
import { HIGHLIGHT_PARAM, rowTarget, scrollToRow } from '../../core/row-target';
import { ConfirmItems, type ConfirmItem } from '../../core/ui/confirm-items';
import { DateRangeFilter } from '../../core/ui/date-range-filter';
import { FilterInput } from '../../core/ui/filter-input';
import { AppPager, Pager } from '../../core/ui/pager';
import { RowSelection } from '../../core/ui/row-selection';
import { SwipeActions, type SwipeAction, type SwipeActionEvent } from '../../core/ui/swipe-actions';
import { ConcernsButton } from '../../core/ui/concerns-button';
import { CreditConcerns } from './credit-concerns';
import { CustomerForm, type CustomerFormContext } from './customer-form';

type SortKey = 'name' | 'phone' | 'balance' | 'limit' | 'activity';
type SortDirection = 'asc' | 'desc';
type BulkKind = 'delete' | 'restore';

const ALL = 'all';
const BALANCE_FILTERS = { [ALL]: 'All', owes: 'Owes', settled: 'Settled', credit: 'Has credit' } as const;
type BalanceFilter = keyof typeof BALANCE_FILTERS;

const SORT_VALUES: Record<SortKey, (c: CustomerRecord) => string | number | null> = {
  name: (c) => c.name,
  phone: (c) => c.phone,
  balance: (c) => c.balance,
  limit: (c) => c.creditLimit,
  activity: (c) => c.lastActivityAt,
};

/** Column widths shared by the title row, the filter row and every row. */
export const COLUMNS_TEMPLATE = '3.5rem minmax(12rem,2fr) minmax(8rem,1fr) 9rem 9rem 13rem';

/** Customers: who buys on credit, what each owes, and their accounts. Open one to see the ledger and record payments. */
@Component({
  imports: [
    AppPager,
    ConfirmItems,
    DatePipe,
    DateRangeFilter,
    FilterInput,
    MoneyPipe,
    ConcernsButton,
    NgIcon,
    SwipeActions,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmSelectImports,
    HlmSwitchImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX, lucideTrash2, lucideUndo2 })],
  templateUrl: './customers.html',
})
export class CustomersPage {
  protected readonly service = inject(CustomersService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly viewer = inject(CustomerViewer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly columnsTemplate = COLUMNS_TEMPLATE;
  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'balance', label: 'Owes', right: true },
    { key: 'limit', label: 'Limit', right: true },
    { key: 'activity', label: 'Last activity' },
  ];
  protected readonly balanceFilters = Object.keys(BALANCE_FILTERS) as BalanceFilter[];
  private readonly money = new MoneyPipe();
  protected readonly balanceFilterLabel = (f: BalanceFilter): string => BALANCE_FILTERS[f] ?? '';

  // Column filters (second header row); they combine.
  protected readonly nameFilter = signal('');
  protected readonly phoneFilter = signal('');
  protected readonly balanceFilter = signal<BalanceFilter>(ALL);
  protected readonly activityFrom = signal('');
  protected readonly activityTo = signal('');
  protected readonly filtered = computed(
    () => !!(this.nameFilter() || this.phoneFilter() || this.activityFrom() || this.activityTo()) || this.balanceFilter() !== ALL,
  );

  protected readonly sortKey = signal<SortKey>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortKey.set(key);
      this.sortDirection.set(key === 'balance' || key === 'activity' ? 'desc' : 'asc');
    }
  }
  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() !== key ? 'none' : this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  /** Deleted only: lists just the deleted customers (the others are hidden), so they can be restored. */
  protected readonly deletedOnly = signal(false);

  protected readonly visible = computed(() => {
    const name = this.nameFilter().trim().toLowerCase();
    const phone = this.phoneFilter().trim().toLowerCase();
    const balance = this.balanceFilter();
    const from = this.activityFrom() ? new Date(`${this.activityFrom()}T00:00:00`).getTime() : -Infinity;
    const to = this.activityTo() ? new Date(`${this.activityTo()}T23:59:59.999`).getTime() : Infinity;
    const deletedOnly = this.deletedOnly();
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: CustomerRecord, b: CustomerRecord): number => {
      const x = value(a);
      const y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empty last, whichever direction
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign;
    };
    const noActivityFilter = !this.activityFrom() && !this.activityTo();
    return this.service
      .customers()
      .filter(
        (c) =>
          !!c.deletedAt === deletedOnly &&
          (!name || c.name.toLowerCase().includes(name)) &&
          (!phone || !!c.phone?.toLowerCase().includes(phone)) &&
          (balance === ALL || (balance === 'owes' ? c.balance > 0 : balance === 'credit' ? c.balance < 0 : c.balance === 0)) &&
          (noActivityFilter || (c.lastActivityAt !== null && c.lastActivityAt >= from && c.lastActivityAt <= to)),
      )
      .sort(compare);
  });

  protected readonly pager = new Pager(
    () => this.visible(),
    () => [this.nameFilter(), this.phoneFilter(), this.balanceFilter(), this.activityFrom(), this.activityTo(), this.sortKey(), this.sortDirection(), this.deletedOnly()],
  );
  /** The customer whose account is open, or that a link named: highlighted, not selected. */
  protected readonly target = rowTarget();

  protected resetFilters(): void {
    this.nameFilter.set('');
    this.phoneFilter.set('');
    this.balanceFilter.set(ALL);
    this.activityFrom.set('');
    this.activityTo.set('');
  }

  // Selection (leftmost column), the same as the other tables.
  protected readonly selection = new RowSelection(() => this.visible());
  private readonly pageSelected = computed(() => this.pager.rows().filter((c) => this.selection.has(c.id)).length);
  protected readonly selected = computed(() => this.visible().filter((c) => this.selection.has(c.id)));
  /** Customers with a balance cannot be deleted, so the bulk Delete counts only those without one. */
  protected readonly selectedLive = computed(() => this.selected().filter((c) => !c.deletedAt));
  protected readonly selectedDeletable = computed(() => this.selectedLive().filter((c) => c.balance === 0));
  protected readonly selectedDeleted = computed(() => this.selected().filter((c) => !!c.deletedAt));
  protected readonly allSelected = computed(() => this.pager.rows().length > 0 && this.pageSelected() === this.pager.rows().length);
  protected readonly someSelected = computed(() => this.pageSelected() > 0 && !this.allSelected());

  protected isSelected(customer: CustomerRecord): boolean {
    return this.selection.has(customer.id);
  }
  protected toggleRow(customer: CustomerRecord, on: boolean): void {
    this.selection.toggle(customer.id, on);
  }
  protected toggleAll(on: boolean): void {
    this.selection.setMany(this.pager.rows().map((c) => c.id), on);
  }
  /** A click on a row: Shift or Ctrl/Cmd selects (like a file explorer); a plain click opens the account. */
  protected onRowClick(event: MouseEvent, customer: CustomerRecord): void {
    if (!this.selection.click(customer.id, event)) this.view(customer);
  }
  protected clearSelection(): void {
    this.selection.clear();
  }

  // Delete / restore. Every route (button, context menu, swipe) goes through `ask`, which always confirms.
  protected readonly swipeDelete: SwipeAction[] = [{ id: 'delete', label: 'Delete', icon: 'lucideTrash2', tone: 'destructive' }];
  protected readonly swipeRestore: SwipeAction[] = [{ id: 'restore', label: 'Restore', icon: 'lucideUndo2', tone: 'success' }];
  protected swipeFor(customer: CustomerRecord): SwipeAction[] {
    return customer.deletedAt ? this.swipeRestore : customer.balance === 0 ? this.swipeDelete : [];
  }

  protected readonly pending = signal<{ kind: BulkKind; customers: CustomerRecord[] } | null>(null);
  protected readonly confirmTitle = signal('');
  protected readonly confirmText = signal('');
  protected readonly confirmLabel = signal('Delete');
  protected readonly confirmItems = signal<ConfirmItem[]>([]);

  protected ask(kind: BulkKind, customers: CustomerRecord[]): void {
    const rows = kind === 'delete' ? customers.filter((c) => c.balance === 0) : customers;
    if (rows.length < customers.length) {
      this.banner.warning('A customer who owes or is owed money cannot be deleted', { key: 'customers-bulk', duration: 'long' });
    }
    if (rows.length === 0) return;
    const what = rows.length === 1 ? rows[0]!.name : `${rows.length} customers`;
    this.confirmTitle.set(kind === 'delete' ? `Delete ${what}?` : `Restore ${what}?`);
    this.confirmText.set(kind === 'delete' ? 'Their past orders and account history are kept.' : 'They can buy on credit again.');
    this.confirmLabel.set(kind === 'delete' ? 'Delete' : 'Restore');
    this.confirmItems.set(rows.map((c) => ({ label: c.name, detail: c.phone ?? undefined })));
    this.pending.set({ kind, customers: rows });
  }

  /** Right-click or swipe on a row: acts on the whole selection when the row is part of one, else on the row. */
  protected targetsFor(row: CustomerRecord): CustomerRecord[] {
    const group = row.deletedAt ? this.selectedDeleted() : this.selectedLive();
    return this.isSelected(row) && group.length > 1 ? group : [row];
  }
  protected onSwipe(event: SwipeActionEvent, row: CustomerRecord): void {
    this.ask(event.action.id === 'restore' ? 'restore' : 'delete', this.targetsFor(row));
  }
  /** The menu is given only a row id (the trigger keeps its first data), so the row is looked up fresh. */
  protected customerById(id: string): CustomerRecord | undefined {
    return this.service.customers().find((c) => c.id === id);
  }

  protected async confirm(): Promise<void> {
    const pending = this.pending();
    this.pending.set(null);
    if (!pending) return;
    const ids = pending.customers.map((c) => c.id);
    const noun = ids.length === 1 ? '1 customer' : `${ids.length} customers`;
    if (pending.kind === 'delete') {
      const result = await this.service.remove(ids);
      if (!result) this.banner.error('Could not delete', { key: 'customers-bulk' });
      else if (result.blocked.length) this.banner.warning(`Not deleted, still owes or is owed: ${result.blocked.join(', ')}`, { key: 'customers-bulk', duration: 'long' });
      else this.banner.success(`${noun} deleted`, { key: 'customers-bulk' });
    } else if (await this.service.restore(ids)) this.banner.success(`${noun} restored`, { key: 'customers-bulk' });
    else this.banner.error('Could not restore', { key: 'customers-bulk' });
    this.selection.remove(ids);
  }

  protected toggleDeleted(on: boolean): void {
    this.deletedOnly.set(on);
    this.clearSelection();
    void this.service.setIncludeDeleted(on);
  }

  protected moneyText(cents: number | null): string {
    return cents === null ? '-' : this.money.transform(cents);
  }

  /** Rows fade in only after the first load. */
  protected readonly animateRows = signal(false);

  constructor() {
    const loaded = this.service.load();
    effect(() => {
      if (this.service.status() === 'ready') setTimeout(() => this.animateRows.set(true));
    });
    // `?view-customer=<id>` (the account dialog is open for it) and `?highlight=<id>` (a link from another page)
    // both target a row: show the page that holds it and highlight it. `highlight` is then removed from the address.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const highlight = params.get(HIGHLIGHT_PARAM);
      const id = highlight ?? params.get(VIEW_CUSTOMER_PARAM);
      if (id) void loaded.then(() => this.reveal(id, !!highlight));
    });
  }

  /** Highlights a customer and shows its page; filters that hide it are cleared first. */
  private reveal(id: string, consume: boolean): void {
    if (consume) void this.router.navigate([], { queryParams: { [HIGHLIGHT_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
    const customer = this.service.customers().find((c) => c.id === id);
    if (!customer) return;
    this.target.set(id);
    if (!this.pager.showItem((c) => c.id === id)) {
      this.resetFilters();
      this.pager.showItem((c) => c.id === id);
    }
    scrollToRow(id);
  }

  protected view(customer: CustomerRecord): void {
    void this.viewer.open(customer.id);
  }
  /** Customers whose credit needs attention: the number on the button beside the title. */
  protected readonly concerns = computed(() => this.service.customers().filter((c) => c.alert).length);

  protected showConcerns(): void {
    this.dialogs.open(CreditConcerns, { id: 'credit-concerns', contentClass: 'w-[min(32rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]' });
  }

  protected add(): void {
    this.open();
  }
  protected edit(customer: CustomerRecord): void {
    if (!customer.deletedAt) this.open(customer); // deleted customers are read-only here
  }
  /** Enter on a focused row opens it (ignored when something already handled the key). */
  protected onRowEnter(event: Event, customer: CustomerRecord): void {
    if (!event.defaultPrevented) this.view(customer);
  }

  private open(customer?: CustomerRecord): void {
    if (customer) this.target.set(customer.id);
    this.dialogs
      .open<boolean, CustomerFormContext>(CustomerForm, {
        // A service dialog needs an id of its own (see the Products page) so the Delete confirmation inside can open.
        id: 'customer-form',
        contentClass: 'w-[min(28rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { customer },
      })
      .closed$.subscribe((saved) => {
        if (saved) this.banner.success(customer ? 'Customer saved' : 'Customer added', { key: 'customer-saved' });
      });
  }
}
