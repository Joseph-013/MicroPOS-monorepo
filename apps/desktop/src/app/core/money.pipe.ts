import { Pipe, PipeTransform } from '@angular/core';

/** Store currency and number format. One place to change until currency becomes a setting. */
export const DEFAULT_CURRENCY = 'PHP';
export const DEFAULT_LOCALE = 'en-PH';

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats integer cents (centavos) as currency: 123450 -> "₱1,234.50". */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: number, currency = DEFAULT_CURRENCY): string {
    let formatter = formatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency });
      formatters.set(currency, formatter);
    }
    return formatter.format(cents / 100);
  }
}
