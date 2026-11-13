import { Component, computed, inject, signal } from '@angular/core';
import type { PurchaseConcern } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { NavBadges } from '../../core/nav-badges';
import { MoneyPipe } from '../../core/money.pipe';
import { PurchaseViewer } from '../../core/purchase-viewer';
import { FilterInput } from '../../core/ui/filter-input';

const ALL = 'all';
const REASONS = { [ALL]: 'All reasons', late: 'Late delivery', overdue: 'Overdue payment' } as const;
type ReasonFilter = keyof typeof REASONS;
const DAY_MS = 86_400_000;
const days = (since: number): string => {
  const n = Math.max(1, Math.floor((Date.now() - since) / DAY_MS));
  return `${n} ${n === 1 ? 'day' : 'days'}`;
};

/** Purchase orders that are late to arrive or overdue for payment (the Purchases badge). A row opens the order. */
@Component({
  host: { class: 'contents' },
  imports: [FilterInput, MoneyPipe, HlmButtonImports, HlmDialogImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Purchase concerns</h3>
    </hlm-dialog-header>

    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <app-filter-input [(value)]="textFilter" placeholder="Order or supplier" label="Filter order or supplier" />
      <hlm-select [(value)]="reasonFilter" [itemToString]="reasonLabel" class="block">
        <hlm-select-trigger class="w-44" aria-label="Filter reason">
          <hlm-select-value />
        </hlm-select-trigger>
        <hlm-select-content *hlmSelectPortal>
          @for (r of reasons; track r) {
            <hlm-select-item [value]="r">{{ reasonLabel(r) }}</hlm-select-item>
          }
        </hlm-select-content>
      </hlm-select>
    </div>

    <ul class="divide-border -mx-2 flex min-h-0 flex-col divide-y overflow-y-auto border-y px-2" aria-label="Purchase concerns">
      @for (concern of shown(); track concern.purchase.id) {
        <li>
          <button type="button" class="hover:bg-muted/40 grid min-h-(--control-height) w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-2 py-2 text-left" (click)="open(concern.purchase.id)">
            <span class="min-w-0">
              <span class="block truncate text-base">{{ concern.purchase.number }} <span class="text-muted-foreground text-sm">{{ concern.purchase.supplierName }}</span></span>
              <span class="text-destructive block truncate text-xs">{{ reason(concern) }}</span>
            </span>
            <span class="text-right">{{ concern.purchase.owed | money }}</span>
          </button>
        </li>
      } @empty {
        <li class="text-muted-foreground py-6 text-center text-sm">{{ all().length ? 'No concerns match' : 'Nothing needs attention' }}</li>
      }
    </ul>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
    </hlm-dialog-footer>
  `,
})
export class PurchaseConcerns {
  private readonly viewer = inject(PurchaseViewer);

  /** Live: follows every refresh of the badge's list. */
  protected readonly all = inject(NavBadges).purchaseConcerns;
  protected readonly textFilter = signal('');
  protected readonly reasons = Object.keys(REASONS) as ReasonFilter[];
  protected readonly reasonFilter = signal<ReasonFilter>(ALL);
  protected readonly reasonLabel = (r: ReasonFilter): string => REASONS[r];

  protected readonly shown = computed(() => {
    const text = this.textFilter().trim().toLowerCase();
    const reason = this.reasonFilter();
    return this.all().filter(
      (c) =>
        (c.purchase.number.toLowerCase().includes(text) || c.purchase.supplierName.toLowerCase().includes(text)) &&
        (reason === ALL || (reason === 'late' ? c.lateSince !== null : c.overdueOwed !== null)),
    );
  });

  /** "Late 3 days · Payment overdue 10 days". */
  protected reason(c: PurchaseConcern): string {
    return [c.lateSince !== null ? `Delivery ${days(c.lateSince)} late` : '', c.overdueOwed !== null && c.purchase.dueAt !== null ? `Payment ${days(c.purchase.dueAt)} overdue` : ''].filter(Boolean).join(' · ');
  }

  protected open(id: string): void {
    void this.viewer.open(id);
  }
}
