import { Component, computed, effect, inject, signal } from '@angular/core';
import { formatQuantity, parseQuantityMilli, type ProductRecord, type StockField, tracksBatches, tracksExpiry } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { NewProductViewer } from '../../core/new-product-viewer';
import { BannerService } from '../../core/banner';
import { InventoryService } from '../../core/data/inventory.service';
import { ProductsService } from '../../core/data/products.service';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { claimScanner, ScanInputDirective } from '../../core/scanner';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface ReceiveStockContext {
  /** Product to receive stock for, when opened from a product row. */
  product?: ProductRecord;
}

const DAY_MS = 86_400_000;

/** `yyyy-mm-dd` of a moment, in local time (what a date input shows). */
export const toDateInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** The end of a local day, so a product is good through its printed date. */
export const fromDateInput = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Receive stock: pick a product (or scan it), then lot, expiry, quantity and cost as its tracking asks. */
@Component({
  host: { class: 'contents' },
  imports: [
    OnScreenKeypadDirective,
    ScanInputDirective,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmComboboxImports,
    HlmDialogImports,
    HlmInputImports,
    HlmLabelImports,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Receive stock</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="r-product">Product</label>
        <hlm-combobox [value]="productId()" (valueChange)="choose($event ?? null)" [itemToString]="productName" class="block">
          <hlm-combobox-input id="r-product" placeholder="Search or scan a product" />
          <hlm-combobox-content *hlmComboboxPortal>
            <hlm-combobox-empty>No tracked product found</hlm-combobox-empty>
            <div hlmComboboxList>
              @for (p of trackedProducts(); track p.id) {
                <hlm-combobox-item [value]="p.id">{{ p.name }}</hlm-combobox-item>
              }
            </div>
          </hlm-combobox-content>
        </hlm-combobox>
        @if (errorFor('product'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        @if (unknownCode(); as code) {
          <!-- A scan for a product that does not exist: add it here, over this dialog, and it is picked when saved. -->
          <button hlmBtn variant="outline" type="button" class="self-start px-4" (click)="createProduct(code)">Create product</button>
        }
      </div>

      @if (product(); as p) {
        @if (batches()) {
          <div class="flex flex-col gap-2">
            <label hlmLabel data-required for="r-lot">Batch number</label>
            <input hlmInput appScanInput id="r-lot" type="text" [forceInvalid]="invalid('batchNumber')" [value]="batchNumber()" (input)="batchNumber.set($any($event.target).value)" />
            @if (errorFor('batchNumber'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
        }
        @if (expires()) {
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label hlmLabel data-required [attr.for]="monthOnly() ? 'r-expiry-month' : 'r-expiry'">Expires</label>
              <!-- Some packs print only a month (EXP 11/2026): that means good through the end of the month. -->
              <div class="flex" role="group" aria-label="Expiry precision">
                <button hlmBtn type="button" size="sm" class="px-3" [variant]="monthOnly() ? 'outline' : 'default'" (click)="monthOnly.set(false)">Date</button>
                <button hlmBtn type="button" size="sm" class="px-3" [variant]="monthOnly() ? 'default' : 'outline'" (click)="monthOnly.set(true)">Month</button>
              </div>
            </div>
            @if (monthOnly()) {
              <input hlmInput id="r-expiry-month" type="month" [forceInvalid]="invalid('expiresAt')" [value]="expiry().slice(0, 7)" (input)="setMonth($any($event.target).value)" />
            } @else {
              <input hlmInput id="r-expiry" type="date" [forceInvalid]="invalid('expiresAt')" [value]="expiry()" (input)="expiry.set($any($event.target).value)" />
            }
            @if (errorFor('expiresAt'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
        }
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-2">
            <label hlmLabel for="r-qty">Quantity{{ unitSuffix() }}</label>
            <input
              hlmInput
              id="r-qty"
              type="text"
              appOnScreenKeypad
              [keypadWholeDigits]="5"
              [keypadDecimals]="3"
              [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
              [forceInvalid]="invalid('quantity')"
              [value]="quantity()"
              (input)="quantity.set($any($event.target).value)"
            />
            @if (errorFor('quantity'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
          <div class="flex flex-col gap-2">
            <label hlmLabel for="r-cost">Cost{{ per() }}</label>
            <input
              hlmInput
              id="r-cost"
              type="text"
              placeholder="0.00"
              appOnScreenKeypad
              [keypadWholeDigits]="7"
              [keypadDecimals]="2"
              [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
              [forceInvalid]="invalid('unitCost')"
              [value]="cost()"
              (input)="cost.set($any($event.target).value)"
            />
            @if (errorFor('unitCost'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="r-note">Note</label>
          <input hlmInput id="r-note" type="text" [value]="note()" (input)="note.set($any($event.target).value)" />
        </div>
      }

      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer class="sm:items-center sm:justify-between">
      <!-- Keeps the dialog open and clears the form after each receipt, to scan and receive one product after another. -->
      <label class="flex items-center gap-3 text-sm">
        <hlm-checkbox [checked]="continuous()" (checkedChange)="continuous.set($event)" />
        <span>Receive another</span>
      </label>
      <div class="flex gap-2">
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">{{ received() ? 'Close' : 'Cancel' }}</button>
        <button hlmBtn type="button" class="px-6" [disabled]="saving() || !product()" (click)="submit()">Receive</button>
      </div>
    </hlm-dialog-footer>
  `,
})
export class ReceiveStockForm {
  protected readonly settings = inject(AppSettings);
  private readonly products = inject(ProductsService);
  private readonly inventory = inject(InventoryService);
  private readonly newProduct = inject(NewProductViewer);
  private readonly banner = inject(BannerService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  private start = injectBrnDialogContext<ReceiveStockContext>().product;

  /** Products that track stock, alphabetically (the list comes sorted from the database). */
  protected readonly trackedProducts = computed(() => this.products.products().filter((p) => p.tracking !== 'none' && !p.deletedAt));
  protected readonly productId = signal<string | null>(this.start?.id ?? null);
  protected readonly product = computed(() => this.trackedProducts().find((p) => p.id === this.productId()) ?? this.start ?? null);
  protected readonly productName = (id: string | null): string => this.trackedProducts().find((p) => p.id === id)?.name ?? '';
  protected readonly batches = computed(() => !!this.product() && tracksBatches(this.product()!.tracking));
  protected readonly expires = computed(() => !!this.product() && tracksExpiry(this.product()!.tracking));
  protected readonly unitSuffix = computed(() => (this.product() && this.product()!.unit !== 'each' ? ` (${this.product()!.unit})` : ''));
  protected readonly per = computed(() => (this.product() && this.product()!.unit !== 'each' ? ` per ${this.product()!.unit}` : ''));

  protected readonly batchNumber = signal('');
  protected readonly expiry = signal('');
  /** Enter the expiry as a month only; it is stored as the last day of that month. */
  protected readonly monthOnly = signal(false);
  protected readonly quantity = signal('');
  protected readonly cost = signal(formatCentsInput(this.start?.cost ?? null));
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: StockField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  /** Receive another: stay open and start a fresh form after each receipt. */
  protected readonly continuous = signal(false);
  /** Something was received while the dialog stayed open. */
  protected readonly received = signal(false);

  /** A scanned code no product has: offers to create the product. */
  protected readonly unknownCode = signal<string | null>(null);
  /** The code of a product being created from here; it is chosen as soon as it exists. */
  private readonly creating = signal<string | null>(null);

  constructor() {
    if (this.start) this.applyDefaults(this.start);
    // A scan picks the product with that code (tracked products only).
    claimScanner(({ code }) => {
      const found = this.trackedProducts().find((p) => p.barcode === code);
      if (found) return this.choose(found.id);
      const untracked = this.products.products().find((p) => p.barcode === code && !p.deletedAt);
      if (untracked) {
        this.unknownCode.set(null);
        this.problem.set({ field: 'product', error: `Stock is not tracked for ${untracked.name}` });
      } else {
        this.unknownCode.set(code);
        this.problem.set({ field: 'product', error: `No product with code ${code}` });
      }
    });
    effect(() => {
      const code = this.creating();
      const created = code ? this.trackedProducts().find((p) => p.barcode === code) : undefined;
      if (created) {
        this.creating.set(null);
        this.choose(created.id);
      }
    });
  }

  /** Opens the add-product form over this dialog with the code filled in (`?new-product=<code>`). */
  protected createProduct(code: string): void {
    this.creating.set(code);
    void this.newProduct.open(code);
  }

  protected invalid(field: StockField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: StockField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected choose(id: string | null): void {
    this.unknownCode.set(null);
    this.productId.set(id);
    this.problem.set(null);
    const p = this.trackedProducts().find((x) => x.id === id);
    if (p) this.applyDefaults(p);
  }

  /** An empty form for the next product (the scanner is still claimed, so the next scan picks it). */
  private startOver(): void {
    this.start = undefined;
    this.productId.set(null);
    this.batchNumber.set('');
    this.expiry.set('');
    this.monthOnly.set(false);
    this.quantity.set('');
    this.cost.set('');
    this.note.set('');
    this.unknownCode.set(null);
    this.problem.set(null);
  }

  /** Cost starts at the product's cost and the expiry at today plus its shelf life. */
  private applyDefaults(p: ProductRecord): void {
    this.cost.set(formatCentsInput(p.cost));
    this.expiry.set(p.shelfLifeDays ? toDateInput(Date.now() + p.shelfLifeDays * DAY_MS) : '');
  }

  /** A month (`yyyy-mm`) becomes its last day, so the batch is good through the end of the month. */
  protected setMonth(month: string): void {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return this.expiry.set('');
    const lastDay = new Date(Number(match[1]), Number(match[2]), 0).getDate(); // day 0 of the next month
    this.expiry.set(`${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`);
  }

  protected async submit(): Promise<void> {
    const p = this.product();
    if (!p || this.saving()) return;
    this.problem.set(null);
    const quantityMilli = parseQuantityMilli(this.quantity());
    if (quantityMilli === null) return void this.problem.set({ field: 'quantity', error: 'Enter a valid quantity' });
    const cost = this.cost().trim() ? parseCents(this.cost()) : null;
    if (this.cost().trim() && cost === null) return void this.problem.set({ field: 'unitCost', error: 'Enter a valid cost' });
    const expiresAt = this.expires() ? fromDateInput(this.expiry()) : null;
    if (this.expires() && expiresAt === null) return void this.problem.set({ field: 'expiresAt', error: 'Enter an expiry date' });
    this.saving.set(true);
    const result = await this.inventory.receive({
      productId: p.id,
      batchNumber: this.batches() ? this.batchNumber() : null,
      expiresAt,
      quantityMilli,
      unitCost: cost,
      note: this.note() || null,
    });
    this.saving.set(false);
    if (result.ok) {
      void this.products.load(); // the Products table shows stock too
      if (this.continuous()) {
        this.banner.success(`${p.name} received`, { key: 'inventory-saved' });
        this.received.set(true);
        this.startOver();
      } else this.ref.close(true);
    } else this.problem.set({ field: result.field, error: result.error });
  }

  protected readonly formatQuantity = formatQuantity;
}
