import { ColumnConfig } from '../../core/ui/column-config';
import { AppCol } from '../../core/ui/table-column.directive';
import { tableLayout } from '../../core/ui/table-columns';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX } from '@ng-icons/lucide';
import { canReverseOrder, type OrderPaymentMethod, type SalesOrderSummary } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { OrdersService } from '../../core/data/orders.service';
import { MoneyPipe } from '../../core/money.pipe';
import { OrderActions } from '../../core/order-actions';
import { HIGHLIGHT_PARAM, scrollToRow, rowTarget } from '../../core/row-target';
import { SalesOrderViewer, VIEW_SALES_ORDER_PARAM } from '../../core/sales-order-viewer';
import { DateRangeFilter } from '../../core/ui/date-range-filter';
import { FilterInput } from '../../core/ui/filter-input';
import { RowSelection } from '../../core/ui/row-selection';
import { ReceiptPrinting } from '../../core/receipt-printing';
import { AppPager, Pager } from '../../core/ui/pager';
import type { OrderActionKind } from './order-action-form';
import { METHOD_LABELS, STATUS_LABELS } from './sales-order-form';

type SortKey = 'number' | 'date' | 'cashier' | 'customer' | 'items' | 'method' | 'status' | 'total';
type SortDirection = 'asc' | 'desc';
type Status = SalesOrderSummary['status'];

const ALL = 'all';
/** A refund order has status completed but is its own kind of row, so it gets its own filter. */
const STATUS_FILTERS = { [ALL]: 'All', ...STATUS_LABELS, refund: 'Refund' } as const;
const METHOD_FILTERS = { [ALL]: 'All', ...METHOD_LABELS } as const;
type StatusFilter = keyof typeof STATUS_FILTERS;
type MethodFilter = keyof typeof METHOD_FILTERS;

const methodText = (o: SalesOrderSummary): string => o.methods.map((m) => METHOD_LABELS[m]).join(', ');

const SORT_VALUES: Record<SortKey, (o: SalesOrderSummary) => string | number> = {
  number: (o) => o.orderNumber,
  date: (o) => o.createdAt,
  cashier: (o) => o.employeeName,
  customer: (o) => o.customerName ?? '',
  items: (o) => o.itemCount,
  method: methodText,
  status: (o) => o.status,
  total: (o) => o.total,
};

/** The columns and their widths, shared by the title row, the filter row and every row (an admin may reorder them). */
const COLUMN_DEFS = [
  { key: 'number', label: 'Order', width: 'minmax(8rem,1fr)' },
  { key: 'date', label: 'Date', width: '13rem' },
  { key: 'cashier', label: 'Cashier', width: 'minmax(9rem,1.4fr)' },
  { key: 'customer', label: 'Customer', width: 'minmax(9rem,1.2fr)' },
  { key: 'items', label: 'Items', width: '6rem' },
  { key: 'method', label: 'Payment', width: 'minmax(8rem,1fr)' },
  { key: 'status', label: 'Status', width: '9rem' },
  { key: 'total', label: 'Total', width: '8rem' },
];

/** `?date=YYYY-MM-DD` filters the list to that day, `?from=...&to=...` to those days (set from the Dashboard's chart). */
export const DATE_PARAM = 'date';

