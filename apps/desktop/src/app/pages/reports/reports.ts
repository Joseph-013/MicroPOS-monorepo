import { Component, inject, signal } from '@angular/core';
import { dayOf, formatQuantity, type SalesReport } from '@micropos/core';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { ReportsService } from '../../core/data/reports.service';
import { MoneyPipe } from '../../core/money.pipe';

const METHOD_NAMES: Record<string, string> = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' };

/**
 * Reports: a summary of sales for a day or a range of days: what was sold, refunds and voids, what was taken by each
 * payment method, credit given and paid back, and the items sold. Admins compare it with their own counts by hand.
 */
@Component({
  imports: [MoneyPipe, HlmCardImports, HlmInputImports],
  template: `
    <div class="mx-auto grid w-full max-w-3xl gap-3">
      <section hlmCard class="gap-0">
        <header class="flex min-h-(--control-height) flex-wrap items-center justify-between gap-3 px-4 pb-3">
          <h1 class="text-2xl">Reports</h1>
          <div class="flex flex-wrap items-center gap-2">
            <label class="text-sm" for="rp-from">From</label>
            <input hlmInput id="rp-from" type="date" class="w-44" [value]="from()" [attr.max]="today" (change)="setFrom($any($event.target).value)" />
            <label class="text-sm" for="rp-to">To</label>
            <input hlmInput id="rp-to" type="date" class="w-44" [value]="to()" [attr.max]="today" (change)="setTo($any($event.target).value)" />
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

  protected readonly today = dayOf(Date.now());
  protected readonly from = signal(this.today);
  protected readonly to = signal(this.today);
  protected readonly report = signal<SalesReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly methodName = (method: string): string => METHOD_NAMES[method] ?? method;
  protected quantity(item: { quantityMilli: number; unit: string | null }): string {
    return `${formatQuantity(item.quantityMilli)}${item.unit && item.unit !== 'each' ? ' ' + item.unit : ''}`;
  }

  constructor() {
    void this.load();
  }

  protected setFrom(day: string): void {
    if (!day) return; // the field was cleared: keep the day shown
    this.from.set(day);
    if (this.to() < day) this.to.set(day); // the range never ends before it starts
    void this.load();
  }

  protected setTo(day: string): void {
    if (!day) return;
    this.to.set(day);
    if (this.from() > day) this.from.set(day);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const [from, to] = [this.from(), this.to()];
    const report = await this.reports.sales(from, to);
    if (from === this.from() && to === this.to()) {
      this.report.set(report);
      this.loading.set(false);
    }
  }
}
