import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFilterX, lucideX, lucideMinus, lucideListPlus, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { type CatalogProduct, type CustomerDisplayLine, type CustomerDisplayReceipt, type CustomerDisplayState, type DraftLine, IDLE_DISPLAY_STATE, gramsToQuantityMilli, parseScaleBarcode, type OrderLineProblem, formatQuantity, isWeighed, type ProductUnit, lineTotal, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmButtonGroupImports } from '@spartan-ng/helm/button-group';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { BannerService } from '../../core/banner';
import { scrollToRow } from '../../core/row-target';
import { CatalogService } from '../../core/data/catalog.service';
import { CustomerDisplayService } from '../../core/customer-display.service';
import { SalesOrderViewer } from '../../core/sales-order-viewer';
import { CheckoutDraftService } from '../../core/data/checkout-draft.service';
import { CustomersService } from '../../core/data/customers.service';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { MoneyPipe } from '../../core/money.pipe';
import { AppSettings } from '../../core/settings/app-settings.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { FocusSelectDirective } from '../../core/ui/focus-select.directive';
import { HoldRepeatDirective } from '../../core/ui/hold-repeat.directive';
import { SwipeActions, type SwipeAction, type SwipeActionEvent } from '../../core/ui/swipe-actions';
import { claimScanner } from '../../core/scanner';

const formatMoney = (cents: number): string => new MoneyPipe().transform(cents);

export const ALL_CATEGORIES = 'All categories';

const PAYMENT_METHODS = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' } as const;
type PaymentMethod = keyof typeof PAYMENT_METHODS;

/** Checkout: order lines on the left, payment controls on the right, item browser in a dialog. */
@Component({
  imports: [
    NgIcon,
    FocusSelectDirective,
    OnScreenKeypadDirective,
    HoldRepeatDirective,
    SwipeActions,
    MoneyPipe,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmComboboxImports,
    HlmButtonGroupImports,
    HlmContextMenuImports,
    HlmDialogImports,
    HlmDropdownMenuImports,
    HlmInputImports,
    HlmLabelImports,
    HlmSelectImports,
  ],
  providers: [provideIcons({ lucideFilterX, lucideX, lucideListPlus, lucideMinus, lucidePlus, lucideTrash2 })],
  templateUrl: './checkout.html',
})
export class CheckoutPage {
  protected readonly catalog = inject(CatalogService);
  private readonly draft = inject(CheckoutDraftService);
  private readonly banner = inject(BannerService);
  private readonly viewer = inject(SalesOrderViewer);
  protected readonly customers = inject(CustomersService);
  /** The customer-facing window (opened and closed in Settings): kept up to date with the order. */
  private readonly display = inject(CustomerDisplayService);

  // The order in progress. It is saved automatically as a draft and restored when the page opens.
  protected readonly lines = signal<DraftLine[]>([]);
  protected readonly lineTotals = computed(() => this.lines().map((l) => ({ ...l, total: lineTotal(l.unitPrice, l.quantityMilli) })));
  protected readonly subtotal = computed(() => this.lineTotals().reduce((sum, l) => sum + l.total, 0));
  protected readonly discount = signal(0);
  protected readonly paymentMethod = signal<PaymentMethod>('cash');
  /** Label shown in the closed select (the raw value is lowercase). */
  protected readonly paymentLabel = (method: PaymentMethod): string => PAYMENT_METHODS[method] ?? '';
  protected readonly total = computed(() => this.subtotal() - this.discount());

  /** Cash handed over, as typed; the change due is worked out from it. */
  protected readonly tenderedText = signal('');
  protected readonly tendered = computed(() => parseCents(this.tenderedText()));
  protected readonly changeDue = computed(() => Math.max(0, (this.tendered() ?? 0) - (this.payNow() ?? this.total())));

