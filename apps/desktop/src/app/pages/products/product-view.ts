import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { formatQuantity, isWeighed, type ProductRecord } from '@micropos/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { MoneyPipe } from '../../core/money.pipe';
import { DialogPageLink } from '../../core/ui/dialog-page-link';
import { TRACKING_LABELS, UNIT_LABELS } from './product-form';

export interface ProductViewContext {
  product: ProductRecord;
  /** `view` is the only mode: this is a read-only look at a product (editing happens on the Products page). */
  mode?: 'view';
}

/** A product in view mode: what it is, what it costs, how it is sold and how much is left. */
@Component({
  host: { class: 'contents' },
  imports: [DatePipe, MoneyPipe, DialogPageLink, HlmBadgeImports, HlmButtonImports, HlmDialogImports],
  template: `
    <app-dialog-page-link path="/items/products" label="Products" [highlight]="product.id" />
    <hlm-dialog-header class="pe-24">
      <h3 hlmDialogTitle class="flex items-center gap-3">
        <span class="min-w-0 truncate select-text">{{ product.name }}</span>
        <span hlmBadge [variant]="statusVariant()">{{ statusLabel() }}</span>
      </h3>
    </hlm-dialog-header>

    <dl class="-mx-2 grid min-h-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-6 gap-y-2 overflow-y-auto px-2 py-1 text-sm">
      <dt class="text-muted-foreground">Price</dt>
      <dd>{{ product.price | money }}@if (weighed) { / {{ product.unit }} }</dd>
      <dt class="text-muted-foreground">{{ weighed ? 'PLU' : 'Barcode' }}</dt>
      <dd class="select-text">{{ product.barcode ?? '-' }}</dd>
      <dt class="text-muted-foreground">SKU</dt>
      <dd class="select-text">{{ product.sku ?? '-' }}</dd>
      <dt class="text-muted-foreground">Sold by</dt>
      <dd>{{ unitLabels[product.unit] }}</dd>
      @if (product.cost !== null) {
        <dt class="text-muted-foreground">Cost</dt>
        <dd>{{ product.cost | money }}</dd>
      }
      <dt class="text-muted-foreground">Track stock</dt>
      <dd>{{ trackingLabels[product.tracking] }}</dd>
      @if (product.onHandMilli !== null) {
        <dt class="text-muted-foreground">In stock</dt>
        <dd>{{ quantity(product.onHandMilli) }}@if (weighed) { {{ product.unit }} }</dd>
      }
      @if (product.nextExpiry !== null) {
        <dt class="text-muted-foreground">Next expiry</dt>
        <dd>{{ product.nextExpiry | date: 'MMM d, y' }}</dd>
      }
      @if (product.categories.length) {
        <dt class="text-muted-foreground">Categories</dt>
        <dd class="flex flex-wrap gap-1">
          @for (category of product.categories; track category.id) {
            <span hlmBadge variant="tagNeutral">{{ category.name }}</span>
          }
        </dd>
      }
    </dl>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
    </hlm-dialog-footer>
  `,
})
export class ProductView {
  protected readonly product = injectBrnDialogContext<ProductViewContext>().product;
  protected readonly weighed = isWeighed(this.product.unit);
  protected readonly unitLabels = UNIT_LABELS;
  protected readonly trackingLabels = TRACKING_LABELS;
  protected readonly quantity = formatQuantity;

  protected statusLabel(): string {
    return this.product.deletedAt ? 'Deleted' : this.product.active ? 'Active' : 'Inactive';
  }
  protected statusVariant(): 'success' | 'destructive' | 'outline' {
    return this.product.deletedAt ? 'outline' : this.product.active ? 'success' : 'destructive';
  }
}
