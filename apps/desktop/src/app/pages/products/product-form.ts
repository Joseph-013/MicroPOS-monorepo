import { Component, computed, inject, signal } from '@angular/core';
import { isWeighed, PRODUCT_UNITS, type ProductField, type ProductInput, type ProductRecord, type ProductUnit } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { CatalogService } from '../../core/data/catalog.service';
import { ProductsService } from '../../core/data/products.service';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { claimScanner, ScanInputDirective } from '../../core/scanner';
import { FilterInput } from '../../core/ui/filter-input';
import { AppSettings } from '../../core/settings/app-settings.service';

/** Names for the units in the Sold by select. */
export const UNIT_LABELS: Record<ProductUnit, string> = { each: 'Each', kg: 'Kilogram', g: 'Gram', lb: 'Pound', oz: 'Ounce' };

export interface ProductFormContext {
  /** The product being edited; absent when adding. */
  product?: ProductRecord;
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
        <label hlmLabel for="p-name">Name</label>
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
          <label hlmLabel for="p-sku">SKU</label>
          <input hlmInput id="p-sku" type="text" [forceInvalid]="invalid('sku')" [value]="sku()" (input)="sku.set($any($event.target).value)" />
          @if (errorFor('sku'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="p-barcode">Barcode / PLU{{ weighed() ? ' (required)' : '' }}</label>
          <input hlmInput appScanInput id="p-barcode" type="text" [forceInvalid]="invalid('barcode')" [value]="barcode()" (input)="barcode.set($any($event.target).value)" />
          @if (errorFor('barcode'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel for="p-price">Price{{ perUnit() }}</label>
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
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
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
  protected readonly product = injectBrnDialogContext<ProductFormContext>().product;

  protected readonly units = PRODUCT_UNITS;
  protected readonly unit = signal<ProductUnit>(this.product?.unit ?? 'each');
  protected readonly unitLabel = (unit: ProductUnit): string => UNIT_LABELS[unit] ?? '';
  protected readonly weighed = computed(() => isWeighed(this.unit()));
  /** " per kg" next to the money labels of a weighed product. */
  protected readonly perUnit = computed(() => (this.weighed() ? ` per ${this.unit()}` : ''));
  protected readonly name = signal(this.product?.name ?? '');
  protected readonly sku = signal(this.product?.sku ?? '');
  protected readonly barcode = signal(this.product?.barcode ?? '');
  protected readonly price = signal(this.product ? formatCentsInput(this.product.price) : '');
  protected readonly cost = signal(formatCentsInput(this.product?.cost ?? null));
  protected readonly active = signal(this.product?.active ?? true);
  /** Search box above the category list; ticked categories stay ticked while hidden by it. */
  protected readonly categoryQuery = signal('');
  protected readonly shownCategories = computed(() => {
    const query = this.categoryQuery().trim().toLowerCase();
    return this.catalog.categories().filter((c) => !query || c.name.toLowerCase().includes(query));
  });
  protected readonly categoryIds = signal<string[]>(this.product?.categories.map((c) => c.id) ?? []);

  protected readonly saving = signal(false);

  constructor() {
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
    if (this.weighed() && !this.barcode().trim()) return this.fail('barcode', 'A weighed product needs a barcode or PLU');
    const price = parseCents(this.price());
    if (price === null) return this.fail('price', 'Enter a valid price');
    const cost = this.cost().trim() ? parseCents(this.cost()) : null;
    if (this.cost().trim() && cost === null) return this.fail('cost', 'Enter a valid cost');
    return {
      name: this.name(),
      unit: this.unit(),
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
    if (result.ok) this.ref.close(true);
    else this.problem.set({ field: result.field, error: result.error });
  }

  protected async remove(): Promise<void> {
    if (this.product && (await this.products.remove([this.product.id]))) this.ref.close(true);
    else this.problem.set({ field: null, error: 'Could not delete the product' });
  }
}
