import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type BatchRecord, type ChartBar, DASHBOARD_PERIOD_LABELS, DASHBOARD_PERIODS, type DashboardPeriod, dayOf, expiryState, formatQuantity, methodName, type PeriodTotals } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Dashboard: sales today against yesterday, the last 7 and 30 days, a chart of the last 14 days, what is taken by each
 * payment method, best sellers, what customers and suppliers are owed, and the stock overview (value, expiry, out of
 * stock, waste, recent movements). The alert tiles open the matching filtered lists. Figures come from the same
 * queries as Reports, so the two agree.
 */
@Component({
  imports: [DatePipe, RouterLink, MoneyPipe, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmInputImports, HlmSelectImports, HlmSwitchImports],
  templateUrl: './dashboard.html',
})
export class DashboardPage {
  protected readonly service = inject(DashboardService);
  protected readonly data = this.service.data;
  protected readonly formatQuantity = formatQuantity;
  protected readonly methodName = methodName;

  /** The tallest day on the chart, so the bars share one scale (never 0). */
  protected readonly chartMax = computed(() => Math.max(1, ...(this.data()?.chart.map((b) => b.net) ?? [])));
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
  protected readonly periods = DASHBOARD_PERIODS;
  protected readonly periodLabel = (p: DashboardPeriod): string => DASHBOARD_PERIOD_LABELS[p];
  protected readonly today = dayOf(Date.now());

  protected choosePeriod(period: DashboardPeriod | null | undefined): void {
    if (period) void this.service.choose({ period });
  }

  /** "Last 7 days" or "Nov 1 to Nov 14, 2026": what the sales figures cover. */
  protected periodText(): string {
    const q = this.data()?.query;
    if (!q) return '';
    return this.service.period() === 'custom' || this.service.period() === 'month' || this.service.period() === 'lastMonth' ? this.rangeText(q.from, q.to) : DASHBOARD_PERIOD_LABELS[this.service.period()];
  }
  private rangeText(from: string, to: string): string {
    const text = (day: string): string => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}, ${day.slice(0, 4)}`;
    return from === to ? text(from) : `${text(from)} to ${text(to)}`;
  }
  /** "than Nov 1 to Nov 7" after a change: what it is compared with. */
  protected compareText(previous: { from: string; to: string } | null): string {
    return previous ? `on ${this.rangeText(previous.from, previous.to)}` : '';
  }
  protected average(totals: PeriodTotals): number {
    return totals.count ? Math.round(totals.net / totals.count) : 0;
  }

  /** The bar's label under the chart: the weekday (a few bars), the day of the month, the start of a week, or the month. */
  protected barLabel(bar: ChartBar): string {
    const g = this.data()!.granularity;
    const [y, m, d] = bar.from.split('-').map(Number) as [number, number, number];
    if (g === 'month') return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
    if (g === 'week') return `${MONTHS[m - 1]} ${d}`;
    return this.data()!.chart.length <= 14 ? WEEKDAYS[new Date(y, m - 1, d).getDay()]! : String(d);
  }
  protected barTitle(bar: ChartBar): string {
    return bar.from === bar.to ? bar.from : `${bar.from} to ${bar.to}`;
  }
  /** Sales Orders filtered to the bar's days. */
  protected barLink(bar: ChartBar): Record<string, string> {
    return bar.from === bar.to ? { date: bar.from } : { from: bar.from, to: bar.to };
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
