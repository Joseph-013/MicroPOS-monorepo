import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideX } from '@ng-icons/lucide';
import { formatQuantity, parseQuantityMilli, type ProductRecord, type RepackageDraft, type RepackageField, tracksExpiry } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmDialogImports, HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { BannerService } from '../../core/banner';
import { InventoryService } from '../../core/data/inventory.service';
import { ProductsService } from '../../core/data/products.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { claimScanner } from '../../core/scanner';
import { AppSettings } from '../../core/settings/app-settings.service';
import { fromDateInput } from './receive-stock-form';

export interface RepackageContext {
  /** The product to open, when started from a product row. */
  product?: ProductRecord;
  /** The saved half-filled form, read before the dialog opens. */
  draft?: RepackageDraft | null;
}

interface TargetRow {
  key: number;
  productId: string | null;
  quantity: string;
  expiry: string;
}

/** Repackage: take a quantity of one product (a sack) and put it into others (loose kilos, smaller bags). */
@Component({
  host: { class: 'contents' },
  imports: [
    NgIcon,
    OnScreenKeypadDirective,
    HlmButtonImports,
    HlmComboboxImports,
    HlmDialogImports,
    HlmInputImports,
    HlmLabelImports,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideX })],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Repackage</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="rp-source">Open</label>
          <hlm-combobox [value]="sourceId()" (valueChange)="chooseSource($event ?? null)" [itemToString]="productName" class="block">
            <hlm-combobox-input id="rp-source" placeholder="Search or scan a product" />
            <hlm-combobox-content *hlmComboboxPortal>
              <hlm-combobox-empty>No tracked product found</hlm-combobox-empty>
              <div hlmComboboxList>
                @for (p of trackedProducts(); track p.id) {
                  <hlm-combobox-item [value]="p.id">
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{{ p.name }}</span>
                      @if (p.sku) { <span class="text-muted-foreground truncate text-xs">{{ p.sku }}</span> }
                    </span>
                  </hlm-combobox-item>
                }
              </div>
            </hlm-combobox-content>
          </hlm-combobox>
          @if (errorFor('source'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="rp-qty">Quantity{{ unitSuffix(source()) }}</label>
          <input
            hlmInput
            id="rp-qty"
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
      </div>
      @if (source(); as s) {
        <p class="text-muted-foreground -mt-2 text-sm">In stock: {{ formatQuantity(s.onHandMilli ?? 0) }}{{ unitSuffix(s) ? ' ' + s.unit : '' }}</p>
      }

      <div class="flex flex-col gap-2">
        <span hlmLabel data-required>Into</span>
        @for (row of rows(); track row.key; let i = $index) {
          <div class="grid grid-cols-[minmax(0,1fr)_9rem_auto] items-center gap-3">
            <hlm-combobox [value]="row.productId" (valueChange)="setRow(row.key, { productId: $event ?? null })" [itemToString]="productName" class="block">
              <label class="sr-only" [for]="'rp-target-' + row.key">Product {{ i + 1 }}</label>
              <hlm-combobox-input [id]="'rp-target-' + row.key" placeholder="Search a product" />
              <hlm-combobox-content *hlmComboboxPortal>
                <hlm-combobox-empty>No tracked product found</hlm-combobox-empty>
                <div hlmComboboxList>
                  @for (p of targetChoices(row.key); track p.id) {
                    <hlm-combobox-item [value]="p.id">
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{{ p.name }}</span>
                      @if (p.sku) { <span class="text-muted-foreground truncate text-xs">{{ p.sku }}</span> }
                    </span>
                  </hlm-combobox-item>
                  }
                </div>
              </hlm-combobox-content>
            </hlm-combobox>
            <input
              hlmInput
              type="text"
              appOnScreenKeypad
              [keypadWholeDigits]="5"
              [keypadDecimals]="3"
              [attr.aria-label]="'Quantity' + unitSuffix(productOf(row.productId))"
              [placeholder]="'Qty' + unitSuffix(productOf(row.productId))"
              [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
              [forceInvalid]="invalid('targets')"
              [value]="row.quantity"
              (input)="setRow(row.key, { quantity: $any($event.target).value })"
            />
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Remove product"
              [disabled]="rows().length === 1"
              (click)="removeRow(row.key)"
            >
              <ng-icon name="lucideX" size="18" />
            </button>
            @if (needsExpiry(row)) {
              <label class="text-muted-foreground col-span-3 flex items-center gap-3 text-sm">
                Expires
                <input hlmInput type="date" class="w-44" aria-label="Expiry date" [value]="row.expiry" (input)="setRow(row.key, { expiry: $any($event.target).value })" />
              </label>
            }
          </div>
        }
        @if (errorFor('targets'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        <button hlmBtn variant="outline" type="button" class="self-start px-4" (click)="addRow()">
          <ng-icon name="lucidePlus" size="18" />
          Add product
        </button>
      </div>

      <div class="flex flex-col gap-2">
        <label hlmLabel for="rp-note">Note</label>
        <input hlmInput id="rp-note" type="text" [value]="note()" (input)="note.set($any($event.target).value)" />
      </div>

      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      @if (dirty()) {
        <button hlmBtn variant="ghost" type="button" class="px-4" (click)="reset()">Reset</button>
      }
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Close</button>
      <button hlmBtn type="button" class="px-6" [disabled]="saving() || !source()" (click)="submit()">Repackage</button>
    </hlm-dialog-footer>
  `,
})
export class RepackageForm {
  protected readonly settings = inject(AppSettings);
  private readonly products = inject(ProductsService);
  private readonly inventory = inject(InventoryService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  private readonly start = injectBrnDialogContext<RepackageContext>().product;

  protected readonly trackedProducts = computed(() => this.products.products().filter((p) => p.tracking !== 'none' && !p.deletedAt));
  private readonly context = injectBrnDialogContext<RepackageContext>();
  private readonly banner = inject(BannerService);
  /** The form's starting values (a draft is measured against them). */
  private readonly base: RepackageDraft = {
    productId: this.start?.id ?? null,
    quantity: '',
    targets: [{ productId: null, quantity: '', expiry: '' }],
    note: '',
  };
  /** Values to show now: the saved draft when there is one, else the base. */
  private readonly first: RepackageDraft = this.context.draft ?? this.base;
  protected readonly sourceId = signal<string | null>(this.first.productId);
  protected readonly source = computed(() => this.productOf(this.sourceId()));
  protected readonly quantity = signal(this.first.quantity);
  protected readonly rows = signal<TargetRow[]>(this.first.targets.map((t, key) => ({ key, ...t })));
  protected readonly note = signal(this.first.note);
  protected readonly saving = signal(false);
  private nextKey = this.first.targets.length;
  private readonly problem = signal<{ field: RepackageField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  /** The form as it stands, in draft form. */
  private readonly current = computed<RepackageDraft>(() => ({
    productId: this.sourceId(),
    quantity: this.quantity(),
    targets: this.rows().map(({ productId, quantity, expiry }) => ({ productId, quantity, expiry })),
    note: this.note(),
  }));
  /** True once anything differs from an empty form. */
  protected readonly dirty = computed(() => JSON.stringify(this.current()) !== JSON.stringify(this.base));
  /** Set when the form ends by saving, so nothing is kept as a draft afterwards. */
  private finished = false;

  constructor() {
    if (this.context.draft) this.banner.info('Draft restored', { key: 'repackage-draft' });
    // Every change is saved as a draft (an empty form has none), so closing the dialog or restarting loses nothing.
    effect(() => {
      const draft = this.current();
      if (this.finished) return;
      if (this.dirty()) this.inventory.saveRepackageDraft(draft);
      else this.inventory.clearRepackageDraft();
    });
    inject(DestroyRef).onDestroy(() => {
      if (!this.finished) this.inventory.flushRepackageDraft();
    });
    // A scan picks the product to open (tracked products only).
    claimScanner(({ code }) => {
      const found = this.trackedProducts().find((p) => p.barcode === code);
      if (found) this.chooseSource(found.id);
      else this.problem.set({ field: 'source', error: `No tracked product with code ${code}` });
    });
  }

  protected readonly productName = (id: string | null): string => this.productOf(id)?.name ?? '';
  protected readonly formatQuantity = formatQuantity;

  protected productOf(id: string | null): ProductRecord | null {
    return this.trackedProducts().find((p) => p.id === id) ?? (id !== null && id === this.start?.id ? this.start : null);
  }
  protected unitSuffix(p: ProductRecord | null): string {
    return p && p.unit !== 'each' ? ` (${p.unit})` : '';
  }
  /** Targets exclude the product being opened and the ones already chosen in other rows. */
  protected targetChoices(key: number): ProductRecord[] {
    const taken = new Set(this.rows().filter((r) => r.key !== key).map((r) => r.productId));
    return this.trackedProducts().filter((p) => p.id !== this.sourceId() && !taken.has(p.id));
  }
  /** An expiry is only asked for when the target expires and the source's batches carry no date to pass on. */
  protected needsExpiry(row: TargetRow): boolean {
    const target = this.productOf(row.productId);
    return !!target && tracksExpiry(target.tracking) && !!this.source() && !tracksExpiry(this.source()!.tracking);
  }

  protected invalid(field: RepackageField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: RepackageField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected chooseSource(id: string | null): void {
    this.sourceId.set(id);
    this.problem.set(null);
    // The product being opened cannot also be a target.
    this.rows.update((rows) => rows.map((r) => (r.productId === id ? { ...r, productId: null } : r)));
  }
  protected setRow(key: number, change: Partial<TargetRow>): void {
    this.problem.set(null);
    this.rows.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }
  protected addRow(): void {
    this.rows.update((rows) => [...rows, { key: this.nextKey++, productId: null, quantity: '', expiry: '' }]);
  }
  protected removeRow(key: number): void {
    this.rows.update((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  /** Puts every field back to its starting values and drops the draft. */
  protected reset(): void {
    this.sourceId.set(this.base.productId);
    this.quantity.set(this.base.quantity);
    this.nextKey = 1;
    this.rows.set([{ key: 0, productId: null, quantity: '', expiry: '' }]);
    this.note.set(this.base.note);
    this.problem.set(null);
  }

  protected async submit(): Promise<void> {
    const source = this.source();
    if (!source || this.saving()) return;
    this.problem.set(null);
    const quantityMilli = parseQuantityMilli(this.quantity());
    if (quantityMilli === null) return void this.problem.set({ field: 'quantity', error: 'Enter a valid quantity' });
    const targets = [];
    for (const row of this.rows()) {
      const qty = parseQuantityMilli(row.quantity);
      if (!row.productId) return void this.problem.set({ field: 'targets', error: 'Choose the product to repackage into' });
      if (qty === null) return void this.problem.set({ field: 'targets', error: 'Enter a valid quantity for each product' });
      targets.push({ productId: row.productId, quantityMilli: qty, expiresAt: row.expiry ? fromDateInput(row.expiry) : null });
    }
    this.saving.set(true);
    const result = await this.inventory.repackage({ productId: source.id, quantityMilli, targets, note: this.note() || null });
    this.saving.set(false);
    if (result.ok) {
      this.finished = true;
      this.inventory.clearRepackageDraft();
      void this.products.load(); // the Products table shows stock too
      this.ref.close(true);
    } else this.problem.set({ field: result.field, error: result.error });
  }
}

/**
 * Opens the Repackage dialog (from a product row or the Inventory page) and reports a save with a banner. The saved
 * draft is read first so the form can start with it.
 */
export async function openRepackage(dialogs: HlmDialogService, banner: BannerService, inventory: InventoryService, product?: ProductRecord): Promise<void> {
  const draft = await inventory.loadRepackageDraft();
  dialogs
    .open<boolean, RepackageContext>(RepackageForm, {
      id: 'repackage-stock',
      contentClass: 'w-[min(36rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { product, draft },
    })
    .closed$.subscribe((saved) => {
      if (saved) banner.success('Stock repackaged', { key: 'inventory-saved' });
    });
}
