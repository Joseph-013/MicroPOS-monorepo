import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFilterX, lucideX, lucideMinus, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { type CatalogProduct, type DraftLine, type OrderLineProblem, formatQuantity, isWeighed, type ProductUnit, lineTotal, MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from '@micropos/core';
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
import { CatalogService } from '../../core/data/catalog.service';
import { CheckoutDraftService } from '../../core/data/checkout-draft.service';
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

const PAYMENT_METHODS = { cash: 'Cash', card: 'Card', other: 'Other' } as const;
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
  providers: [provideIcons({ lucideFilterX, lucideX, lucideMinus, lucidePlus, lucideTrash2 })],
  templateUrl: './checkout.html',
})
export class CheckoutPage {
  protected readonly catalog = inject(CatalogService);
  private readonly draft = inject(CheckoutDraftService);
  private readonly banner = inject(BannerService);

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
  protected readonly changeDue = computed(() => Math.max(0, (this.tendered() ?? 0) - this.total()));
  /** Card slip, or a note for "other". */
  protected readonly reference = signal('');
  /** The number this order will get; read from the database. */
  protected readonly orderNumber = signal('');
  protected readonly completing = signal(false);
  protected readonly canComplete = computed(
    () =>
      this.lines().length > 0 &&
      !this.completing() &&
      (this.paymentMethod() !== 'cash' || (this.tendered() !== null && this.tendered()! >= this.total())),
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

  /** True once the saved draft has been read; saving waits for this so an empty start never overwrites it. */
  private readonly draftRestored = signal(false);

  constructor() {
    void this.catalog.load();
    void this.refreshOrderNumber();

    void this.draft.restore().then((saved) => {
      // A scan can arrive before the read finishes; keep what is already on screen in that case.
      if (this.lines().length === 0) this.lines.set(saved);
      this.draftRestored.set(true);
    });
    effect(() => {
      const lines = this.lines();
      if (this.draftRestored()) this.draft.save(lines);
    });
    inject(DestroyRef).onDestroy(() => this.draft.flush());

    // Take control of the scanner while checkout is open; released automatically when the page is destroyed.
    claimScanner(({ code }) => {
      const product = this.catalog.findByCode(code);
      if (product) this.add(product);
      else this.banner.warning(`Unknown barcode ${code}`, { duration: 'long', key: 'unknown-barcode' });
    });
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
    this.lines.set([]);
    this.discount.set(0);
    this.tenderedText.set('');
    this.reference.set('');
  }

  private async refreshOrderNumber(): Promise<void> {
    this.orderNumber.set((await this.draft.nextOrderNumber()) ?? '');
  }

  /** Cash tendered = exactly the total. */
  protected exactCash(): void {
    this.tenderedText.set(formatCentsInput(this.total()));
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
      const method = this.paymentMethod();
      const result = await this.draft.completeOrder({
        lines: this.lines().map((l) => ({ productId: l.productId, quantityMilli: l.quantityMilli, unitPrice: l.unitPrice })),
        discount: this.discount(),
        payment: { method, tendered: method === 'cash' ? (this.tendered() ?? undefined) : undefined, reference: this.reference().trim() || undefined },
      });
      if (!result.ok) {
        this.applyProblems(result.lines);
        this.banner.error(result.lines.length ? result.lines.map((p) => p.error).join('. ') : result.error, { duration: 'long', key: 'complete-order' });
        return;
      }
      this.resetOrder();
      const change = result.change > 0 ? `, change ${formatMoney(result.change)}` : '';
      this.banner.success(`Order ${result.orderNumber} completed${change}`, { duration: 'long', key: 'complete-order' });
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
