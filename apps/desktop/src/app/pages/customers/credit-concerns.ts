import { Component, computed, inject } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { CustomerViewer } from '../../core/customer-viewer';
import { CustomersService } from '../../core/data/customers.service';
import { MoneyPipe } from '../../core/money.pipe';
import { alertText } from './alert-text';

/** The customers whose credit needs attention (the same ones the Customers badge counts), worst first; a row opens the account. */
@Component({
  host: { class: 'contents' },
  imports: [MoneyPipe, HlmButtonImports, HlmDialogImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Credit concerns</h3>
    </hlm-dialog-header>

    <ul class="divide-border -mx-2 flex min-h-0 flex-col divide-y overflow-y-auto border-y px-2" aria-label="Credit concerns">
      @for (customer of concerns(); track customer.id) {
        <li>
          <button type="button" class="hover:bg-muted/40 grid min-h-(--control-height) w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-2 py-2 text-left" (click)="open(customer.id)">
            <span class="min-w-0">
              <span class="block truncate text-base">{{ customer.name }}</span>
              <span class="text-destructive block truncate text-xs">{{ reason(customer.alert) }}</span>
            </span>
            <span class="text-destructive text-right">{{ customer.balance | money }}</span>
          </button>
        </li>
      } @empty {
        <li class="text-muted-foreground py-6 text-center text-sm">Nothing needs attention</li>
      }
    </ul>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-6">Close</button>
    </hlm-dialog-footer>
  `,
})
export class CreditConcerns {
  private readonly customers = inject(CustomersService);
  private readonly viewer = inject(CustomerViewer);
  protected readonly reason = alertText;

  /** Largest balance first. */
  protected readonly concerns = computed(() => this.customers.customers().filter((c) => c.alert).sort((a, b) => b.balance - a.balance));

  protected open(id: string): void {
    void this.viewer.open(id);
  }
}