  // Credit: with a customer chosen, part of the total can be paid now and the rest goes on their account.
  protected readonly customerId = signal<string | null>(null);
  protected readonly customer = computed(() => this.customers.customers().find((c) => c.id === this.customerId()) ?? null);
  protected readonly customerName = (id: string | null): string => this.customers.customers().find((c) => c.id === id)?.name ?? '';
  /** What is paid now, as typed; empty means the whole total. */
  protected readonly payNowText = signal('');
  /** Cents paid now: the whole total without a customer or when the field is empty; null while the text is not an amount. */
  protected readonly payNow = computed<number | null>(() => {
    const text = this.payNowText().trim();
    if (!this.customerId() || text === '') return this.total();
    return parseCents(text);
  });
  /** The whole sale goes on a customer's account: there is no payment to describe (no method, tendered cash or reference). */
  protected readonly nothingPaid = computed(() => this.customerId() !== null && this.payNow() === 0);
  protected readonly onAccount = computed(() => Math.max(0, this.total() - (this.payNow() ?? this.total())));
  /** True when putting the rest on account would take the customer past their credit limit. */
  protected readonly overLimit = computed(() => {
    const customer = this.customer();
    return !!customer && customer.creditLimit !== null && this.onAccount() > 0 && customer.balance + this.onAccount() > customer.creditLimit;
  });
  protected readonly customerSummary = computed(() => {
    const c = this.customer();
    if (!c) return '';
    const owes = c.balance > 0 ? `Owes ${formatMoney(c.balance)}` : c.balance < 0 ? `Credit ${formatMoney(-c.balance)}` : 'Owes nothing';
    return c.creditLimit === null ? owes : `${owes} · limit ${formatMoney(c.creditLimit)}`;
  });
  /** Card slip, or a note for "other". */
  protected readonly reference = signal('');
  /** The number this order will get; read from the database. */
  protected readonly orderNumber = signal('');
  protected readonly completing = signal(false);
  protected readonly canComplete = computed(
    () =>
      this.lines().length > 0 &&
      !this.completing() &&
      this.payNow() !== null &&
      this.payNow()! <= this.total() &&
      (this.onAccount() === 0 || !!this.customer()) &&
      !this.overLimit() &&
      (this.paymentMethod() !== 'cash' || this.payNow() === 0 || (this.tendered() !== null && this.tendered()! >= this.payNow()!)),
  );

