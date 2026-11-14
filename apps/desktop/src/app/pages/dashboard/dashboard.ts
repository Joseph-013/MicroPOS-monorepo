import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type BatchRecord, expiryState, formatQuantity, methodName } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '../../core/money.pipe';
import { DashboardService } from '../../core/data/dashboard.service';
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
  supplier_return: 'Returned to supplier',
};
const compact = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY, notation: 'compact', maximumFractionDigits: 1 });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Dashboard: sales today against yesterday, the last 7 and 30 days, a chart of the last 14 days, what is taken by each
 * payment method, best sellers, what customers and suppliers are owed, and the stock overview (value, expiry, out of
 * stock, waste, recent movements). The alert tiles open the matching filtered lists. Figures come from the same
 * queries as Reports, so the two agree.
 */
@Component({
  imports: [DatePipe, RouterLink, MoneyPipe, HlmBadgeImports, HlmButtonImports, HlmCardImports],
  templateUrl: './dashboard.html',
})
export class DashboardPage {
  protected readonly service = inject(DashboardService);
  protected readonly data = this.service.data;
  protected readonly formatQuantity = formatQuantity;
  protected readonly methodName = methodName;

  /** The tallest day on the chart, so the bars share one scale (never 0). */
  protected readonly chartMax = computed(() => Math.max(1, ...(this.data()?.daily.map((d) => d.net) ?? [])));
  /** The biggest payment method, so the share bars share one scale. */
  protected readonly methodMax = computed(() => Math.max(1, ...(this.data()?.byMethod.map((m) => m.amount) ?? [])));

  constructor() {
    void this.service.load();
  }

  protected barHeight(net: number): number {
    return Math.max(net > 0 ? 3 : 0, Math.round((Math.max(net, 0) / this.chartMax()) * 100));
  }
  /** A short amount for above a bar ("₱1.2K"), so the chart can be read without hovering. */
  protected compactMoney(cents: number): string {
    return compact.format(cents / 100);
  }
  protected weekday(day: string): string {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return WEEKDAYS[new Date(y, m - 1, d).getDay()]!;
  }
  /** "+12%" / "-5%" against yesterday, or null when yesterday had no sales to compare with. */
  protected change(now: number, before: number): string | null {
    if (before <= 0) return null;
    const pct = Math.round(((now - before) / before) * 100);
    return `${pct > 0 ? '+' : ''}${pct}%`;
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
  protected quantity(item: { quantityMilli: number; unit: string | null }): string {
    return `${formatQuantity(item.quantityMilli)}${item.unit && item.unit !== 'each' ? ' ' + item.unit : ''}`;
  }
}
