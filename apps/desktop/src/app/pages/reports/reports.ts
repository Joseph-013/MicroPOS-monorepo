import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { dayOf, type DailyReport, formatQuantity } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { BannerService } from '../../core/banner';
import { ReportsService } from '../../core/data/reports.service';
import { MoneyPipe } from '../../core/money.pipe';

const METHOD_NAMES: Record<string, string> = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' };

/**
 * Reports: the daily sales report (DSR) for a day: what was sold, taken by each payment method, credit given and paid
 * back, the cash movements, what each drawer count was expected to be, and the items sold. It can be printed.
 */
@Component({
  imports: [DatePipe, MoneyPipe, HlmButtonImports, HlmCardImports, HlmInputImports],
  template: `
    <div class="mx-auto grid w-full max-w-3xl gap-3">
      <section hlmCard class="gap-0">
        <header class="flex min-h-(--control-height) flex-wrap items-center justify-between gap-3 px-4 pb-3">
          <h1 class="text-2xl">Reports</h1>
          <div class="flex items-center gap-2">
            <label class="text-sm" for="rp-day">Day</label>
            <input hlmInput id="rp-day" type="date" class="w-44" [value]="day()" [attr.max]="today" (change)="setDay($any($event.target).value)" />
            <button hlmBtn variant="outline" type="button" class="px-4" [disabled]="!report() || printing()" (click)="print()">Print</button>
          </div>
        </header>
      </section>

      @if (report(); as r) {
        <section hlmCard class="gap-0">
          <header class="px-4 pb-3"><h2 class="text-xl">Sales</h2></header>
          <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 border-t px-4 py-3 text-sm">
            <dt class="text-muted-foreground">{{ r.sales.count }} {{ r.sales.count === 1 ? 'sale' : 'sales' }}</dt>
            <dd class="text-right">{{ r.sales.gross | money }}</dd>
            @if (r.sales.discounts) {
              <dt class="text-muted-foreground">Discounts</dt>
              <dd class="text-right">-{{ r.sales.discounts | money }}</dd>
            }
            @if (r.refunds.count) {
              <dt class="text-muted-foreground">{{ r.refunds.count }} {{ r.refunds.count === 1 ? 'refund' : 'refunds' }}</dt>
              <dd class="text-destructive text-right">{{ r.refunds.total | money }}</dd>
            }
            <dt class="font-medium">Net sales</dt>
            <dd class="font-heading text-right text-2xl" data-net>{{ r.netAfterRefunds | money }}</dd>
            @if (r.voids.count) {
              <dt class="text-muted-foreground">{{ r.voids.count }} voided</dt>
              <dd class="text-muted-foreground text-right">{{ r.voids.total | money }}</dd>
            }
          </dl>
        </section>

        <section hlmCard class="gap-0">
          <header class="px-4 pb-3"><h2 class="text-xl">Taken by</h2></header>
          <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 border-t px-4 py-3 text-sm">
            @for (m of r.byMethod; track m.method) {
              <dt class="text-muted-foreground">{{ methodName(m.method) }}</dt>
              <dd class="text-right">{{ m.amount | money }}</dd>
            } @empty {
              <dt class="text-muted-foreground">Nothing taken</dt>
              <dd></dd>
            }
          </dl>
        </section>

        @if (r.credit.given || r.credit.interest || r.credit.paymentsReceived.length) {
          <section hlmCard class="gap-0">
            <header class="px-4 pb-3"><h2 class="text-xl">Customer credit</h2></header>
            <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 border-t px-4 py-3 text-sm">
              @if (r.credit.given) {
                <dt class="text-muted-foreground">Put on account</dt>
                <dd class="text-right">{{ r.credit.given | money }}</dd>
              }
              @if (r.credit.interest) {
                <dt class="text-muted-foreground">Interest charged</dt>
                <dd class="text-right">{{ r.credit.interest | money }}</dd>
              }
              @for (m of r.credit.paymentsReceived; track m.method) {
                <dt class="text-muted-foreground">Paid back: {{ methodName(m.method) }}</dt>
                <dd class="text-right">{{ m.amount | money }}</dd>
              }
            </dl>
          </section>
        }

        <section hlmCard class="gap-0">
          <header class="px-4 pb-3"><h2 class="text-xl">Cash</h2></header>
          <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 border-t px-4 py-3 text-sm">
            <dt class="text-muted-foreground">Sales</dt>
            <dd class="text-right">{{ r.cash.sales | money }}</dd>
            @if (r.cash.customerPayments) {
              <dt class="text-muted-foreground">Customer payments</dt>
              <dd class="text-right">{{ r.cash.customerPayments | money }}</dd>
            }
            @if (r.cash.supplierPayments) {
              <dt class="text-muted-foreground">Paid to suppliers</dt>
              <dd class="text-right">-{{ r.cash.supplierPayments | money }}</dd>
            }
            @if (r.cash.movementsIn) {
              <dt class="text-muted-foreground">Cash in</dt>
              <dd class="text-right">{{ r.cash.movementsIn | money }}</dd>
            }
            @if (r.cash.movementsOut) {
              <dt class="text-muted-foreground">Cash out</dt>
              <dd class="text-right">-{{ r.cash.movementsOut | money }}</dd>
            }
          </dl>
          @if (r.sessions.length) {
            <ul class="divide-border flex flex-col divide-y border-t" aria-label="Drawer counts">
              @for (s of r.sessions; track s.id) {
                <li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-2 text-sm">
                  <div class="min-w-0">
                    <p class="truncate">{{ s.openedAt | date: 'h:mm a' }}{{ s.closedAt ? ' to ' + (s.closedAt | date: 'h:mm a') : ' (still open)' }}{{ s.closedBy ? ' · ' + s.closedBy : '' }}</p>
                    <p class="text-muted-foreground text-xs">
                      Float {{ s.openingFloat | money }}@if (s.closedAt) { · expected {{ s.expectedCash! | money }} · counted {{ s.countedCash! | money }} }@if (s.note) { · {{ s.note }} }
                    </p>
                  </div>
                  @if (s.variance !== null) {
                    <p class="text-right" [class.text-destructive]="s.variance !== 0" data-variance>{{ s.variance === 0 ? 'Matches' : (s.variance < 0 ? 'Short ' : 'Over ') + (abs(s.variance) | money) }}</p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <section hlmCard class="gap-0">
          <header class="px-4 pb-3"><h2 class="text-xl">Items sold</h2></header>
          <ul class="divide-border flex flex-col divide-y border-t" aria-label="Items sold">
            @for (item of r.items; track item.name + item.unit) {
              <li class="grid grid-cols-[minmax(0,1fr)_auto_6rem] items-baseline gap-x-4 px-4 py-2 text-sm">
                <p class="min-w-0 truncate">{{ item.name }}</p>
                <p class="text-muted-foreground text-right">{{ quantity(item) }}</p>
                <p class="text-right">{{ item.total | money }}</p>
              </li>
            } @empty {
              <li class="text-muted-foreground px-4 py-6 text-center text-sm">Nothing sold</li>
            }
          </ul>
        </section>
      } @else {
        <p class="text-muted-foreground py-8 text-center text-sm">{{ loading() ? 'Loading report' : 'The report could not be loaded' }}</p>
      }
    </div>
  `,
})
export class ReportsPage {
  private readonly reports = inject(ReportsService);
  private readonly banner = inject(BannerService);

  protected readonly today = dayOf(Date.now());
  protected readonly day = signal(this.today);
  protected readonly report = signal<DailyReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly printing = signal(false);
  protected readonly abs = Math.abs;
  protected readonly methodName = (method: string): string => METHOD_NAMES[method] ?? method;
  protected quantity(item: { quantityMilli: number; unit: string | null }): string {
    return `${formatQuantity(item.quantityMilli)}${item.unit && item.unit !== 'each' ? ' ' + item.unit : ''}`;
  }

  constructor() {
    void this.load();
  }

  protected setDay(day: string): void {
    if (!day) return; // the field was cleared: keep the day shown
    this.day.set(day);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const day = this.day();
    const report = await this.reports.daily(day);
    if (day === this.day()) {
      this.report.set(report);
      this.loading.set(false);
    }
  }

  protected async print(): Promise<void> {
    this.printing.set(true);
    try {
      const result = await this.reports.print(this.day());
      if (result.ok) this.banner.success(result.savedTo ? 'Report saved as an image' : 'Report sent to the printer', { key: 'print-report' });
      else this.banner.error(result.error, { key: 'print-report', duration: 'long' });
    } finally {
      this.printing.set(false);
    }
  }
}
