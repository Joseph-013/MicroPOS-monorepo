import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { isWeighed, PRODUCT_TRACKING, PRODUCT_UNITS, type ProductDraft, type ProductTracking, tracksExpiry, type ProductField, type ProductInput, type ProductRecord, type ProductUnit } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { BannerService } from '../../core/banner';
import { CatalogService } from '../../core/data/catalog.service';
import { ProductDraftService } from '../../core/data/product-draft.service';
import { ProductsService } from '../../core/data/products.service';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { claimScanner, ScanInputDirective } from '../../core/scanner';
import { FilterInput } from '../../core/ui/filter-input';
import { AppSettings } from '../../core/settings/app-settings.service';

/** Names for the units in the Sold by select. */
export const UNIT_LABELS: Record<ProductUnit, string> = { each: 'Each', kg: 'Kilogram', g: 'Gram', lb: 'Pound', oz: 'Ounce' };

/** Names for how stock is tracked, in the "Track stock" select. */
export const TRACKING_LABELS: Record<ProductTracking, string> = {
  none: 'Not tracked',
  quantity: 'Quantity',
  batch: 'By batch',
  expiry: 'By batch with expiry',
};

export interface ProductFormContext {
  /** The product being edited; absent when adding. */
  product?: ProductRecord;
  /** A half-filled form saved earlier for this product (or for a new one); it is put back instead of the stored values. */
  draft?: ProductDraft | null;
  /**
   * Values to start a new product with (a scanned barcode). A prefilled form is a quick add from another page
   * (`?new-product=<code>`): it neither restores nor saves the draft of the Products page's own add form.
   */
  prefill?: Partial<ProductDraft>;
}

