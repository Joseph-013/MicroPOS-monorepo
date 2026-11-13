import { Component, computed, inject, signal } from '@angular/core';
import { formatQuantity, parseQuantityMilli, type PurchaseDetail, type PurchaseLineRecord, tracksBatches, tracksExpiry } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ProductsService } from '../../core/data/products.service';
import { PurchasesService } from '../../core/data/purchases.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { ConfirmItems, type ConfirmItem } from '../../core/ui/confirm-items';
import { claimScanner } from '../../core/scanner';
import { AppSettings } from '../../core/settings/app-settings.service';
import { fromDateInput } from '../inventory/receive-stock-form';

export interface PurchaseReceiveContext {
  purchase: PurchaseDetail;
}

interface LineEntry {
  arriving: string;
  batchNumber: string;
  expiry: string;
}

/**
 * A delivery of an order: scan each product as it comes out of the box (or type what arrived, or take all that is
 * left), then lot and expiry for the lines that track them. What arrived is received against the order; the rest
 * stays to come. All or nothing. Closes with the updated order.
 */
@Component({
  host: { class: 'contents' },
  imports: [ConfirmItems, OnScreenKeypadDirective, HlmAlertDialogImports, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Receive {{ purchase.number }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); review()">
      <ul class="divide-border flex flex-col divide-y border-y">
        @for (line of lines; track line.id) {
          <li class="grid gap-3 py-3">
            <div class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate">{{ line.productName }}</span>
              <span class="text-muted-foreground shrink-0 text-sm">{{ qty(left(line)) }} left of {{ qty(line.quantityMilli) }}{{ unitText(line) }}</span>
            </div>
            @if (line.tracking === 'none') {
              <p class="text-muted-foreground text-sm">Stock is not tracked for this product.</p>
            } @else {
              <div class="flex gap-2">
                <input
                  hlmInput
                  type="text"
                  class="min-w-0 flex-1"
                  placeholder="Arrived"
                  appOnScreenKeypad
                  [keypadWholeDigits]="5"
                  [keypadDecimals]="3"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                  [attr.aria-label]="'Arrived of ' + line.productName"
                  [forceInvalid]="!!errorFor(line)"
                  [value]="entry(line).arriving"
                  (input)="set(line, 'arriving', $any($event.target).value)"
                />
                <button hlmBtn variant="outline" type="button" class="px-4" [attr.aria-label]="'All of ' + line.productName" (click)="set(line, 'arriving', qty(left(line)))">All</button>
              </div>
              @if (arriving(line) > 0) {
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
              }
            }
            @if (errorFor(line); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </li>
        }
      </ul>
      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer class="sm:items-center sm:justify-between">
      <button hlmBtn variant="outline" type="button" class="px-4" (click)="takeAll()">Everything left</button>
      <div class="flex gap-2">
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
        <button hlmBtn type="button" class="px-6" [disabled]="saving() || !anyArriving()" (click)="review()">Receive</button>
      </div>
    </hlm-dialog-footer>

    <!-- Asked before anything is written: what is about to go into stock (or that nothing will). -->
    <hlm-alert-dialog [state]="confirming() ? 'open' : 'closed'" (closed)="confirming.set(false)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h3 hlmAlertDialogTitle>Receive stock for {{ purchase.number }}?</h3>
          <p hlmAlertDialogDescription>{{ confirmText() }}</p>
        </hlm-alert-dialog-header>
        @if (confirmItems().length) {
          <app-confirm-items [items]="confirmItems()" />
        }
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel type="button">Cancel</button>
          <button hlmAlertDialogAction type="button" (click)="send()">Receive</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class PurchaseReceiveForm {
  protected readonly settings = inject(AppSettings);
  private readonly purchases = inject(PurchasesService);
  private readonly products = inject(ProductsService);
  private readonly ref = inject<BrnDialogRef<PurchaseDetail | undefined>>(BrnDialogRef);
  protected readonly purchase = injectBrnDialogContext<PurchaseReceiveContext>().purchase;
  /** What is still to come: lines already fully received are left out. */
  protected readonly lines = this.purchase.lines.filter((l) => l.quantityMilli > l.receivedMilli);

  private readonly entries = signal<Record<string, LineEntry>>({});
  protected readonly saving = signal(false);
  private readonly problem = signal<{ lineId: string | null; field: 'batchNumber' | 'expiresAt' | 'quantity' | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem() && this.problem()!.lineId === null ? this.problem()!.error : null));
  protected readonly qty = formatQuantity;

  constructor() {
    // A scan counts one of that product as arrived (the line's quantity can then be corrected by hand).
    claimScanner(({ code }) => {
      const line = this.lines.find((l) => l.productCode === code && l.tracking !== 'none');
      if (!line) {
        this.problem.set({ lineId: null, field: null, error: `No product with code ${code} is waiting on ${this.purchase.number}` });
        return;
      }
      const next = this.arriving(line) + 1000;
      if (next > this.left(line)) {
        this.problem.set({ lineId: line.id, field: 'quantity', error: `${line.productName}: more than is left` });
        return;
      }
      this.problem.set(null);
      this.set(line, 'arriving', formatQuantity(next));
    });
  }

  protected left(line: PurchaseLineRecord): number {
    return line.quantityMilli - line.receivedMilli;
  }
  protected unitText(line: PurchaseLineRecord): string {
    return line.unit === 'each' ? '' : ` ${line.unit}`;
  }
  protected readonly batches = (line: PurchaseLineRecord): boolean => tracksBatches(line.tracking);
  protected readonly expires = (line: PurchaseLineRecord): boolean => tracksExpiry(line.tracking);

  protected entry(line: PurchaseLineRecord): LineEntry {
    return this.entries()[line.id] ?? { arriving: '', batchNumber: '', expiry: '' };
  }
  protected set(line: PurchaseLineRecord, key: keyof LineEntry, value: string): void {
    this.entries.update((all) => ({ ...all, [line.id]: { ...this.entry(line), [key]: value } }));
  }
  /** What is arriving for a line, in thousandths (0 when empty or not a valid quantity). */
  protected arriving(line: PurchaseLineRecord): number {
    return parseQuantityMilli(this.entry(line).arriving) ?? 0;
  }
  /** Something is arriving (an order of only products that track no stock has nothing to count, so it can always be received). */
  protected readonly anyArriving = computed(() => this.lines.every((l) => l.tracking === 'none') || this.lines.some((l) => l.tracking !== 'none' && this.arriving(l) > 0));

  protected takeAll(): void {
    for (const line of this.lines) if (line.tracking !== 'none') this.set(line, 'arriving', formatQuantity(this.left(line)));
  }

  protected invalid(line: PurchaseLineRecord, field: 'batchNumber' | 'expiresAt'): boolean {
    const p = this.problem();
    return p?.lineId === line.id && p.field === field;
  }
  protected errorFor(line: PurchaseLineRecord): string | null {
    const p = this.problem();
    return p?.lineId === line.id ? p.error : null;
  }

  protected readonly confirming = signal(false);
  protected readonly confirmItems = signal<ConfirmItem[]>([]);
  protected readonly confirmText = signal('');

  /** Checks what was entered, then asks to confirm; nothing is written until it is. */
  protected review(): void {
    if (this.saving() || !this.anyArriving()) return;
    this.problem.set(null);
    for (const line of this.lines.filter((l) => l.tracking !== 'none')) {
      const e = this.entry(line);
      if (e.arriving.trim() !== '' && parseQuantityMilli(e.arriving) === null) return void this.problem.set({ lineId: line.id, field: 'quantity', error: `${line.productName}: Enter a valid quantity` });
      if (this.arriving(line) > this.left(line)) return void this.problem.set({ lineId: line.id, field: 'quantity', error: `${line.productName}: More than is left` });
      if (this.arriving(line) > 0 && this.batches(line) && !e.batchNumber.trim()) return void this.problem.set({ lineId: line.id, field: 'batchNumber', error: `${line.productName}: Enter a batch number` });
      if (this.arriving(line) > 0 && this.expires(line) && fromDateInput(e.expiry) === null) return void this.problem.set({ lineId: line.id, field: 'expiresAt', error: `${line.productName}: Enter an expiry date` });
    }
    const arriving = this.lines.filter((l) => l.tracking !== 'none' && this.arriving(l) > 0);
    this.confirmItems.set(arriving.map((l) => ({ label: l.productName, detail: `${formatQuantity(this.arriving(l))}${this.unitText(l)}` })));
    const rest = this.lines.some((l) => l.tracking !== 'none' && this.arriving(l) < this.left(l));
    this.confirmText.set(
      arriving.length
        ? `These go into stock now at the ordered cost.${rest ? ' What has not arrived stays on the order.' : ''}`
        : 'None of these products track stock, so nothing is added to stock. The order is marked received.',
    );
    this.confirming.set(true);
  }

  protected async send(): Promise<void> {
    this.confirming.set(false);
    if (this.saving()) return;
    this.problem.set(null);
    this.saving.set(true);
    const result = await this.purchases.receive({
      purchaseId: this.purchase.id,
      lines: this.lines
        .filter((l) => l.tracking !== 'none')
        .map((line) => {
          const e = this.entry(line);
          return { lineId: line.id, quantityMilli: this.arriving(line), batchNumber: this.batches(line) ? e.batchNumber : null, expiresAt: this.expires(line) ? fromDateInput(e.expiry) : null };
        }),
    });
    this.saving.set(false);
    if (result.ok) {
      void this.products.load(); // the Products table shows stock too
      this.ref.close(result.purchase);
    } else this.problem.set({ lineId: result.lineId, field: result.field, error: result.error });
  }
}
