import { Component, input } from '@angular/core';

export interface ConfirmItem {
  label: string;
  /** Secondary text on the right (a SKU, a count). */
  detail?: string;
}

/** The list of what a confirmation dialog is about to act on (one row, or every row of a bulk action). */
@Component({
  selector: 'app-confirm-items',
  template: `
    <ul class="divide-border max-h-48 divide-y overflow-y-auto border text-sm" aria-label="Affected items">
      @for (item of items(); track $index) {
        <li class="flex items-baseline justify-between gap-3 px-3 py-1.5">
          <span class="truncate">{{ item.label }}</span>
          @if (item.detail) {
            <span class="text-muted-foreground shrink-0 text-xs">{{ item.detail }}</span>
          }
        </li>
      }
    </ul>
  `,
})
export class ConfirmItems {
  readonly items = input.required<ConfirmItem[]>();
}
