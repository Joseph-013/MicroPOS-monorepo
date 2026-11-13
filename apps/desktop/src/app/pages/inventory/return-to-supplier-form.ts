import { Component, computed, inject, signal } from '@angular/core';
import { type BatchRecord, formatQuantity, parseQuantityMilli, type ReturnToSupplierField, type SupplierReturnRecord } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { InventoryService } from '../../core/data/inventory.service';
import { ProductsService } from '../../core/data/products.service';
import { SuppliersService } from '../../core/data/suppliers.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { parseCents } from '../../core/money-input';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface ReturnToSupplierContext {
  batch: BatchRecord;
}

/** Send stock from a batch back to its supplier (expired bread, a damaged delivery) for a full or partial refund. Closes with the saved return. */
@Component({
  host: { class: 'contents' },
  imports: [OnScreenKeypadDirective, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Return to supplier</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <p class="text-sm">
        <span class="break-words">{{ batch.productName }}{{ batch.batchNumber ? ' · ' + batch.batchNumber : '' }}</span>
        <span class="text-muted-foreground"> · {{ formatQuantity(batch.onHandMilli) }}{{ unitSuffix }} on hand</span>
      </p>

      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="r-qty">Quantity{{ unitSuffix }}</label>
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
        <label hlmLabel [attr.data-required]="batch.supplierId ? null : ''" id="r-supplier-label">Supplier</label>
        @if (batch.supplierId) {
          <p class="min-h-(--control-height) truncate text-sm leading-(--control-height)">{{ batch.supplierName }} <span class="text-muted-foreground">· {{ batch.purchaseNumber }}</span></p>
        } @else {
          <hlm-select [(value)]="supplierId" [itemToString]="supplierLabel">
            <hlm-select-trigger class="w-full" aria-labelledby="r-supplier-label">
              <hlm-select-value placeholder="Choose supplier" />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (s of suppliers.suppliers(); track s.id) {
                <hlm-select-item [value]="s.id">{{ s.name }}</hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select>
          @if (errorFor('supplier'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        }
      </div>

      <div class="flex flex-col gap-2">
        <label hlmLabel for="r-refund">Refund</label>
        <input
          hlmInput
          id="r-refund"
          type="text"
          placeholder="None"
          appOnScreenKeypad
          [keypadWholeDigits]="7"
          [keypadDecimals]="2"
          [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
          [forceInvalid]="invalid('refundAmount')"
          [value]="refund()"
          (input)="refund.set($any($event.target).value)"
        />
        @if (errorFor('refundAmount'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>

      <div class="flex flex-col gap-2">
        <label hlmLabel for="r-note">Note</label>
        <input hlmInput id="r-note" type="text" [value]="note()" (input)="note.set($any($event.target).value)" />
      </div>

      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">Return</button>
    </hlm-dialog-footer>
  `,
})
export class ReturnToSupplierForm {
  protected readonly settings = inject(AppSettings);
  protected readonly suppliers = inject(SuppliersService);
  private readonly inventory = inject(InventoryService);
  private readonly products = inject(ProductsService);
  private readonly ref = inject<BrnDialogRef<SupplierReturnRecord | undefined>>(BrnDialogRef);
  protected readonly batch = injectBrnDialogContext<ReturnToSupplierContext>().batch;

  protected readonly unitSuffix = this.batch.unit !== 'each' ? ` (${this.batch.unit})` : '';
  /** Starts as all of it: the usual case is a whole lot going back. */
  protected readonly quantity = signal(formatQuantity(this.batch.onHandMilli));
  protected readonly supplierId = signal<string | null>(null);
  protected readonly supplierLabel = (id: string | null): string => this.suppliers.suppliers().find((s) => s.id === id)?.name ?? '';
  protected readonly refund = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: ReturnToSupplierField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));
  protected readonly formatQuantity = formatQuantity;

  constructor() {
    if (!this.batch.supplierId) void this.suppliers.load();
  }

  protected invalid(field: ReturnToSupplierField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: ReturnToSupplierField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    const quantityMilli = parseQuantityMilli(this.quantity());
    if (quantityMilli === null) return void this.problem.set({ field: 'quantity', error: 'Enter a valid quantity' });
    const refundText = this.refund().trim();
    const refundAmount = refundText === '' ? 0 : parseCents(refundText);
    if (refundAmount === null) return void this.problem.set({ field: 'refundAmount', error: 'Enter a valid refund' });
    this.saving.set(true);
    const result = await this.inventory.returnToSupplier({ batchId: this.batch.id, quantityMilli, supplierId: this.batch.supplierId ? null : this.supplierId(), refundAmount, note: this.note() || null });
    this.saving.set(false);
    if (result.ok) {
      void this.products.load();
      this.ref.close(result.return);
    } else this.problem.set({ field: result.field, error: result.error });
  }
}

