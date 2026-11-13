import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { formatQuantity, ORDER_PAYMENT_METHODS, type OrderPaymentMethod, type PurchaseDetail, type PurchaseLineRecord } from '@micropos/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports, HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { BannerService } from '../../core/banner';
import { PurchasesService } from '../../core/data/purchases.service';
import { SuppliersService } from '../../core/data/suppliers.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { MoneyPipe } from '../../core/money.pipe';
import { AppSettings } from '../../core/settings/app-settings.service';
import { METHOD_LABELS } from '../orders/sales-order-form';
import { ReceiveStockForm, type ReceiveStockContext } from '../inventory/receive-stock-form';
import { PurchaseForm, type PurchaseFormContext } from './purchase-form';
import { PurchaseReceiveForm, type PurchaseReceiveContext } from './purchase-receive-form';
import { isOverdue, statusText, statusVariant } from './purchase-status';

export interface PurchaseDetailContext {
  purchase: PurchaseDetail;
}

/** A purchase order: its lines, what is paid and owed, and what can be done next (edit, receive, pay, cancel). */
@Component({
  host: { class: 'contents' },
  imports: [DatePipe, MoneyPipe, OnScreenKeypadDirective, HlmAlertDialogImports, HlmBadgeImports, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle class="flex items-center gap-3">
        <span class="select-text">{{ purchase().number }}</span>
        <span hlmBadge [variant]="variant()">{{ statusLabel() }}</span>
        @if (overdue()) {
          <span hlmBadge variant="destructive">Overdue</span>
        }
      </h3>
    </hlm-dialog-header>

    <div class="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2 py-1">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
        <dt class="text-muted-foreground">Supplier</dt>
        <dd class="select-text">{{ purchase().supplierName }}</dd>
        <dt class="text-muted-foreground">Ordered</dt>
        <dd>{{ purchase().orderedAt | date: 'MMM d, y, h:mm a' }}@if (purchase().employeeName) { · {{ purchase().employeeName }} }</dd>
        @if (purchase().expectedAt) {
          <dt class="text-muted-foreground">Expected</dt>
          <dd>{{ purchase().expectedAt! | date: 'MMM d, y' }}</dd>
        }
        @if (purchase().receivedAt) {
          <dt class="text-muted-foreground">Received</dt>
          <dd>{{ purchase().receivedAt! | date: 'MMM d, y, h:mm a' }}</dd>
        }
        @if (purchase().dueAt) {
          <dt class="text-muted-foreground">Payment due</dt>
          <dd [class.text-destructive]="overdue()">{{ purchase().dueAt! | date: 'MMM d, y' }}</dd>
        }
        @if (purchase().reference) {
          <dt class="text-muted-foreground">Reference</dt>
          <dd class="select-text">{{ purchase().reference }}</dd>
        }
        @if (purchase().note) {
          <dt class="text-muted-foreground">Note</dt>
          <dd class="select-text">{{ purchase().note }}</dd>
        }
      </dl>

      <ul class="divide-border flex flex-col divide-y border-y" aria-label="Products">
        @for (line of purchase().lines; track line.id) {
          <li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2">
            <div class="min-w-0">
              <p class="truncate">{{ line.productName }}</p>
              <p class="text-muted-foreground text-xs">{{ quantity(line) }} × {{ line.unitCost | money }}@if (line.receivedMilli > 0) { · {{ received(line) }} received }</p>
            </div>
            <p class="text-right">{{ line.total | money }}</p>
          </li>
        }
      </ul>

      <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-sm">
        <dt class="text-muted-foreground">Total</dt>
        <dd class="text-right">{{ purchase().total | money }}</dd>
        <dt class="text-muted-foreground">Paid</dt>
        <dd class="text-right">{{ purchase().paid | money }}</dd>
        <dt>Owed</dt>
        <dd class="font-heading text-right text-2xl" [class.text-destructive]="purchase().owed > 0">{{ purchase().owed | money }}</dd>
      </dl>

      @if (paying()) {
        <form class="grid gap-3 border p-3" (submit)="$event.preventDefault(); submit()">
          <div class="flex flex-col gap-2">
            <label hlmLabel data-required for="pp-amount">Amount paid</label>
            <div class="flex gap-2">
              <input
                hlmInput
                id="pp-amount"
                type="text"
                class="min-w-0 flex-1"
                placeholder="0.00"
                appOnScreenKeypad
                [keypadWholeDigits]="7"
                [keypadDecimals]="2"
                [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                [value]="amount()"
                (input)="amount.set($any($event.target).value)"
              />
              <button hlmBtn variant="outline" type="button" (click)="payInFull()">Full amount</button>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label hlmLabel data-required>Paid by</label>
            <hlm-select [(value)]="method" [itemToString]="methodLabel">
              <hlm-select-trigger class="w-full" aria-label="Payment method">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (m of methods; track m) {
                  <hlm-select-item [value]="m">{{ methodLabel(m) }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>
          <div class="flex flex-col gap-2">
            <label hlmLabel for="pp-reference">Reference</label>
            <input hlmInput id="pp-reference" type="text" [value]="reference()" (input)="reference.set($any($event.target).value)" />
          </div>
          @if (error()) { <p class="text-destructive text-sm">{{ error() }}</p> }
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" type="button" class="px-4" (click)="paying.set(false)">Cancel</button>
            <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Record payment</button>
          </div>
        </form>
      }

      @if (purchase().payments.length) {
        <ul class="divide-border flex flex-col divide-y border-y" aria-label="Payments">
          @for (payment of purchase().payments; track payment.id) {
            <li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2">
              <div class="min-w-0">
                <p class="truncate">Payment · {{ methodLabel(payment.method) }}</p>
                <p class="text-muted-foreground text-xs">{{ payment.at | date: 'MMM d, y, h:mm a' }}@if (payment.employeeName) { · {{ payment.employeeName }} }@if (payment.reference) { · <span class="select-text">{{ payment.reference }}</span> }</p>
              </div>
              <p class="text-right">{{ payment.amount | money }}</p>
            </li>
          }
        </ul>
      }
    </div>

    <hlm-dialog-footer class="sm:flex-wrap sm:justify-between">
      <div class="flex flex-wrap gap-2">
        @if (editable()) {
          <button hlmBtn variant="outline" type="button" class="px-5" (click)="edit()">Edit</button>
        }
        @if (cancellable()) {
          <hlm-alert-dialog>
            <button hlmAlertDialogTrigger hlmBtn variant="destructive" type="button" class="px-4">Cancel order</button>
            <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
              <hlm-alert-dialog-header>
                <h3 hlmAlertDialogTitle>Cancel {{ purchase().number }}?</h3>
                <p hlmAlertDialogDescription>The order is kept on record as cancelled and nothing is owed on it.</p>
              </hlm-alert-dialog-header>
              <hlm-alert-dialog-footer>
                <button hlmAlertDialogCancel type="button">Keep order</button>
                <button hlmAlertDialogAction variant="destructive" type="button" (click)="cancel()">Cancel order</button>
              </hlm-alert-dialog-footer>
            </hlm-alert-dialog-content>
          </hlm-alert-dialog>
        }
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        @if (payable() && !paying()) {
          <button hlmBtn variant="outline" type="button" class="px-4" (click)="startPaying()">Record payment</button>
        }
        @if (awaiting()) {
          <!-- One product at a time (scan or pick), unlike the delivery below that lists every line at once. -->
          <button hlmBtn variant="outline" type="button" class="px-4" (click)="receiveByItem()">Receive by item</button>
          <button hlmBtn type="button" class="px-4" (click)="receive()">{{ purchase().partlyReceived ? 'Receive the rest' : 'Receive stock' }}</button>
        }
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-4">Close</button>
      </div>
    </hlm-dialog-footer>
  `,
})
export class PurchaseDetailForm {
  protected readonly settings = inject(AppSettings);
  private readonly purchases = inject(PurchasesService);
  private readonly suppliers = inject(SuppliersService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly money = new MoneyPipe();

  /** Replaced with a fresh copy after every change. */
  protected readonly purchase = signal(injectBrnDialogContext<PurchaseDetailContext>().purchase);
  protected readonly variant = computed(() => statusVariant(this.purchase().status));
  protected readonly statusLabel = computed(() => statusText(this.purchase()));
  protected readonly overdue = computed(() => isOverdue(this.purchase()));
  /** Waiting for stock: the rest of it can be received. */
  protected readonly awaiting = computed(() => this.purchase().status === 'ordered');
  /** Nothing has arrived yet: it can still be changed or (unpaid) cancelled. */
  protected readonly editable = computed(() => this.awaiting() && !this.purchase().partlyReceived);
  protected readonly cancellable = computed(() => this.editable() && this.purchase().paid === 0);
  protected readonly payable = computed(() => this.purchase().status !== 'cancelled' && this.purchase().owed > 0);

  protected readonly paying = signal(false);
  protected readonly amount = signal('');
  protected readonly method = signal<OrderPaymentMethod>('cash');
  protected readonly reference = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly methods = ORDER_PAYMENT_METHODS;
  protected readonly methodLabel = (m: OrderPaymentMethod): string => METHOD_LABELS[m] ?? '';

  protected quantity(line: PurchaseLineRecord): string {
    return `${formatQuantity(line.quantityMilli)}${line.unit === 'each' ? '' : ' ' + line.unit}`;
  }

  protected received(line: PurchaseLineRecord): string {
    return line.receivedMilli >= line.quantityMilli ? 'all' : formatQuantity(line.receivedMilli);
  }

  protected startPaying(): void {
    this.error.set('');
    this.paying.set(true);
  }
  protected payInFull(): void {
    this.amount.set(formatCentsInput(this.purchase().owed));
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    const cents = parseCents(this.amount());
    if (cents === null || cents <= 0) return void this.error.set('Enter the amount paid');
    this.saving.set(true);
    this.error.set('');
    const result = await this.purchases.pay({ purchaseId: this.purchase().id, amount: cents, method: this.method(), reference: this.reference().trim() || null });
    this.saving.set(false);
    if (!result.ok) return void this.error.set(result.error);
    this.banner.success(`${this.money.transform(cents)} paid to ${this.purchase().supplierName}`, { key: 'purchase-payment' });
    this.paying.set(false);
    this.amount.set('');
    this.reference.set('');
    this.purchase.set(result.purchase);
    void this.suppliers.load();
  }

  protected edit(): void {
    this.dialogs
      .open<PurchaseDetail | undefined, PurchaseFormContext>(PurchaseForm, {
        id: 'purchase-form',
        contentClass: 'w-[min(40rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { purchase: this.purchase() },
      })
      .closed$.subscribe((saved) => {
        if (saved) {
          this.purchase.set(saved);
          this.banner.success('Purchase order saved', { key: 'purchase-saved' });
        }
      });
  }

  /** The Receive stock dialog with this order chosen: scan or pick products as they come out of the box. */
  protected receiveByItem(): void {
    const id = this.purchase().id;
    this.dialogs
      .open<boolean, ReceiveStockContext>(ReceiveStockForm, {
        id: 'receive-stock',
        contentClass: 'w-[min(34rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { orderId: id },
      })
      .closed$.subscribe(async () => {
        const fresh = await this.purchases.get(id); // receipts changed what has arrived
        if (fresh) this.purchase.set(fresh);
        void this.suppliers.load();
      });
  }

  protected receive(): void {
    this.dialogs
      .open<PurchaseDetail | undefined, PurchaseReceiveContext>(PurchaseReceiveForm, {
        id: 'purchase-receive',
        contentClass: 'w-[min(32rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { purchase: this.purchase() },
      })
      .closed$.subscribe((received) => {
        if (!received) return;
        this.purchase.set(received);
        this.banner.success(`${received.number} received into stock`, { key: 'purchase-received' });
      });
  }

  protected async cancel(): Promise<void> {
    const result = await this.purchases.cancel(this.purchase().id);
    if (result.ok) {
      this.purchase.set(result.purchase);
      void this.suppliers.load();
      this.banner.success('Purchase order cancelled', { key: 'purchase-cancelled' });
    } else this.banner.error(result.error, { key: 'purchase-cancelled' });
  }
}