/** Sales Orders: every recorded sale, newest first. Open one to see its lines and payment. */
@Component({
  imports: [
    AppCol, ColumnConfig, AppPager,
    DatePipe,
    DateRangeFilter,
    FilterInput,
    MoneyPipe,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmContextMenuImports,
    HlmDropdownMenuImports,
    HlmSelectImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronsUpDown, lucideFilterX })],
  templateUrl: './orders.html',
})
export class OrdersPage {
  protected readonly service = inject(OrdersService);
  private readonly viewer = inject(SalesOrderViewer);
  private readonly actions = inject(OrderActions);
  private readonly receipts = inject(ReceiptPrinting);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly layout = tableLayout('orders', COLUMN_DEFS, '3.5rem');
  protected readonly columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'number', label: 'Order' },
    { key: 'date', label: 'Date' },
    { key: 'cashier', label: 'Cashier' },
    { key: 'customer', label: 'Customer' },
    { key: 'items', label: 'Items', right: true },
    { key: 'method', label: 'Payment' },
    { key: 'status', label: 'Status' },
    { key: 'total', label: 'Total', right: true },
  ];
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusFilters = Object.keys(STATUS_FILTERS) as StatusFilter[];
  protected readonly methodFilters = Object.keys(METHOD_FILTERS) as MethodFilter[];
  protected readonly statusFilterLabel = (s: StatusFilter): string => STATUS_FILTERS[s] ?? '';
  protected readonly methodFilterLabel = (m: MethodFilter): string => METHOD_FILTERS[m] ?? '';

  // Column filters (second header row); they combine.
  protected readonly numberFilter = signal('');
  protected readonly cashierFilter = signal('');
  protected readonly customerFilter = signal('');
  protected readonly methodFilter = signal<MethodFilter>(ALL);
  protected readonly statusFilter = signal<StatusFilter>(ALL);
  protected readonly dateFrom = signal('');
  protected readonly dateTo = signal('');
  protected readonly filtered = computed(
    () => !!(this.numberFilter() || this.cashierFilter() || this.customerFilter() || this.dateFrom() || this.dateTo()) || this.methodFilter() !== ALL || this.statusFilter() !== ALL,
  );

  protected readonly sortKey = signal<SortKey>('date');
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

  protected readonly visible = computed(() => {
    const number = this.numberFilter().trim().toLowerCase();
    const cashier = this.cashierFilter().trim().toLowerCase();
    const customer = this.customerFilter().trim().toLowerCase();
    const method = this.methodFilter();
    const status = this.statusFilter();
    const from = this.dateFrom() ? new Date(`${this.dateFrom()}T00:00:00`).getTime() : -Infinity;
    const to = this.dateTo() ? new Date(`${this.dateTo()}T23:59:59.999`).getTime() : Infinity;
    const value = SORT_VALUES[this.sortKey()];
    const sign = this.sortDirection() === 'asc' ? 1 : -1;
    const compare = (a: SalesOrderSummary, b: SalesOrderSummary): number => {
      const x = value(a);
      const y = value(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign;
    };
    return this.service
      .orders()
      .filter(
        (o) =>
          (!number || o.orderNumber.toLowerCase().includes(number)) &&
          (!cashier || o.employeeName.toLowerCase().includes(cashier)) &&
          (!customer || !!o.customerName?.toLowerCase().includes(customer)) &&
          (method === ALL || o.methods.includes(method as OrderPaymentMethod)) &&
          (status === ALL || (status === 'refund' ? o.isRefund : o.status === (status as Status) && !o.isRefund)) &&
          o.createdAt >= from &&
          o.createdAt <= to,
      )
      .sort(compare);
  });

  protected readonly pager = new Pager(
    () => this.visible(),
    () => [this.numberFilter(), this.cashierFilter(), this.customerFilter(), this.methodFilter(), this.statusFilter(), this.dateFrom(), this.dateTo(), this.sortKey(), this.sortDirection()],
  );
  /** The row that is the target of a link or of the order dialog: highlighted, not selected. */
  protected readonly target = rowTarget();

  // Selection (leftmost column), the same as the other tables: Ctrl/Cmd + click and Shift + click on rows, Shift + click
  // on checkboxes, the header checkbox for the current page. It counts rows that match the filters, on any page.
  // There are no bulk actions on orders yet (void and refund come later), so for now it only marks rows.
  protected readonly selection = new RowSelection(() => this.visible());
  private readonly pageSelected = computed(() => this.pager.rows().filter((o) => this.selection.has(o.id)).length);
  protected readonly selected = computed(() => this.visible().filter((o) => this.selection.has(o.id)));
  protected readonly allSelected = computed(() => this.pager.rows().length > 0 && this.pageSelected() === this.pager.rows().length);
  protected readonly someSelected = computed(() => this.pageSelected() > 0 && !this.allSelected());

  protected isSelected(order: SalesOrderSummary): boolean {
    return this.selection.has(order.id);
  }
  protected toggleRow(order: SalesOrderSummary, on: boolean): void {
    this.selection.toggle(order.id, on);
  }
  protected toggleAll(on: boolean): void {
    this.selection.setMany(this.pager.rows().map((o) => o.id), on);
  }
  protected clearSelection(): void {
    this.selection.clear();
  }

  // Void and refund (completed sales only; a refund order cannot be reversed). Every route (the header buttons, the
  // context menu) goes through `reverse`, which always asks for confirmation and a reason.
  protected readonly canReverse = canReverseOrder;
  protected readonly reversible = computed(() => this.selected().filter(canReverseOrder));

  /** Right-click: acts on the whole selection when the row is part of one, else on the row. */
  protected targetsFor(row: SalesOrderSummary): SalesOrderSummary[] {
    const group = this.reversible();
    return this.isSelected(row) && group.length > 1 ? group : [row];
  }

  protected async reverse(kind: OrderActionKind, orders: SalesOrderSummary[]): Promise<void> {
    const outcome = await this.actions.run(kind, orders.filter(canReverseOrder).map((o) => ({ id: o.id, orderNumber: o.orderNumber, total: o.total })));
    if (outcome) this.selection.remove(outcome.done.map((d) => d.orderId));
  }

  /** A click on a row: Shift or Ctrl/Cmd selects (like a file explorer); a plain click opens the order. */
  protected onRowClick(event: MouseEvent, order: SalesOrderSummary): void {
    if (!this.selection.click(order.id, event)) this.view(order);
  }

  protected resetFilters(): void {
    this.numberFilter.set('');
    this.cashierFilter.set('');
    this.customerFilter.set('');
    this.methodFilter.set(ALL);
    this.statusFilter.set(ALL);
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  protected readonly methodText = methodText;

  /** The badge text: a refund order reads Refund rather than Completed. */
  protected statusLabel(order: SalesOrderSummary): string {
    return order.isRefund ? 'Refund' : STATUS_LABELS[order.status];
  }
  protected statusVariant(order: SalesOrderSummary): 'success' | 'destructive' | 'outline' {
    const status = order.status;
    if (order.isRefund) return 'outline';
    return status === 'completed' ? 'success' : status === 'open' ? 'outline' : 'destructive';
  }

  /** Rows fade in only after the first load. */
  protected readonly animateRows = signal(false);

  constructor() {
    const loaded = this.service.load().then(() => this.animateRows.set(true));
    // `?view-sales-order=<id>` (the dialog is open for it) and `?highlight=<id>` (a link from another page) both
    // target a row: show the page that holds it and highlight it. `highlight` is then removed from the address.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      // `?date=YYYY-MM-DD` (a Dashboard day bar), or `?from=...&to=...` (a week or month bar): show the orders of those days
      // only, then drop the parameters from the address.
      const day = params.get(DATE_PARAM);
      const from = params.get('from') ?? day;
      const to = params.get('to') ?? day;
      if (from || to) {
        const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
        if (isDay(from) && isDay(to)) {
          this.resetFilters();
          this.dateFrom.set(from);
          this.dateTo.set(to);
        }
        void this.router.navigate([], { queryParams: { [DATE_PARAM]: null, from: null, to: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
      const highlight = params.get(HIGHLIGHT_PARAM);
      const id = highlight ?? params.get(VIEW_SALES_ORDER_PARAM);
      if (id) void loaded.then(() => this.reveal(id, !!highlight));
    });
  }

  /** Highlights an order and shows its page; filters that hide it are cleared first. */
  private reveal(id: string, consume: boolean): void {
    if (consume) void this.router.navigate([], { queryParams: { [HIGHLIGHT_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!this.service.orders().some((o) => o.id === id)) return;
    this.target.set(id);
    if (!this.pager.showItem((o) => o.id === id)) {
      this.resetFilters();
      this.pager.showItem((o) => o.id === id);
    }
    scrollToRow(id);
  }

  /** Sends the order's receipt to the printer (or saves it as an image while debugging). */
  protected printReceipt(order: SalesOrderSummary): void {
    void this.receipts.printWithBanner(order.id, order.orderNumber);
  }

  protected view(order: SalesOrderSummary): void {
    void this.viewer.open(order.id);
  }
  /** The menu is given only a row id (the trigger keeps its first data), so the row is looked up fresh. */
  protected orderById(id: string): SalesOrderSummary | undefined {
    return this.service.orders().find((o) => o.id === id);
  }
}
