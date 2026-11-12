import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideExternalLink } from '@ng-icons/lucide';
import { formatQuantity, isWeighed, type SalesOrderDetail } from '@micropos/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { MoneyPipe } from '../../core/money.pipe';
import { ProductViewer } from '../../core/product-viewer';
import { HIGHLIGHT_PARAM } from '../../core/row-target';

export interface SalesOrderFormContext {
  order: SalesOrderDetail;
  /** `view` is the only mode so far: a recorded order is read-only (void and refund come later). */
  mode?: 'view';
}

export const STATUS_LABELS = { open: 'Open', completed: 'Completed', voided: 'Voided', refunded: 'Refunded' } as const;
export const METHOD_LABELS = { cash: 'Cash', card: 'Card', other: 'Other' } as const;

/** A sales order in view mode: who, when, the lines, the totals and how it was paid. */
@Component({
  host: { class: 'contents' },
  imports: [DatePipe, MoneyPipe, NgIcon, RouterLink, HlmBadgeImports, HlmButtonImports, HlmDialogImports],
  viewProviders: [provideIcons({ lucideExternalLink })],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle class="flex items-center gap-3">
        <span class="select-text">{{ order.orderNumber }}</span>
        <span hlmBadge [variant]="statusVariant()">{{ statusLabels[order.status] }}</span>
      </h3>
    </hlm-dialog-header>

    <div class="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2 py-1">
      <dl class="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt>Date</dt>
        <dd class="text-foreground">{{ (order.completedAt ?? order.createdAt) | date: 'MMM d, y, h:mm a' }}</dd>
        <dt>Cashier</dt>
        <dd class="text-foreground">{{ order.employeeName }}</dd>
      </dl>

      <ul class="divide-border flex flex-col divide-y border-y" aria-label="Items">
        @for (line of order.lines; track line.id) {
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
          <dd>{{ order.subtotal | money }}</dd>
        </div>
        @if (order.discountTotal) {
          <div class="text-muted-foreground flex justify-between">
            <dt>Discount</dt>
            <dd>−{{ order.discountTotal | money }}</dd>
          </div>
        }
        <div class="font-heading flex justify-between border-t pt-2 text-2xl">
          <dt>Total</dt>
          <dd>{{ order.total | money }}</dd>
        </div>
      </dl>

      @for (payment of order.payments; track $index) {
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
      @if (!onOrdersPage) {
        <!-- Leaving for the page drops the query parameter, which also closes this dialog. -->
        <a hlmBtn variant="outline" size="icon" routerLink="/orders" [queryParams]="orderQuery()" class="sm:mr-auto" aria-label="Open Sales Orders" title="Open Sales Orders">
          <ng-icon name="lucideExternalLink" size="18" />
        </a>
      }
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
    </hlm-dialog-footer>
  `,
})
export class SalesOrderForm {
  protected readonly order = injectBrnDialogContext<SalesOrderFormContext>().order;
  /** Offer the link to the Sales Orders page only when the dialog is over some other page. */
  protected readonly onOrdersPage = inject(Router).url.split(/[?#]/)[0] === '/orders';
  /** The Sales Orders page, on the page of the table that holds this order, with its row highlighted. */
  protected orderQuery(): Record<string, string> {
    return { [HIGHLIGHT_PARAM]: this.order.id };
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
    return this.order.status === 'completed' ? 'success' : this.order.status === 'open' ? 'outline' : 'destructive';
  }

  protected quantity(line: SalesOrderDetail['lines'][number]): string {
    return `${formatQuantity(Math.abs(line.quantityMilli))}${isWeighed(line.unit ?? 'each') ? ` ${line.unit}` : ''}`;
  }
}
