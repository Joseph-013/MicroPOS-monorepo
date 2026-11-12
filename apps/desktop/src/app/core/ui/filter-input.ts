import { Component, input, model } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmButtonGroupImports } from '@spartan-ng/helm/button-group';
import { HlmInputImports } from '@spartan-ng/helm/input';

/**
 * A table-filter field: an input joined to an x button (a button group) that empties the field; the button is
 * disabled while the field is empty. Two-way bind the text: `<app-filter-input [(value)]="name" placeholder="Name" label="Filter name" />`.
 */
@Component({
  selector: 'app-filter-input',
  imports: [NgIcon, HlmButtonImports, HlmButtonGroupImports, HlmInputImports],
  providers: [provideIcons({ lucideX })],
  // A block element, so a min-w-* class on the tag really sets the minimum width.
  host: { class: 'block' },
  template: `
    <div hlmButtonGroup class="w-full">
      <input
        hlmInput
        class="min-w-0 text-xs"
        [type]="type()"
        [attr.placeholder]="placeholder() || null"
        [attr.aria-label]="label()"
        [attr.min]="min() || null"
        [attr.max]="max() || null"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
      />
      <button
        hlmBtn
        variant="outline"
        size="icon"
        type="button"
        [attr.aria-label]="'Clear ' + label().toLowerCase()"
        [disabled]="!value()"
        (click)="value.set('')"
      >
        <ng-icon name="lucideX" size="16" />
      </button>
    </div>
  `,
})
export class FilterInput {
  readonly value = model('');
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly type = input<'text' | 'date'>('text');
  /** For date fields: earliest and latest allowed `yyyy-mm-dd`. */
  readonly min = input('');
  readonly max = input('');
}
