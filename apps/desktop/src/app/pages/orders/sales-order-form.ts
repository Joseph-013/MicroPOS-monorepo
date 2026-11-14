import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideExternalLink } from '@ng-icons/lucide';
import { canReverseOrder, formatQuantity, isWeighed, type SalesOrderDetail } from '@micropos/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { OrdersService } from '../../core/data/orders.service';
import { DialogPageLink } from '../../core/ui/dialog-page-link';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { MoneyPipe } from '../../core/money.pipe';
import { CustomerViewer } from '../../core/customer-viewer';
import { OrderActions } from '../../core/order-actions';
import { ProductViewer } from '../../core/product-viewer';
import { HIGHLIGHT_PARAM } from '../../core/row-target';
import { VIEW_SALES_ORDER_PARAM } from '../../core/sales-order-param';
import type { OrderActionKind } from './order-action-form';

export interface SalesOrderFormContext {
  order: SalesOrderDetail;
  /** `view` is the only mode: a recorded order is never edited. Void and refund are separate confirmations opened from here. */
  mode?: 'view';
}

export const STATUS_LABELS = { open: 'Open', completed: 'Completed', voided: 'Voided', refunded: 'Refunded' } as const;
export const METHOD_LABELS = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' } as const;

/** A sales order in view mode: who, when, the lines, the totals and how it was paid. */
@Component({
  host: { class: 'contents' },
  imports: [DatePipe, MoneyPipe, DialogPageLink, NgIcon, RouterLink, HlmBadgeImports, HlmButtonImports, HlmDialogImports],
  viewProviders: [provideIcons({ lucideExternalLink })],
  template: `
    <hlm-dialog-header class="pe-10">
      <div class="flex items-center gap-2">
        <h3 hlmDialogTitle>Sales Order</h3>
        <app-dialog-page-link path="/orders" label="Sales Orders" [highlight]="order().id" />
      </div>
      <p class="flex items-center gap-3 text-base">
        <span class="select-text">{{ order().orderNumber }}</span>
        <span hlmBadge [variant]="statusVariant()">{{ statusLabel() }}</span>
      </p>
    </hlm-dialog-header>

    <div class="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2 py-1">
      <dl class="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt>Date</dt>
        <dd class="text-foreground">{{ (order().completedAt ?? order().createdAt) | date: 'MMM d, y, h:mm a' }}</dd>
        <dt>Cashier</dt>
        <dd class="text-foreground">{{ order().employeeName }}</dd>
        @if (order().customer; as customer) {
          <dt>Customer</dt>
          <dd><button type="button" class="text-primary underline-offset-4 hover:underline" (click)="viewCustomer(customer.id)">{{ customer.name }}</button></dd>
        }
        @if (order().onAccount !== 0) {
          <dt>On account</dt>
          <dd [class.text-destructive]="order().onAccount > 0">{{ order().onAccount | money }}</dd>
        }
        @if (order().refundOf; as source) {
          <dt>Refund of</dt>
          <dd><button type="button" class="text-primary underline-offset-4 hover:underline" (click)="openOrder(source.id)">{{ source.orderNumber }}</button></dd>
        }
        @if (order().refundedBy; as refund) {
          <dt>Refunded by</dt>
          <dd><button type="button" class="text-primary underline-offset-4 hover:underline" (click)="openOrder(refund.id)">{{ refund.orderNumber }}</button></dd>
        }
      </dl>

      <ul class="divide-border flex flex-col divide-y border-y" aria-label="Items">
        @for (line of order().lines; track line.id) {
          <li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2">
            <div class="min-w-0">
              @if (line.productId) {
                <div class="flex min-w-0 items-center gap-1">
                  <!-- The name opens the product in a dialog over this one. -->
                  <button type="button" class="text-primary min-w-0 truncate text-left underline-offset-4 hover:underline" (click)="viewProduct(line.productId)">{{ line.name }}</button>
                  <!-- The small link goes to the product on the Products page (this dialog closes). -->
                  <a
                    hlmBtn
                    variant="ghost"
                    size="icon-xs"
                    class="shrink-0"
                    routerLink="/items/products"
                    [queryParams]="productQuery(line.productId)"
                    [attr.aria-label]="'Open ' + line.name + ' in Products'"
                    title="Open in Products"
                  >
                    <ng-icon name="lucideExternalLink" size="14" />
                  </a>
                </div>
              } @else {
                <p class="truncate">{{ line.name }}</p>
              }
              <p class="text-muted-foreground text-sm">
                {{ quantity(line) }} × {{ line.unitPrice | money }}@if (line.unit && isWeighed(line.unit)) { / {{ line.unit }} }
              </p>
            </div>
            <span class="text-right">{{ line.lineTotal | money }}</span>
          </li>
        }
      </ul>

      <dl class="flex flex-col gap-1 text-sm">
        <div class="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{{ order().subtotal | money }}</dd>
        </div>
        @if (order().discountTotal) {
          <div class="text-muted-foreground flex justify-between">
            <dt>Discount</dt>
            <dd>−{{ order().discountTotal | money }}</dd>
          </div>
        }
        <div class="font-heading flex justify-between border-t pt-2 text-2xl">
          <dt>Total</dt>
          <dd>{{ order().total | money }}</dd>
        </div>
      </dl>

      @for (payment of order().payments; track $index) {
        <dl class="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt>Paid by</dt>
          <dd class="text-foreground">{{ methodLabels[payment.method] }}: {{ payment.amount | money }}</dd>
          @if (payment.tendered !== null) {
            <dt>Tendered</dt>
            <dd class="text-foreground">{{ payment.tendered | money }}</dd>
            <dt>Change</dt>
            <dd class="text-foreground">{{ payment.change ?? 0 | money }}</dd>
          }
          @if (payment.reference) {
            <dt>Reference</dt>
            <dd class="text-foreground select-text">{{ payment.reference }}</dd>
          }
        </dl>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn variant="outline" type="button" class="px-4 sm:mr-auto" [disabled]="printing()" (click)="print()">Print receipt</button>
      @if (canReverse()) {
        <button hlmBtn variant="destructive" type="button" class="px-4" (click)="reverse('void')">Void</button>
        <button hlmBtn variant="outline" type="button" class="px-4" (click)="reverse('refund')">Refund</button>
      }
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
    </hlm-dialog-footer>
  `,
})
export class SalesOrderForm {
  /** The order shown; replaced with a fresh copy after a void or refund. */
  protected readonly order = signal(injectBrnDialogContext<SalesOrderFormContext>().order);
  private readonly actions = inject(OrderActions);
  private readonly orders = inject(OrdersService);
  private readonly router = inject(Router);
  private readonly customerViewer = inject(CustomerViewer);
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);
  protected readonly printing = signal(false);

  /** Sends the order's receipt to the receipt printer (the main process prints it); says in a banner how it went. */
  protected async print(): Promise<void> {
    if (this.printing()) return;
    this.printing.set(true);
    try {
      const result = (await this.api?.printer.printOrder(this.order().id)) ?? { ok: false as const, error: 'Not connected to the database' };
      if (result.ok) this.banner.success(`Receipt for ${this.order().orderNumber} sent to the printer`, { key: 'print-receipt' });
      else this.banner.error(result.error, { key: 'print-receipt', duration: 'long' });
    } catch (error) {
      console.error('Failed to print the receipt', error);
      this.banner.error('Could not print the receipt', { key: 'print-receipt' });
    } finally {
      this.printing.set(false);
    }
  }

  /** Opens the customer's account over this dialog. */
  protected viewCustomer(customerId: string): void {
    void this.customerViewer.open(customerId);
  }
  protected readonly canReverse = computed(() => canReverseOrder({ status: this.order().status, isRefund: !!this.order().refundOf }));
  protected readonly statusLabel = computed(() => (this.order().refundOf ? 'Refund' : STATUS_LABELS[this.order().status]));

  /** Confirms and does a void or refund of this order, then shows its new state. */
  protected async reverse(kind: OrderActionKind): Promise<void> {
    const order = this.order();
    const outcome = await this.actions.run(kind, [{ id: order.id, orderNumber: order.orderNumber, total: order.total }]);
    if (!outcome?.done.length) return;
    const fresh = await this.orders.get(order.id);
    if (fresh) this.order.set(fresh);
  }

  /** The linked sale or refund replaces this dialog. */
  protected openOrder(id: string): void {
    void this.router.navigate([], { queryParams: { [VIEW_SALES_ORDER_PARAM]: id }, queryParamsHandling: 'merge' });
  }

  private readonly productViewer = inject(ProductViewer);

  /** Opens the product in view mode over this dialog. */
  protected viewProduct(productId: string): void {
    void this.productViewer.open(productId);
  }

  /** The Products page, on the page of the table that holds the product, with its row highlighted. */
  protected productQuery(productId: string): Record<string, string> {
    return { [HIGHLIGHT_PARAM]: productId };
  }
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly methodLabels = METHOD_LABELS;
  protected readonly isWeighed = isWeighed;

  protected statusVariant(): 'success' | 'destructive' | 'outline' {
    const { status, refundOf } = this.order();
    return refundOf ? 'outline' : status === 'completed' ? 'success' : status === 'open' ? 'outline' : 'destructive';
  }

  protected quantity(line: SalesOrderDetail['lines'][number]): string {
    return `${formatQuantity(Math.abs(line.quantityMilli))}${isWeighed(line.unit ?? 'each') ? ` ${line.unit}` : ''}`;
  }
}
