import { Directive, input } from '@angular/core';
import type { ColumnCell } from './table-columns';

/**
 * Put on every cell of a table column (the title, the filter and each body cell): `[appCol]="layout.col('name')"`. It gives
 * the cell its place in the admin's column order (CSS `order`), and what a phone's card layout needs (see `.table-cards`
 * in styles.css): `data-label` (shown in front of the value) and `data-primary` on the first column, which becomes the
 * card's title.
 */
@Directive({
  selector: '[appCol]',
  host: { '[style.order]': 'appCol().order', '[attr.data-label]': 'appCol().label || null', '[attr.data-primary]': 'appCol().primary ? "" : null' },
})
export class AppCol {
  readonly appCol = input.required<ColumnCell>();
}