  // Item browser (dialog). One search box matches name, barcode/PLU and SKU.
  protected readonly category = signal<string | null>(ALL_CATEGORIES);
  protected readonly query = signal('');
  protected readonly filtered = computed(() => this.query() !== '' || this.category() !== ALL_CATEGORIES);
  protected resetFilters(): void {
    this.query.set('');
    this.category.set(ALL_CATEGORIES);
  }
  protected readonly categoryNames = computed(() => [
    ALL_CATEGORIES,
    ...this.catalog
      .categories()
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b)),
  ]);
  protected readonly visibleProducts = computed(() => {
    const category = this.category() ?? ALL_CATEGORIES;
    const query = this.query().trim().toLowerCase();
    return this.catalog
      .products()
      .filter(
        (p) =>
          (category === ALL_CATEGORIES || p.categories.some((c) => c.name === category)) &&
          (!query || [p.name, p.barcode, p.sku].some((field) => field?.toLowerCase().includes(query))),
      );
  });

  /** The line added or changed last: it stays highlighted (and was scrolled into view) until another line is touched. */
  private readonly lastTouched = signal<string | null>(null);
  protected readonly highlightId = computed(() => (this.lines().some((l) => l.productId === this.lastTouched()) ? this.lastTouched() : null));

  /** Marks a line as the latest one added or changed and brings it into view (the customer display shows the same line). */
  private touch(productId: string): void {
    this.lastTouched.set(productId);
    scrollToRow(productId);
  }

  /** The sale just completed, shown on the customer display (thank-you and change) until the next item is scanned. */
  private readonly paidSale = signal<{ receipt: CustomerDisplayReceipt; lines: CustomerDisplayLine[] } | null>(null);
  /** What the customer sees: the order as it is rung up, the thank-you right after paying, or the welcome screen. */
  private readonly displayState = computed<CustomerDisplayState>(() => {
    const lines = this.lineTotals().map((l) => ({ name: l.name, unit: l.unit, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, total: l.total }));
    if (lines.length) {
      const highlight = this.lineTotals().findIndex((l) => l.productId === this.highlightId());
      return { phase: 'shopping', lines, total: this.total(), highlight: highlight >= 0 ? highlight : null, receipt: null };
    }
    const sale = this.paidSale();
    return sale ? { phase: 'paid', lines: sale.lines, total: sale.receipt.total, highlight: null, receipt: sale.receipt } : IDLE_DISPLAY_STATE;
  });

  /** True once the saved draft has been read; saving waits for this so an empty start never overwrites it. */
  private readonly draftRestored = signal(false);

  constructor() {
    void this.catalog.load();
    void this.refreshOrderNumber();
    void this.customers.load();

    void this.draft.restore().then((saved) => {
      // A scan can arrive before the read finishes; keep what is already on screen in that case.
      if (this.lines().length === 0) this.lines.set(saved);
      this.draftRestored.set(true);
    });
    effect(() => {
      const lines = this.lines();
      if (this.draftRestored()) this.draft.save(lines);
    });
    effect(() => this.display.publish(this.displayState()));
    // The thank-you gives way to the next customer's items as soon as one is added.
    effect(() => {
      if (this.lines().length) untracked(() => this.paidSale.set(null));
    });
    inject(DestroyRef).onDestroy(() => this.draft.flush());

    // Take control of the scanner while checkout is open; released automatically when the page is destroyed.
    claimScanner(({ code }) => {
      const product = this.catalog.findByCode(code);
      if (product) return this.add(product);
      if (this.addScaleLabel(code)) return;
      this.banner.warning(`Unknown barcode ${code}`, { duration: 'long', key: 'unknown-barcode' });
    });
  }

  /**
   * A scale label (EAN-13 starting with 2) carries a PLU and a weight: the weighed product with that PLU is added
   * with that weight, and a second label for the same product adds its weight to the line. Returns false when the
   * code is not a scale label; a label whose PLU is unknown is reported here.
   */
  private addScaleLabel(code: string): boolean {
    const label = parseScaleBarcode(code);
    if (!label) return false;
    const product = this.catalog.products().find((p) => p.barcode === label.plu && isWeighed(p.unit));
    const quantityMilli = product ? gramsToQuantityMilli(label.grams, product.unit) : null;
    if (!product || quantityMilli === null) {
      this.banner.warning(`Unknown PLU ${label.plu}`, { duration: 'long', key: 'unknown-barcode' });
      return true;
    }
    this.lines.update((lines) =>
      lines.some((l) => l.productId === product.id)
        ? lines.map((l) => (l.productId === product.id ? { ...l, quantityMilli: this.clamp(l.quantityMilli + quantityMilli) } : l))
        : [...lines, { productId: product.id, name: product.name, quantityMilli: this.clamp(quantityMilli), unitPrice: product.price, unit: product.unit }],
    );
    this.touch(product.id);
    return true;
  }

  /** The Add button in the item browser: add the item and confirm it in a banner. */
  protected addFromBrowser(product: CatalogProduct): void {
    this.add(product);
    // Same key per product, so tapping Add repeatedly keeps one banner alive instead of queueing many.
    this.banner.success(`${product.name} added`, { key: `added:${product.id}` });
  }

  protected readonly quantityLabel = formatQuantity;

  /** "kg" next to a quantity or price of a weighed line; nothing for counted items. */
  protected unitLabel(unit: ProductUnit): string {
    return isWeighed(unit) ? unit : '';
  }

  /** How much +/- changes a line, in thousandths: whole items, or a sensible weight step. */
  protected stepMilli(unit: ProductUnit): number {
    return { each: MILLI, kg: 100, lb: 100, oz: MILLI, g: 50 * MILLI }[unit];
  }

  protected add(product: CatalogProduct): void {
    const weighed = isWeighed(product.unit);
    this.lines.update((lines) =>
      lines.some((l) => l.productId === product.id)
        ? weighed
          ? lines // a weighed item is one line with one weight: asking for it again edits that weight
          : lines.map((l) => (l.productId === product.id ? { ...l, quantityMilli: this.clamp(l.quantityMilli + MILLI) } : l))
        : [...lines, { productId: product.id, name: product.name, quantityMilli: MILLI, unitPrice: product.price, unit: product.unit }],
    );
    this.touch(product.id);
    // Weighed items need their weight: open the quantity field right away.
    if (weighed) this.inlineEditing.set(product.id);
  }

  /**
   * Steps a line's quantity by `deltaMilli`. A tap that reaches zero removes the line; a held press
   * (`repeating`) stops at the last unit instead, so holding "-" cannot wipe a line out by accident.
   */
  protected change(line: DraftLine, direction: 1 | -1, repeating = false): void {
    const productId = line.productId;
    const deltaMilli = direction * this.stepMilli(line.unit);
    this.lines.update((lines) =>
      lines
        .map((l) => {
          if (l.productId !== productId) return l;
          const next = l.quantityMilli + deltaMilli;
          return repeating && next <= 0 ? l : { ...l, quantityMilli: this.clamp(next) };
        })
        .filter((l) => l.quantityMilli > 0),
    );
    this.touch(productId);
  }

  private clamp(quantityMilli: number): number {
    return Math.min(quantityMilli, MAX_QUANTITY_UNITS * MILLI);
  }

  /** Swipe an order line to the left to remove it (touch). */
  protected readonly lineSwipeLeft: SwipeAction[] = [{ id: 'remove', label: 'Remove', icon: 'lucideTrash2', tone: 'destructive', exit: true }];

  protected runLineAction(event: SwipeActionEvent, line: DraftLine): void {
    if (event.action.id === 'remove') this.removeLine(line.productId);
  }

  protected readonly settings = inject(AppSettings);

  /** The line whose quantity is being typed in place; null when none. */
  protected readonly inlineEditing = signal<string | null>(null);

  /**
   * Tap a quantity to enter an exact amount (decimals allowed, e.g. 1.25 kg): it becomes a field in place. With
   * the on-screen keyboard setting on, a keypad floats next to the field (`appOnScreenKeypad`).
   */
  protected editQuantity(line: DraftLine): void {
    this.inlineEditing.set(line.productId);
  }

  /** Ends in-place editing: Enter or leaving the field keeps a valid amount, Escape or a bad one keeps the old. */
  protected finishInline(line: DraftLine, text: string, keep: boolean): void {
    if (this.inlineEditing() !== line.productId) return; // already finished (Enter, then the blur it causes)
    this.inlineEditing.set(null);
    const quantityMilli = keep ? parseQuantityMilli(text) : null;
    if (quantityMilli === null) return;
    this.lines.update((lines) => lines.map((l) => (l.productId === line.productId ? { ...l, quantityMilli } : l)));
    this.touch(line.productId);
  }

  /** Takes one line off the order (context menu or swipe). */
  protected removeLine(productId: string): void {
    this.lines.update((lines) => lines.filter((l) => l.productId !== productId));
  }

  /** Empties the order and removes the saved draft. */
  protected clearOrder(): void {
    this.resetOrder();
    this.draft.clear();
  }

  private resetOrder(): void {
    this.paidSale.set(null);
    this.lastTouched.set(null);
    this.lines.set([]);
    this.discount.set(0);
    this.tenderedText.set('');
    this.reference.set('');
    this.customerId.set(null);
    this.payNowText.set('');
  }

  private async refreshOrderNumber(): Promise<void> {
    this.orderNumber.set((await this.draft.nextOrderNumber()) ?? '');
  }

  /** Cash tendered = exactly the total. */
  protected exactCash(): void {
    this.tenderedText.set(formatCentsInput(this.payNow() ?? this.total()));
  }

  /**
   * Completes the order: the main process re-checks prices and stock and records the order, payment and stock in
   * one transaction. If an item changed meanwhile nothing is recorded; the lines are brought up to date and the
   * cashier looks again before confirming.
   */
  protected async complete(): Promise<void> {
    if (!this.canComplete()) return;
    this.completing.set(true);
    try {
      const nothingPaid = this.nothingPaid();
      const method = nothingPaid ? 'cash' : this.paymentMethod();
      const result = await this.draft.completeOrder({
        lines: this.lines().map((l) => ({ productId: l.productId, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice })),
        discount: this.discount(),
        ...(this.customerId() ? { customerId: this.customerId()!, amountPaid: this.payNow()! } : {}),
        payment: { method, tendered: method === 'cash' && this.payNow() !== 0 ? (this.tendered() ?? undefined) : undefined, reference: nothingPaid ? undefined : this.reference().trim() || undefined },
      });
      if (!result.ok) {
        this.applyProblems(result.lines);
        this.banner.error(result.lines.length ? result.lines.map((p) => p.error).join('. ') : result.error, { duration: 'long', key: 'complete-order' });
        return;
      }
      const soldLines = this.displayState().lines; // before the order is emptied
      this.resetOrder();
      this.paidSale.set({ receipt: { orderNumber: result.orderNumber, total: result.total, change: result.change, onAccount: result.onAccount }, lines: soldLines });
      const change = result.change > 0 ? `, change ${formatMoney(result.change)}` : '';
      const credit = result.onAccount > 0 ? `, ${formatMoney(result.onAccount)} on account` : '';
      void this.customers.load(); // the balance changed
      this.banner.success(`Order ${result.orderNumber} completed${change}${credit}`, {
        duration: 6000,
        key: 'complete-order',
        action: { label: 'View', run: () => void this.viewer.open(result.orderId) },
      });
      await this.refreshOrderNumber();
      void this.catalog.load(); // stock-dependent lists stay current
    } finally {
      this.completing.set(false);
    }
  }

  /** Brings the lines in line with what the main process found: new prices in, unavailable items out. */
  private applyProblems(problems: OrderLineProblem[]): void {
    if (!problems.length) return;
    this.lines.update((lines) =>
      lines
        .filter((l) => !problems.some((p) => p.productId === l.productId && p.kind === 'unavailable'))
        .map((l) => {
          const price = problems.find((p) => p.productId === l.productId && p.kind === 'price')?.current;
          return price ? { ...l, name: price.name, unitPrice: price.unitPrice, unit: price.unit } : l;
        }),
    );
  }
}
