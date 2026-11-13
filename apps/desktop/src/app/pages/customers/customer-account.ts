import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { type CustomerAccount, formatRate, INTEREST_MODE_LABELS, type LedgerEntryRecord, type OrderPaymentMethod, ORDER_PAYMENT_METHODS } from '@micropos/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports, HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { BannerService } from '../../core/banner';
import { CustomersService } from '../../core/data/customers.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { MoneyPipe } from '../../core/money.pipe';
import { VIEW_SALES_ORDER_PARAM } from '../../core/sales-order-param';
import { AppSettings } from '../../core/settings/app-settings.service';
import { METHOD_LABELS } from '../orders/sales-order-form';
import { CustomerForm, type CustomerFormContext } from './customer-form';

export interface CustomerAccountContext {
  account: CustomerAccount;
}

/** A customer's account: what they owe, the ledger behind it, and a way to record money received. */
@Component({
  host: { class: 'contents' },
  imports: [DatePipe, MoneyPipe, OnScreenKeypadDirective, HlmBadgeImports, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle class="flex items-center gap-3">
        <span class="min-w-0 truncate select-text">{{ account().customer.name }}</span>
        @if (account().customer.deletedAt) {
          <span hlmBadge variant="outline">Deleted</span>
        }
      </h3>
    </hlm-dialog-header>

    <div class="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2 py-1">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
        <dt class="text-muted-foreground">{{ balance() < 0 ? 'Credit' : 'Owes' }}</dt>
        <dd class="font-heading text-2xl" [class.text-destructive]="balance() > 0">{{ absBalance() | money }}</dd>
        @if (account().customer.creditLimit !== null) {
          <dt class="text-muted-foreground">Credit limit</dt>
          <dd>{{ account().customer.creditLimit! | money }}</dd>
        }
        @if (interest(); as text) {
          <dt class="text-muted-foreground">Interest</dt>
          <dd>{{ text }}</dd>
        }
        @if (account().customer.phone) {
          <dt class="text-muted-foreground">Phone</dt>
          <dd class="select-text">{{ account().customer.phone }}</dd>
        }
        @if (account().customer.note) {
          <dt class="text-muted-foreground">Note</dt>
          <dd class="select-text">{{ account().customer.note }}</dd>
        }
      </dl>

      @if (receiving()) {
        <form class="grid gap-3 border p-3" (submit)="$event.preventDefault(); submit()">
          <div class="flex flex-col gap-2">
            <label hlmLabel data-required for="pay-amount">Amount received</label>
            <div class="flex gap-2">
              <input
                hlmInput
                id="pay-amount"
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
              <button hlmBtn variant="outline" type="button" (click)="payInFull()">Full balance</button>
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
            <label hlmLabel for="pay-reference">Reference</label>
            <input hlmInput id="pay-reference" type="text" [value]="reference()" (input)="reference.set($any($event.target).value)" />
          </div>
          @if (error()) { <p class="text-destructive text-sm">{{ error() }}</p> }
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" type="button" class="px-4" (click)="receiving.set(false)">Cancel</button>
            <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Record payment</button>
          </div>
        </form>
      }

      <ul class="divide-border flex flex-col divide-y border-y" aria-label="Account history">
        @for (entry of account().entries; track entry.id) {
          <li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2">
            <div class="min-w-0">
              <p class="truncate">
                @if (entry.orderId && entry.orderNumber) {
                  {{ verb(entry) }}
                  <button type="button" class="text-primary underline-offset-4 hover:underline" (click)="openOrder(entry.orderId)">{{ entry.orderNumber }}</button>
                } @else {
                  {{ describe(entry) }}
                }
              </p>
              <p class="text-muted-foreground text-xs">{{ entry.at | date: 'MMM d, y, h:mm a' }}@if (entry.employeeName) { · {{ entry.employeeName }} }@if (entry.reference) { · <span class="select-text">{{ entry.reference }}</span> }</p>
            </div>
            <div class="text-right">
              <p [class.text-destructive]="entry.amount > 0">{{ entry.amount | money }}</p>
              <p class="text-muted-foreground text-xs">{{ entry.balanceAfter | money }}</p>
            </div>
          </li>
        } @empty {
          <li class="text-muted-foreground py-6 text-center text-sm">No activity yet</li>
        }
      </ul>
    </div>

    <hlm-dialog-footer class="sm:justify-between">
      <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="!!account().customer.deletedAt" (click)="edit()">Edit</button>
      <div class="flex gap-2">
        @if (balance() > 0 && !receiving() && !account().customer.deletedAt) {
          <button hlmBtn variant="outline" type="button" class="px-4" (click)="startReceiving()">Receive payment</button>
        }
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
      </div>
    </hlm-dialog-footer>
  `,
})
export class CustomerAccountForm {
  protected readonly settings = inject(AppSettings);
  private readonly customers = inject(CustomersService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly router = inject(Router);
  private readonly money = new MoneyPipe();

  /** Replaced with a fresh copy after a payment or an edit. */
  protected readonly account = signal(injectBrnDialogContext<CustomerAccountContext>().account);
  protected readonly balance = computed(() => this.account().customer.balance);
  protected readonly absBalance = computed(() => Math.abs(this.balance()));

  /** "3% a month, per sales order", or null for a customer without interest. */
  protected readonly interest = computed(() => {
    const c = this.account().customer;
    return c.interestMode && c.interestRateBp ? `${formatRate(c.interestRateBp)}% a month, ${INTEREST_MODE_LABELS[c.interestMode].toLowerCase()}` : null;
  });

  protected readonly receiving = signal(false);
  protected readonly amount = signal('');
  protected readonly method = signal<OrderPaymentMethod>('cash');
  protected readonly reference = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly methods = ORDER_PAYMENT_METHODS;
  protected readonly methodLabel = (m: OrderPaymentMethod): string => METHOD_LABELS[m] ?? '';

  protected startReceiving(): void {
    this.error.set('');
    this.receiving.set(true);
  }
  protected payInFull(): void {
    this.amount.set(formatCentsInput(this.balance()));
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    const cents = parseCents(this.amount());
    if (cents === null || cents <= 0) return void this.error.set('Enter the amount received');
    this.saving.set(true);
    this.error.set('');
    const { customer } = this.account();
    const result = await this.customers.receivePayment({ customerId: customer.id, amount: cents, method: this.method(), reference: this.reference().trim() || null });
    this.saving.set(false);
    if (!result.ok) return void this.error.set(result.error);
    this.banner.success(`${this.money.transform(cents)} received from ${customer.name}`, { key: 'customer-payment' });
    this.receiving.set(false);
    this.amount.set('');
    this.reference.set('');
    await this.refresh();
  }

  protected edit(): void {
    const { customer } = this.account();
    this.dialogs
      .open<boolean, CustomerFormContext>(CustomerForm, {
        id: 'customer-form',
        contentClass: 'w-[min(28rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { customer },
      })
      .closed$.subscribe((saved) => {
        if (saved) void this.refresh();
      });
  }

  private async refresh(): Promise<void> {
    const fresh = await this.customers.account(this.account().customer.id);
    if (fresh) this.account.set(fresh);
  }

  /** The sale, refund or void an entry belongs to replaces nothing: it opens over this dialog. */
  protected openOrder(orderId: string): void {
    void this.router.navigate([], { queryParams: { [VIEW_SALES_ORDER_PARAM]: orderId }, queryParamsHandling: 'merge' });
  }

  protected verb(entry: LedgerEntryRecord): string {
    return { charge: 'Sale', refund: 'Refund', void: 'Void', payment: 'Payment', adjustment: 'Adjustment', interest: 'Interest' }[entry.type];
  }
  protected describe(entry: LedgerEntryRecord): string {
    if (entry.type === 'payment') return `Payment${entry.method ? ' · ' + METHOD_LABELS[entry.method] : ''}`;
    return entry.note ?? this.verb(entry);
  }
}
