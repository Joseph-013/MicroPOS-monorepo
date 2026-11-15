import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal, TemplateRef, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import type { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { CheckoutCopy } from '../../core/checkout-copy';
import { QuantityForm, type QuantityContext } from './quantity-form';
import { RowSelection } from '../../core/ui/row-selection';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { PaymentDialog, type PaymentDialogContext } from './payment-dialog';
import { NavDrawer } from '../../core/nav-drawer';
import { lucideFilterX, lucideX, lucideMinus, lucideListPlus, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { discountCents, type DiscountSpec, formatDiscount, MAX_ORDER_NOTE, type CatalogProduct, type CustomerDisplayLine, type CustomerDisplayReceipt, type CustomerDisplayState, type DraftLine, IDLE_DISPLAY_STATE, gramsToQuantityMilli, parseScaleBarcode, type OrderLineProblem, formatQuantity, isWeighed, type ProductUnit, lineTotal, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from '@micropos/core';
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
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { firstValueFrom } from 'rxjs';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { ProductViewer } from '../../core/product-viewer';
import { AuthService } from '../../core/auth/auth.service';
import { BannerService } from '../../core/banner';
import { DiscountForm, type DiscountContext, type DiscountOutcome } from './discount-form';
import { ReceiptPrinting } from '../../core/receipt-printing';
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
import { CameraScanButton, CameraScanInline, claimScanner } from '../../core/scanner';
import { isLanDevice } from '../../core/api/remote-api';

const formatMoney = (cents: number): string => new MoneyPipe().transform(cents);

export const ALL_CATEGORIES = 'All categories';

const PAYMENT_METHODS = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' } as const;
type PaymentMethod = keyof typeof PAYMENT_METHODS;

/** Checkout: order lines on the left, payment controls on the right, item browser in a dialog. */
/** Sign-ins (the user object `AuthService` sets on each) already told about others' orders in progress. */
const announcedOthersFor = new WeakSet<object>();

@Component({
  imports: [HlmCheckboxImports, CameraScanButton, CameraScanInline, NgTemplateOutlet,
    HlmSwitchImports,
    NgIcon,
    FocusSelectDirective,
    OnScreenKeypadDirective,
    HoldRepeatDirective,
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
  private readonly dialogs = inject(HlmDialogService);
  protected readonly auth = inject(AuthService);
  private readonly productViewer = inject(ProductViewer);
  protected readonly customers = inject(CustomersService);
  /** The customer-facing window (opened and closed in Settings): kept up to date with the order. */
  private readonly display = inject(CustomerDisplayService);

  // The order in progress. It is saved automatically as a draft and restored when the page opens.
  protected readonly lines = signal<DraftLine[]>([]);
  /** Each line with its price times quantity (`total`), what its own discount takes off (`off`, from `discount` as entered), and what is left (`net`). */
  protected readonly lineTotals = computed(() =>
    this.lines().map((l) => {
      const total = lineTotal(l.unitPrice, l.quantityMilli);
      const off = discountCents(l.discount, total);
      return { ...l, total, off, net: total - off };
    }),
  );
  protected readonly subtotal = computed(() => this.lineTotals().reduce((sum, l) => sum + l.total, 0));
  /** Taken off by the lines' own discounts. */
  protected readonly lineDiscounts = computed(() => this.lineTotals().reduce((sum, l) => sum + l.off, 0));
  /** The discount on the whole order as entered (an amount or a percent of what is left after the line discounts). */
  protected readonly orderDiscountSpec = signal<DiscountSpec | null>(null);
  protected readonly orderDiscount = computed(() => discountCents(this.orderDiscountSpec(), this.subtotal() - this.lineDiscounts()));
  /** All discounts together (shown in the totals). */
  protected readonly discount = computed(() => this.lineDiscounts() + this.orderDiscount());
  /** Why a discount was given, and a remark on the sale (both optional). */
  protected readonly discountReason = signal('');
  protected readonly note = signal('');
  protected readonly maxNote = MAX_ORDER_NOTE;
  /** The item name opens the product (it needs the permission to see items; a cashier without it sees plain text). */
  protected readonly canViewProduct = computed(() => this.auth.can('catalog.view'));
  protected viewProduct(productId: string): void {
    void this.productViewer.open(productId);
  }
  protected readonly canDiscount = computed(() => this.auth.can('discounts.give'));
  protected readonly formatDiscount = formatDiscount;
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
    const lines = this.lineTotals().map((l) => ({ name: l.name, unit: l.unit, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, total: l.net }));
    if (lines.length) {
      const highlight = this.lineTotals().findIndex((l) => l.productId === this.highlightId());
      return { phase: 'shopping', lines, total: this.total(), highlight: highlight >= 0 ? highlight : null, receipt: null };
    }
    const sale = this.paidSale();
    return sale ? { phase: 'paid', lines: sale.lines, total: sale.receipt.total, highlight: null, receipt: sale.receipt } : IDLE_DISPLAY_STATE;
  });

  /** True once the saved draft has been read; saving waits for this so an empty start never overwrites it. */
  private readonly draftRestored = signal(false);

  private readonly checkoutCopy = inject(CheckoutCopy);
  private readonly api = inject(DESKTOP_API);

  constructor() {
    // Items copied from a recorded sale join the order once the catalog and the saved order are both in.
    effect(() => {
      if (this.catalog.status() === 'ready' && this.draftRestored() && this.checkoutCopy.pending()) untracked(() => this.addCopied());
    });
    // Growing past the phone breakpoint puts the controls back beside the order.
    effect(() => {
      if (!this.mobile()) this.paymentDialog?.close(undefined);
    });
    void this.catalog.load();
    void this.refreshOrderNumber();
    void this.customers.load();

    void this.draft.restore().then((saved) => {
      // A scan can arrive before the read finishes; keep what is already on screen in that case.
      if (this.lines().length === 0) {
        this.lines.set(saved.lines);
        this.orderDiscountSpec.set(saved.orderDiscount ?? null);
        this.discountReason.set(saved.discountReason ?? '');
        this.note.set(saved.note ?? '');
      }
      this.draftRestored.set(true);
    });
    void this.announceOthersInProgress();
    effect(() => {
      const lines = this.lines();
      const orderDiscount = this.orderDiscountSpec();
      const discountReason = this.discountReason();
      const note = this.note();
      if (this.draftRestored()) this.draft.save({ lines, ...(orderDiscount ? { orderDiscount } : {}), ...(discountReason ? { discountReason } : {}), ...(note ? { note } : {}) });
    });
    effect(() => this.display.publish(this.displayState()));
    // Live: when a product is edited, deleted or made inactive, the lines follow it (without waiting for Complete Order to refuse).
    effect(() => {
      const products = this.catalog.products();
      if (this.catalog.status() === 'ready' && this.draftRestored()) untracked(() => this.followCatalog(products));
    });
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

  protected readonly settings = inject(AppSettings);
  /** A phone-sized screen: the payment controls open in a dialog (Pay) instead of sitting beside the order. */
  protected readonly mobile = inject(NavDrawer).mobile;
  private readonly paymentTemplate = viewChild.required<TemplateRef<unknown>>('payment');
  private paymentDialog: BrnDialogRef | undefined;
  private readonly receipts = inject(ReceiptPrinting);

  /** Lines ticked for a bulk action (remove, discount, quantity). */
  protected readonly selection = new RowSelection<{ id: string }>(() => this.lines().map((l) => ({ id: l.productId })));
  /** The ticked lines that are still on the order. */
  protected readonly selectedLines = computed(() => this.lines().filter((l) => this.selection.has(l.productId)));
  protected readonly allSelected = computed(() => this.lines().length > 0 && this.selectedLines().length === this.lines().length);
  protected readonly someSelected = computed(() => this.selectedLines().length > 0 && !this.allSelected());

  protected toggleAll(on: boolean): void {
    this.selection.setMany(this.lines().map((l) => l.productId), on);
  }

  /** Ctrl/Cmd or Shift on a line selects it like in the tables; a plain click does nothing here. */
  protected rowClick(line: DraftLine, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button, input, a')) return;
    this.selection.click(line.productId, event);
  }

  /** Takes the ticked lines off the order. */
  protected removeSelected(): void {
    const ids = new Set(this.selectedLines().map((l) => l.productId));
    if (!ids.size) return;
    this.lines.update((lines) => lines.filter((l) => !ids.has(l.productId)));
    this.selection.clear();
  }

  /** One discount (an amount or a percent) on each ticked line; blank removes theirs. */
  protected async discountSelected(): Promise<void> {
    const picked = this.selectedLines();
    if (!picked.length || !this.canDiscount()) return;
    const base = picked.reduce((sum, l) => sum + lineTotal(l.unitPrice, l.quantityMilli), 0);
    const outcome = await this.askDiscount({ title: `Discount on ${picked.length} ${picked.length === 1 ? 'item' : 'items'}`, base, current: picked.length === 1 ? (picked[0].discount ?? null) : null, reason: this.discountReason(), eachOf: picked.length });
    if (!outcome) return;
    const ids = new Set(picked.map((l) => l.productId));
    this.lines.update((lines) => lines.map((l) => (ids.has(l.productId) ? { productId: l.productId, name: l.name, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, unit: l.unit, ...(outcome.spec ? { discount: outcome.spec } : {}) } : l)));
    this.discountReason.set(outcome.reason);
  }

  /** The same quantity on each ticked line. */
  protected async quantitySelected(): Promise<void> {
    const picked = this.selectedLines();
    if (!picked.length) return;
    const ref = this.dialogs.open<number, QuantityContext>(QuantityForm, {
      id: 'checkout-quantity',
      contentClass: 'w-[min(24rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { title: `Quantity of ${picked.length} ${picked.length === 1 ? 'item' : 'items'}` },
    });
    const quantityMilli = await firstValueFrom(ref.closed$);
    if (!quantityMilli) return;
    const ids = new Set(picked.map((l) => l.productId));
    this.lines.update((lines) => lines.map((l) => (ids.has(l.productId) ? { ...l, quantityMilli } : l)));
  }

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

  /** Opens the discount dialog; resolves with what was chosen, or null when cancelled. */
  private async askDiscount(context: DiscountContext): Promise<DiscountOutcome | null> {
    const ref = this.dialogs.open<DiscountOutcome, DiscountContext>(DiscountForm, {
      id: 'checkout-discount',
      contentClass: 'w-[min(26rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context,
    });
    return (await firstValueFrom(ref.closed$)) ?? null;
  }

  /** The discount on the whole order (the button in the totals). */
  protected async editOrderDiscount(): Promise<void> {
    if (!this.lines().length) return;
    const outcome = await this.askDiscount({ title: 'Discount on the order', base: this.subtotal() - this.lineDiscounts(), current: this.orderDiscountSpec(), reason: this.discountReason() });
    if (!outcome) return;
    this.orderDiscountSpec.set(outcome.spec);
    this.discountReason.set(outcome.reason);
  }

  /** The discount on one item (its context menu). */
  protected async editLineDiscount(productId: string): Promise<void> {
    const line = this.lines().find((l) => l.productId === productId);
    if (!line) return;
    const total = lineTotal(line.unitPrice, line.quantityMilli);
    const outcome = await this.askDiscount({ title: `Discount on ${line.name}`, base: total, current: line.discount ?? null, reason: this.discountReason() });
    if (!outcome) return;
    this.setLineDiscount(line.productId, outcome.spec);
    this.discountReason.set(outcome.reason);
  }

  protected setLineDiscount(productId: string, spec: DiscountSpec | null): void {
    this.lines.update((lines) => lines.map((l) => (l.productId === productId ? { productId: l.productId, name: l.name, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, unit: l.unit, ...(spec ? { discount: spec } : {}) } : l)));
  }

  /** Takes one line off the order (context menu). */
  protected removeLine(productId: string): void {
    this.lines.update((lines) => lines.filter((l) => l.productId !== productId));
  }

  protected openPayment(): void {
    this.paymentDialog = this.dialogs.open<unknown, PaymentDialogContext>(PaymentDialog, {
      id: 'checkout-payment',
      context: { template: this.paymentTemplate() },
      contentClass: 'w-[min(26rem,95vw)] max-w-none sm:max-w-none max-h-[95svh] grid-rows-[minmax(0,1fr)] gap-0 p-0 overflow-hidden',
    });
  }

  /** Empties the order and removes the saved draft. */
  protected clearOrder(): void {
    this.resetOrder();
    this.draft.clear();
  }

  private resetOrder(): void {
    this.selection.clear();
    this.paidSale.set(null);
    this.lastTouched.set(null);
    this.lines.set([]);
    this.orderDiscountSpec.set(null);
    this.discountReason.set('');
    this.note.set('');
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
        lines: this.lineTotals().map((l) => ({ productId: l.productId, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, ...(l.off ? { discount: l.off } : {}) })),
        discount: this.orderDiscount(),
        ...(this.discount() > 0 && this.discountReason().trim() ? { discountReason: this.discountReason().trim() } : {}),
        ...(this.note().trim() ? { note: this.note().trim() } : {}),
        ...(this.customerId() ? { customerId: this.customerId()!, amountPaid: this.payNow()! } : {}),
        payment: { method, tendered: method === 'cash' && this.payNow() !== 0 ? (this.tendered() ?? undefined) : undefined, reference: nothingPaid ? undefined : this.reference().trim() || undefined },
      });
      if (!result.ok) {
        this.applyProblems(result.lines);
        this.banner.error(result.lines.length ? result.lines.map((p) => p.error).join('. ') : result.error, { duration: 'long', key: 'complete-order' });
        return;
      }
      this.paymentDialog?.close(undefined);
      const soldLines = this.displayState().lines; // before the order is emptied
      this.resetOrder();
      this.paidSale.set({ receipt: { orderNumber: result.orderNumber, total: result.total, change: result.change, onAccount: result.onAccount }, lines: soldLines });
      const change = result.change > 0 ? `, change ${formatMoney(result.change)}` : '';
      const credit = result.onAccount > 0 ? `, ${formatMoney(result.onAccount)} on account` : '';
      void this.customers.load(); // the balance changed
      const saleText = `Order ${result.orderNumber} completed${change}${credit}`;
      const saleBanner = { duration: 6000, key: 'complete-order', action: { label: 'View', run: () => void this.viewer.open(result.orderId) } } as const;
      this.banner.success(saleText, saleBanner);
      if (this.settings.printReceiptAfterSale()) {
        // The sale is already recorded and shown; the print result is added to the same banner when it comes (it can take a few seconds).
        void this.receipts.print(result.orderId).then((printed) => {
          if (printed.ok) this.banner.success(`${saleText} · ${printed.savedTo ? 'receipt saved as an image' : 'receipt printed'}`, saleBanner);
          else this.banner.warning(`${saleText} · receipt not printed: ${printed.error}`, { ...saleBanner, duration: 'long' });
        });
      }
      await this.refreshOrderNumber();
      void this.catalog.load(); // stock-dependent lists stay current
    } finally {
      this.completing.set(false);
    }
  }

  /**
   * Brings the lines in line with the catalog as it is now: a changed price, name or unit is taken over and said in a
   * banner; an item that is gone or no longer active comes off the order (the main process would refuse it anyway).
   */
  private followCatalog(products: readonly CatalogProduct[]): void {
    const lines = this.lines();
    const byId = new Map(products.map((p) => [p.id, p]));
    const messages: string[] = [];
    const next: DraftLine[] = [];
    for (const line of lines) {
      const product = byId.get(line.productId);
      if (!product) {
        messages.push(`${line.name} is no longer available and was taken off the order`);
        continue;
      }
      if (product.price !== line.unitPrice || product.name !== line.name || product.unit !== line.unit) {
        if (product.price !== line.unitPrice) messages.push(`The price of ${product.name} is now ${formatMoney(product.price)}`);
        next.push({ ...line, name: product.name, unitPrice: product.price, unit: product.unit });
      } else next.push(line);
    }
    if (!messages.length) return;
    this.lines.set(next);
    this.banner.warning(messages.join('. '), { duration: 'long', key: 'catalog-changed' });
  }

  /**
   * Adds the items of a sale copied from Sales Orders. They are added to the order in progress (quantities join a line already there),
   * at today's prices; products that are gone or no longer for sale are skipped and named, and a changed price is mentioned.
   * Stock is not checked here: Complete Order refuses an item that is short, as for any item.
   */
  private addCopied(): void {
    const copied = this.checkoutCopy.take();
    if (!copied) return;
    const byId = new Map(this.catalog.products().map((p) => [p.id, p]));
    const missing: string[] = [];
    const repriced: string[] = [];
    let added = 0;
    if (copied.mode === 'replace') this.resetOrder();
    const lines = [...this.lines()];
    for (const item of copied.lines) {
      const product = byId.get(item.productId);
      if (!product) {
        missing.push(item.name);
        continue;
      }
      if (product.price !== item.unitPrice) repriced.push(`${product.name} is now ${formatMoney(product.price)}`);
      const at = lines.findIndex((l) => l.productId === product.id);
      if (at >= 0) lines[at] = { ...lines[at], quantityMilli: this.clamp(lines[at].quantityMilli + item.quantityMilli) };
      else lines.push({ productId: product.id, name: product.name, quantityMilli: this.clamp(item.quantityMilli), unitPrice: product.price, unit: product.unit });
      added++;
      this.touch(product.id);
    }
    if (added) this.lines.set(lines);
    const notes = [
      added ? `${added} ${added === 1 ? 'item' : 'items'} copied from ${copied.orderNumber}` : `Nothing could be copied from ${copied.orderNumber}`,
      ...(missing.length ? [`not for sale any more: ${missing.join(', ')}`] : []),
      ...(repriced.length ? [`price changed: ${repriced.join(', ')}`] : []),
    ];
    const show = (extra: string[]): void => {
      const text = [...notes, ...extra].join('. ');
      if (missing.length || repriced.length || extra.length || !added) this.banner.warning(text, { duration: 'long', key: 'copy-order' });
      else this.banner.success(text, { key: 'copy-order' });
    };
    show([]);
    void this.warnShortStock(lines.filter((l) => copied.lines.some((c) => c.productId === l.productId)), show);
  }

  /**
   * Looks at what can be sold now of the copied products (stock that has not expired) and names those that are out or short
   * for the quantity now on the order. A warning only: the lines stay so the cashier decides, and Complete Order still refuses
   * a line that is really short.
   */
  private async warnShortStock(lines: DraftLine[], show: (extra: string[]) => void): Promise<void> {
    try {
      const stock = (await this.api?.checkout.availableStock(lines.map((l) => l.productId))) ?? [];
      const problems: string[] = [];
      for (const line of lines) {
        const available = stock.find((s) => s.productId === line.productId)?.availableMilli;
        if (available === null || available === undefined || available >= line.quantityMilli) continue;
        problems.push(available <= 0 ? `${line.name} is out of stock` : `only ${formatQuantity(available)}${this.unitLabel(line.unit) ? ' ' + this.unitLabel(line.unit) : ''} of ${line.name} left`);
      }
      if (problems.length) show([problems.join(', ')]);
    } catch (error) {
      console.error('Could not check the stock of the copied items', error);
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

  /**
   * Orders in progress belong to the person who started them; someone else's waits for them on this till. Says so once
   * per sign-in (not on every return to Checkout): "Sam has an order in progress on this till".
   */
  private async announceOthersInProgress(): Promise<void> {
    const user = this.auth.user();
    if (!user || announcedOthersFor.has(user)) return;
    announcedOthersFor.add(user);
    const names = await this.draft.othersInProgress();
    if (!names.length) return;
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const place = isLanDevice() ? 'this device' : 'this till';
    this.banner.info(`${who} ${names.length === 1 ? 'has an order' : 'have orders'} in progress on ${place}`, { duration: 'long', key: 'others-in-progress' });
  }
}
