import { Component, computed, inject, signal } from '@angular/core';
import { formatQuantity, type PurchaseDetail, type PurchaseLineRecord, tracksBatches, tracksExpiry } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ProductsService } from '../../core/data/products.service';
import { PurchasesService } from '../../core/data/purchases.service';
import { fromDateInput } from '../inventory/receive-stock-form';

export interface PurchaseReceiveContext {
  purchase: PurchaseDetail;
}

interface LineEntry {
  batchNumber: string;
  expiry: string;
}

/**
 * The order arrived: confirm it and give the lot number and expiry date of the products that track them. All or
 * nothing. Closes with the received order.
 */
@Component({
  host: { class: 'contents' },
  imports: [HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Receive {{ purchase.number }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <p class="text-muted-foreground text-sm">The whole order goes into stock at the ordered cost.</p>
      <ul class="divide-border flex flex-col divide-y border-y">
        @for (line of purchase.lines; track line.id) {
          <li class="grid gap-3 py-3">
            <div class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate">{{ line.productName }}</span>
              <span class="text-muted-foreground shrink-0 text-sm">{{ quantity(line) }}</span>
            </div>
            @if (line.tracking === 'none') {
              <p class="text-muted-foreground text-sm">Stock is not tracked for this product.</p>
            }
            @if (batches(line)) {
              <div class="flex flex-col gap-2">
                <label hlmLabel data-required [attr.for]="'rc-lot-' + line.id">Batch number</label>
                <input hlmInput [id]="'rc-lot-' + line.id" type="text" [forceInvalid]="invalid(line, 'batchNumber')" [value]="entry(line).batchNumber" (input)="set(line, 'batchNumber', $any($event.target).value)" />
              </div>
            }
            @if (expires(line)) {
              <div class="flex flex-col gap-2">
                <label hlmLabel data-required [attr.for]="'rc-exp-' + line.id">Expires</label>
                <input hlmInput [id]="'rc-exp-' + line.id" type="date" [forceInvalid]="invalid(line, 'expiresAt')" [value]="entry(line).expiry" (input)="set(line, 'expiry', $any($event.target).value)" />
              </div>
            }
            @if (errorFor(line); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </li>
        }
      </ul>
      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">Receive stock</button>
    </hlm-dialog-footer>
  `,
})
export class PurchaseReceiveForm {
  private readonly purchases = inject(PurchasesService);
  private readonly products = inject(ProductsService);
  private readonly ref = inject<BrnDialogRef<PurchaseDetail | undefined>>(BrnDialogRef);
  protected readonly purchase = injectBrnDialogContext<PurchaseReceiveContext>().purchase;

  private readonly entries = signal<Record<string, LineEntry>>({});
  protected readonly saving = signal(false);
  private readonly problem = signal<{ lineId: string | null; field: 'batchNumber' | 'expiresAt' | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem() && this.problem()!.lineId === null ? this.problem()!.error : null));

  protected readonly batches = (line: PurchaseLineRecord): boolean => tracksBatches(line.tracking);
  protected readonly expires = (line: PurchaseLineRecord): boolean => tracksExpiry(line.tracking);
  protected quantity(line: PurchaseLineRecord): string {
    return `${formatQuantity(line.quantityMilli)}${line.unit === 'each' ? '' : ' ' + line.unit}`;
  }

  protected entry(line: PurchaseLineRecord): LineEntry {
    return this.entries()[line.id] ?? { batchNumber: '', expiry: '' };
  }
  protected set(line: PurchaseLineRecord, key: keyof LineEntry, value: string): void {
    this.entries.update((all) => ({ ...all, [line.id]: { ...this.entry(line), [key]: value } }));
  }

  protected invalid(line: PurchaseLineRecord, field: 'batchNumber' | 'expiresAt'): boolean {
    const p = this.problem();
    return p?.lineId === line.id && p.field === field;
  }
  protected errorFor(line: PurchaseLineRecord): string | null {
    const p = this.problem();
    return p?.lineId === line.id ? p.error : null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    this.saving.set(true);
    const result = await this.purchases.receive({
      purchaseId: this.purchase.id,
      lines: this.purchase.lines.map((line) => {
        const e = this.entry(line);
        return { lineId: line.id, batchNumber: this.batches(line) ? e.batchNumber : null, expiresAt: this.expires(line) ? fromDateInput(e.expiry) : null };
      }),
    });
    this.saving.set(false);
    if (result.ok) {
      void this.products.load(); // the Products table shows stock too
      this.ref.close(result.purchase);
    } else this.problem.set({ lineId: result.lineId, field: result.field, error: result.error });
  }
}
