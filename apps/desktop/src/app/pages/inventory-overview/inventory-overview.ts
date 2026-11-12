import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type BatchRecord, expiryState, formatQuantity } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { InventoryService } from '../../core/data/inventory.service';
import { MoneyPipe } from '../../core/money.pipe';

const MOVEMENT_LABELS: Record<string, string> = {
  receive: 'Received',
  sale: 'Sold',
  refund: 'Refunded',
  void: 'Voided',
  adjust: 'Adjusted',
  waste: 'Waste',
  expired: 'Expired',
  repack_out: 'Repackaged out',
  repack_in: 'Repackaged in',
};

/** Items > Overview: what is in stock, what is about to expire or already has, and what moved lately. */
@Component({
  imports: [DatePipe, RouterLink, MoneyPipe, HlmBadgeImports, HlmButtonImports, HlmCardImports],
  templateUrl: './inventory-overview.html',
})
export class InventoryOverviewPage {
  protected readonly service = inject(InventoryService);
  protected readonly overview = this.service.overview;
  protected readonly formatQuantity = formatQuantity;
  /** Batches are measured against the moment the numbers were loaded. */
  protected readonly loadedAt = computed(() => (this.overview() ? Date.now() : 0));

  constructor() {
    void this.service.loadOverview();
  }

  protected movementLabel(type: string): string {
    return MOVEMENT_LABELS[type] ?? type;
  }

  protected isExpired(batch: BatchRecord): boolean {
    return expiryState(batch.expiresAt) === 'expired';
  }

  protected unitSuffix(unit: string): string {
    return unit === 'each' ? '' : ` ${unit}`;
  }
}
