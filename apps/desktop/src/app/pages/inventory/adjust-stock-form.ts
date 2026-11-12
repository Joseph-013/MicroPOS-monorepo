import { Component, computed, inject, signal } from '@angular/core';
import { type BatchRecord, formatQuantity, parseQuantityMilli, type StockField } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { InventoryService } from '../../core/data/inventory.service';
import { ProductsService } from '../../core/data/products.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface AdjustStockContext {
  batch: BatchRecord;
}

/** What happened to the stock. Waste and expired remove it; the two corrections fix a miscount. */
type Reason = 'waste' | 'expired' | 'add' | 'remove';
export const REASON_LABELS: Record<Reason, string> = {
  waste: 'Waste or damage',
  expired: 'Expired',
  remove: 'Count correction: less',
  add: 'Count correction: more',
};

/** Take stock out of a batch, or correct its count. */
@Component({
  host: { class: 'contents' },
  imports: [OnScreenKeypadDirective, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Adjust stock</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <p class="text-sm">
        {{ batch.productName }}{{ batch.batchNumber ? ' · ' + batch.batchNumber : '' }}
        <span class="text-muted-foreground"> · {{ formatQuantity(batch.onHandMilli) }}{{ unitSuffix }} on hand</span>
      </p>

      <div class="flex flex-col gap-2">
        <label hlmLabel for="a-reason">Reason</label>
        <hlm-select [(value)]="reason" [itemToString]="reasonLabel">
          <hlm-select-trigger id="a-reason" class="w-full" aria-label="Reason">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            @for (r of reasons; track r) {
              <hlm-select-item [value]="r">{{ reasonLabel(r) }}</hlm-select-item>
            }
          </hlm-select-content>
        </hlm-select>
      </div>

      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="a-qty">Quantity{{ unitSuffix }}</label>
        <input
          hlmInput
          id="a-qty"
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
        <label hlmLabel for="a-note">Note</label>
        <input hlmInput id="a-note" type="text" [value]="note()" (input)="note.set($any($event.target).value)" />
      </div>

      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn [variant]="removes() ? 'destructive' : 'default'" type="button" class="px-6" [disabled]="saving()" (click)="submit()">Save</button>
    </hlm-dialog-footer>
  `,
})
export class AdjustStockForm {
  protected readonly settings = inject(AppSettings);
  private readonly inventory = inject(InventoryService);
  private readonly products = inject(ProductsService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly batch = injectBrnDialogContext<AdjustStockContext>().batch;

  protected readonly reasons: Reason[] = ['waste', 'expired', 'remove', 'add'];
  protected readonly reason = signal<Reason>('waste');
  protected readonly reasonLabel = (r: Reason): string => REASON_LABELS[r] ?? '';
  protected readonly removes = computed(() => this.reason() !== 'add');
  protected readonly unitSuffix = this.batch.unit !== 'each' ? ` (${this.batch.unit})` : '';
  protected readonly quantity = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: StockField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));
  protected readonly formatQuantity = formatQuantity;

  protected invalid(field: StockField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: StockField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    const quantityMilli = parseQuantityMilli(this.quantity());
    if (quantityMilli === null) return void this.problem.set({ field: 'quantity', error: 'Enter a valid quantity' });
    const reason = this.reason();
    this.saving.set(true);
    const result = await this.inventory.adjust({
      batchId: this.batch.id,
      type: reason === 'waste' || reason === 'expired' ? reason : 'adjust',
      quantityMilli: reason === 'remove' ? -quantityMilli : quantityMilli,
      note: this.note() || null,
    });
    this.saving.set(false);
    if (result.ok) {
      void this.products.load();
      this.ref.close(true);
    } else this.problem.set({ field: result.field, error: result.error });
  }
}
