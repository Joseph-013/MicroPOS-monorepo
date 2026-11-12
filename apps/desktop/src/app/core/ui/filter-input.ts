import { Component, input, model } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleX } from '@ng-icons/lucide';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';

/**
 * A table-filter field: an input with a circled-x button at its right that appears once there is a value and
 * empties the field. Two-way bind the text: `<app-filter-input [(value)]="name" placeholder="Name" label="Filter name" />`.
 */
@Component({
  selector: 'app-filter-input',
  imports: [NgIcon, HlmInputGroupImports],
  providers: [provideIcons({ lucideCircleX })],
  // A block element, so a min-w-* class on the tag really sets the minimum width.
  host: { class: 'block' },
  template: `
    <div hlmInputGroup>
      <input
        hlmInputGroupInput
        class="text-xs"
        [type]="type()"
        [attr.placeholder]="placeholder() || null"
        [attr.aria-label]="label()"
        [attr.min]="min() || null"
        [attr.max]="max() || null"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
      />
      @if (value()) {
        <hlm-input-group-addon align="inline-end">
          <button hlmInputGroupButton size="icon-xs" type="button" [attr.aria-label]="'Clear ' + label().toLowerCase()" (click)="value.set('')">
            <ng-icon name="lucideCircleX" />
          </button>
        </hlm-input-group-addon>
      }
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