/** Add / edit dialog of the Products page. Closes with `true` once the change is saved. */
@Component({
  // `contents`: the dialog's own grid (gap, rows, footer bleed) lays out the header, form and footer directly,
  // instead of treating this whole component as one grid cell.
  host: { class: 'contents' },
  imports: [
    FilterInput,
    ScanInputDirective,
    OnScreenKeypadDirective,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmInputImports,
    HlmLabelImports,
    HlmSelectImports,
    HlmSwitchImports,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ product ? 'Edit product' : 'Add product' }}</h3>
    </hlm-dialog-header>

    <!-- Padding inside the scroll area (pulled back out with negative margins) so focus rings are not clipped at its edges. -->
    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="p-name">Name</label>
        <input hlmInput id="p-name" type="text" [forceInvalid]="invalid('name')" [value]="name()" (input)="name.set($any($event.target).value)" />
        @if (errorFor('name'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>

      <div class="flex flex-col gap-2">
        <label hlmLabel for="p-unit">Sold by</label>
        <hlm-select [(value)]="unit" [itemToString]="unitLabel">
          <hlm-select-trigger id="p-unit" class="w-full" aria-label="Sold by">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            @for (u of units; track u) {
              <hlm-select-item [value]="u">{{ unitLabel(u) }}</hlm-select-item>
            }
          </hlm-select-content>
        </hlm-select>
        @if (errorFor('unit'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel for="p-tracking">Track stock</label>
          <hlm-select [(value)]="tracking" [itemToString]="trackingLabel">
            <hlm-select-trigger id="p-tracking" class="w-full" aria-label="Track stock">
              <hlm-select-value />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (t of trackingLevels; track t) {
                <hlm-select-item [value]="t">{{ trackingLabel(t) }}</hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select>
        </div>
        @if (expires()) {
          <div class="flex flex-col gap-2">
            <label hlmLabel for="p-shelf">Shelf life (days)</label>
            <input
              hlmInput
              id="p-shelf"
              type="text"
              placeholder="Optional"
              appOnScreenKeypad
              [keypadWholeDigits]="4"
              [keypadDecimals]="0"
              [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'numeric'"
              [forceInvalid]="invalid('shelfLifeDays')"
              [value]="shelfLifeDays()"
              (input)="shelfLifeDays.set($any($event.target).value)"
            />
            @if (errorFor('shelfLifeDays'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
        }
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel for="p-sku">SKU</label>
          <input hlmInput id="p-sku" type="text" [forceInvalid]="invalid('sku')" [value]="sku()" (input)="sku.set($any($event.target).value)" />
          @if (errorFor('sku'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="p-barcode">{{ weighed() ? 'PLU' : 'Barcode' }}</label>
          <input hlmInput appScanInput id="p-barcode" type="text" [forceInvalid]="invalid('barcode')" [value]="barcode()" (input)="barcode.set($any($event.target).value)" />
          @if (errorFor('barcode'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="p-price">Price{{ perUnit() }}</label>
          <input
            hlmInput
            id="p-price"
            type="text"
            placeholder="0.00"
            appOnScreenKeypad
            [keypadWholeDigits]="7"
            [keypadDecimals]="2"
            [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
            [forceInvalid]="invalid('price')"
            [value]="price()"
            (input)="price.set($any($event.target).value)"
          />
          @if (errorFor('price'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="p-cost">Cost{{ perUnit() }}</label>
          <input
            hlmInput
            id="p-cost"
            type="text"
            placeholder="0.00"
            appOnScreenKeypad
            [keypadWholeDigits]="7"
            [keypadDecimals]="2"
            [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
            [forceInvalid]="invalid('cost')"
            [value]="cost()"
            (input)="cost.set($any($event.target).value)"
          />
          @if (errorFor('cost'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      </div>

      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 text-sm">Categories{{ categoryIds().length ? ' (' + categoryIds().length + ' selected)' : '' }}</legend>
        <app-filter-input [(value)]="categoryQuery" placeholder="Search categories" label="Search categories" />
        <div class="grid max-h-40 grid-cols-2 gap-x-3 overflow-y-auto border p-2">
          @for (category of shownCategories(); track category.id) {
            <label class="flex min-h-(--control-height) items-center gap-2 text-sm">
              <hlm-checkbox [checked]="categoryIds().includes(category.id)" (checkedChange)="toggleCategory(category.id, $event)" />
              <span class="truncate">{{ category.name }}</span>
            </label>
          } @empty {
            <p class="text-muted-foreground col-span-2 py-2 text-sm">{{ categoryQuery() ? 'No match' : 'No categories' }}</p>
          }
        </div>
      </fieldset>

      <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
        <span>Active</span>
        <hlm-switch [checked]="active()" (checkedChange)="active.set($event)" />
      </label>

      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer class="sm:justify-between">
      @if (product) {
        <hlm-alert-dialog>
          <button hlmAlertDialogTrigger hlmBtn variant="destructive" type="button" class="px-5">Delete</button>
          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
            <hlm-alert-dialog-header>
              <h3 hlmAlertDialogTitle>Delete this product?</h3>
              <p hlmAlertDialogDescription>It will no longer appear at checkout. Past orders keep it.</p>
            </hlm-alert-dialog-header>
            <hlm-alert-dialog-footer>
              <button hlmAlertDialogCancel type="button">Cancel</button>
              <button hlmAlertDialogAction variant="destructive" type="button" (click)="remove()">Delete</button>
            </hlm-alert-dialog-footer>
          </hlm-alert-dialog-content>
        </hlm-alert-dialog>
      } @else {
        <span></span>
      }
      <div class="flex gap-2">
        @if (dirty()) {
          <button hlmBtn variant="ghost" type="button" class="px-4" (click)="reset()">Reset</button>
        }
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Close</button>
        <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">Save</button>
      </div>
    </hlm-dialog-footer>
  `,
})
export class ProductForm {
  protected readonly catalog = inject(CatalogService);
  protected readonly settings = inject(AppSettings);
  private readonly products = inject(ProductsService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  private readonly context = injectBrnDialogContext<ProductFormContext>();
  protected readonly product = this.context.product;
  private readonly drafts = inject(ProductDraftService);
  private readonly banner = inject(BannerService);
  /** Which saved draft this form uses: `new`, or the id of the product being edited. */
  private readonly formKey = this.product?.id ?? 'new';
  /** The form's starting values: the stored product (or empty), which a draft is measured against. */
  private readonly base: ProductDraft = {
    name: this.product?.name ?? '',
    unit: this.product?.unit ?? 'each',
    tracking: this.product?.tracking ?? 'none',
    shelfLifeDays: this.product?.shelfLifeDays?.toString() ?? '',
    sku: this.product?.sku ?? '',
    barcode: this.product?.barcode ?? '',
    price: this.product ? formatCentsInput(this.product.price) : '',
    cost: formatCentsInput(this.product?.cost ?? null),
    active: this.product?.active ?? true,
    categoryIds: this.product?.categories.map((c) => c.id) ?? [],
  };
  /** Values to show now: the saved draft when there is one (minus categories deleted since), else the base. */
  private readonly start: ProductDraft = this.context.draft
    ? { ...this.context.draft, categoryIds: this.context.draft.categoryIds.filter((id) => this.catalog.categories().some((c) => c.id === id)) }
    : { ...this.base, ...this.context.prefill };
  /** A quick add (prefilled) keeps no draft. */
  private readonly useDrafts = !this.context.prefill;

  protected readonly units = PRODUCT_UNITS;
  protected readonly unit = signal<ProductUnit>(this.start.unit);
  protected readonly trackingLevels = PRODUCT_TRACKING;
  protected readonly tracking = signal<ProductTracking>(this.start.tracking);
  protected readonly trackingLabel = (t: ProductTracking): string => TRACKING_LABELS[t] ?? '';
  protected readonly expires = computed(() => tracksExpiry(this.tracking()));
  protected readonly shelfLifeDays = signal(this.start.shelfLifeDays);
  protected readonly unitLabel = (unit: ProductUnit): string => UNIT_LABELS[unit] ?? '';
  protected readonly weighed = computed(() => isWeighed(this.unit()));
  /** " per kg" next to the money labels of a weighed product. */
  protected readonly perUnit = computed(() => (this.weighed() ? ` per ${this.unit()}` : ''));
  protected readonly name = signal(this.start.name);
  protected readonly sku = signal(this.start.sku);
  protected readonly barcode = signal(this.start.barcode);
  protected readonly price = signal(this.start.price);
  protected readonly cost = signal(this.start.cost);
  protected readonly active = signal(this.start.active);
  /** Search box above the category list; ticked categories stay ticked while hidden by it. */
  protected readonly categoryQuery = signal('');
  protected readonly shownCategories = computed(() => {
    const query = this.categoryQuery().trim().toLowerCase();
    return this.catalog.categories().filter((c) => !query || c.name.toLowerCase().includes(query));
  });
  protected readonly categoryIds = signal<string[]>(this.start.categoryIds);

  protected readonly saving = signal(false);

  /** The form as it stands, in draft form. */
  private readonly current = computed<ProductDraft>(() => ({
    name: this.name(),
    unit: this.unit(),
    tracking: this.tracking(),
    shelfLifeDays: this.shelfLifeDays(),
    sku: this.sku(),
    barcode: this.barcode(),
    price: this.price(),
    cost: this.cost(),
    active: this.active(),
    categoryIds: this.categoryIds(),
  }));
  /** True once anything differs from the stored product (or from empty, when adding). */
  protected readonly dirty = computed(() => JSON.stringify(this.current()) !== JSON.stringify(this.base));
  /** Set when the form ends by saving or deleting, so nothing is kept as a draft afterwards. */
  private finished = false;

  constructor() {
    if (this.context.draft) this.banner.info('Draft restored', { key: 'product-draft' });

    // Every change is saved as a draft (a form back at its starting values has none), so closing the dialog,
    // going to another page to make a category, or restarting the app loses nothing.
    effect(() => {
      const draft = this.current();
      if (this.finished || !this.useDrafts) return;
      if (this.dirty()) this.drafts.save(this.formKey, draft);
      else this.drafts.clear(this.formKey);
    });
    inject(DestroyRef).onDestroy(() => {
      if (!this.finished && this.useDrafts) this.drafts.flush();
    });

    // While this form is open a scan fills the barcode / PLU field (and never reaches the table behind the dialog):
    // directly when that field is focused (`appScanInput`), and via this claim when focus is anywhere else in the form.
    claimScanner(({ code }) => this.barcode.set(code));
  }
  private readonly problem = signal<{ field: ProductField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  protected invalid(field: ProductField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: ProductField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected toggleCategory(id: string, on: boolean): void {
    this.categoryIds.update((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  }

  /** Form text to the payload; the first thing wrong is shown against its field. */
  private build(): ProductInput | null {
    if (!this.name().trim()) return this.fail('name', 'Enter a name');
    if (this.expires() && this.shelfLifeDays().trim() && !/^\d{1,4}$/.test(this.shelfLifeDays().trim())) {
      return this.fail('shelfLifeDays', 'Enter a number of days');
    }
    const price = parseCents(this.price());
    if (price === null) return this.fail('price', 'Enter a valid price');
    const cost = this.cost().trim() ? parseCents(this.cost()) : null;
    if (this.cost().trim() && cost === null) return this.fail('cost', 'Enter a valid cost');
    return {
      name: this.name(),
      unit: this.unit(),
      tracking: this.tracking(),
      shelfLifeDays: this.expires() && this.shelfLifeDays().trim() ? Number(this.shelfLifeDays()) : null,
      sku: this.sku() || null,
      barcode: this.barcode() || null,
      price,
      cost,
      active: this.active(),
      categoryIds: this.categoryIds(),
    };
  }

  private fail(field: ProductField, error: string): null {
    this.problem.set({ field, error });
    return null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    const input = this.build();
    if (!input) return;
    this.saving.set(true);
    const result = await this.products.save(this.product?.id ?? null, input);
    this.saving.set(false);
    if (result.ok) {
      this.finish();
      this.ref.close(true);
    } else this.problem.set({ field: result.field, error: result.error });
  }

  private finish(): void {
    this.finished = true;
    if (this.useDrafts) this.drafts.clear(this.formKey);
  }

  /** Puts every field back to its starting values and drops the draft. */
  protected reset(): void {
    this.name.set(this.base.name);
    this.unit.set(this.base.unit);
    this.tracking.set(this.base.tracking);
    this.shelfLifeDays.set(this.base.shelfLifeDays);
    this.sku.set(this.base.sku);
    this.barcode.set(this.base.barcode);
    this.price.set(this.base.price);
    this.cost.set(this.base.cost);
    this.active.set(this.base.active);
    this.categoryIds.set(this.base.categoryIds);
    this.problem.set(null);
  }

  protected async remove(): Promise<void> {
    if (this.product && (await this.products.remove([this.product.id]))) {
      this.finish();
      this.ref.close(true);
    }
    else this.problem.set({ field: null, error: 'Could not delete the product' });
  }
}
