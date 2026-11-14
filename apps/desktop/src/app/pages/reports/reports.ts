import { Component, computed, inject, signal } from '@angular/core';
import { buildReportDocument, dayOf, type ExportFormat, REPORT_KINDS, REPORT_LABELS, type ReportKind, type SalesReport } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { BannerService } from '../../core/banner';
import { ReportsService } from '../../core/data/reports.service';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '../../core/money.pipe';

const pesos = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY });

/**
 * Reports: pick a report and a day or range of days, read it here, and save it as CSV or PDF or print it with the
 * system's print dialog. The page, the CSV and the PDF are all made from the same `ReportDocument`, so they agree.
 * Admins compare the figures with their own counts by hand.
 */
@Component({
  imports: [HlmButtonImports, HlmCardImports, HlmInputImports, HlmSelectImports],
  template: `
    <div class="mx-auto grid w-full max-w-3xl gap-3">
      <section hlmCard class="gap-0">
        <header class="flex min-h-(--control-height) flex-wrap items-center justify-between gap-3 px-4 pb-3">
          <h1 class="text-2xl">Reports</h1>
          <div class="flex flex-wrap items-center gap-2">
            <span id="rp-kind-label" class="sr-only">Report</span>
            <hlm-select [value]="kind()" (valueChange)="setKind($event)" [itemToString]="kindLabel">
              <hlm-select-trigger class="w-52" aria-labelledby="rp-kind-label" id="rp-kind">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (k of kinds; track k) {
                  <hlm-select-item [value]="k">{{ kindLabel(k) }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>
        </header>
        <div class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <div class="flex flex-wrap items-center gap-2">
            <label class="text-sm" for="rp-from">From</label>
            <input hlmInput id="rp-from" type="date" class="w-44" [value]="from()" [attr.max]="today" (change)="setFrom($any($event.target).value)" />
            <label class="text-sm" for="rp-to">To</label>
            <input hlmInput id="rp-to" type="date" class="w-44" [value]="to()" [attr.max]="today" (change)="setTo($any($event.target).value)" />
          </div>
          <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Export">
            <button hlmBtn variant="outline" type="button" class="px-4" [disabled]="!report() || exporting()" (click)="exportAs('csv')">CSV</button>
            <button hlmBtn variant="outline" type="button" class="px-4" [disabled]="!report() || exporting()" (click)="exportAs('pdf')">PDF</button>
            <button hlmBtn variant="outline" type="button" class="px-4" [disabled]="!report() || exporting()" (click)="exportAs('print')">Print</button>
          </div>
        </div>
      </section>

      @if (document(); as doc) {
        <p class="text-muted-foreground px-1 text-sm" data-period>{{ doc.period }}</p>
        @for (section of doc.sections; track section.heading) {
          <section hlmCard class="gap-0">
            <header class="px-4 pb-3"><h2 class="text-xl">{{ section.heading }}</h2></header>
            <div class="overflow-x-auto border-t">
              <table class="w-full text-sm">
                @if (section.head) {
                  <thead>
                    <tr class="text-muted-foreground">
                      @for (h of section.head; track $index) {
                        <th class="px-4 py-2 font-normal" [class.text-right]="section.right[$index]" [class.text-left]="!section.right[$index]">{{ h }}</th>
                      }
                    </tr>
                  </thead>
                }
                <tbody class="divide-border divide-y">
                  @for (row of section.rows; track $index) {
                    <tr [class.font-medium]="section.strong?.includes($index)">
                      @for (cell of row; track $index) {
                        <td class="px-4 py-2 align-top" [class.text-right]="section.right[$index]" [class.whitespace-nowrap]="section.right[$index]" [class.max-w-0]="!section.right[$index]" [class.truncate]="!section.right[$index]">{{ cell }}</td>
                      }
                    </tr>
                  } @empty {
                    <tr><td class="text-muted-foreground px-4 py-6 text-center" colspan="3">Nothing to show</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      } @else {
        <p class="text-muted-foreground py-8 text-center text-sm">{{ loading() ? 'Loading report' : 'The report could not be loaded' }}</p>
      }
    </div>
  `,
})
export class ReportsPage {
  private readonly reports = inject(ReportsService);
  private readonly banner = inject(BannerService);

  protected readonly kinds = REPORT_KINDS;
  protected readonly kindLabel = (k: ReportKind): string => REPORT_LABELS[k];
  protected readonly today = dayOf(Date.now());
  protected readonly kind = signal<ReportKind>('summary');
  protected readonly from = signal(this.today);
  protected readonly to = signal(this.today);
  protected readonly report = signal<SalesReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly document = computed(() => {
    const r = this.report();
    return r ? buildReportDocument(this.kind(), r, (c) => pesos.format(c / 100)) : null;
  });

  constructor() {
    void this.load();
  }

  protected setKind(kind: ReportKind | null | undefined): void {
    if (kind) this.kind.set(kind);
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

  protected async exportAs(format: ExportFormat): Promise<void> {
    this.exporting.set(true);
    try {
      const result = await this.reports.export(this.kind(), this.from(), this.to(), format);
      if (result.ok) this.banner.success(result.savedTo ? `Saved ${result.savedTo}` : 'Sent to the printer', { key: 'export-report' });
      else if (!result.canceled) this.banner.error(result.error, { key: 'export-report', duration: 'long' });
    } finally {
      this.exporting.set(false);
    }
  }
}
