import { Pipe, PipeTransform } from '@angular/core';

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats integer cents as currency: 1234 -> "$12.34". */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: number, currency = 'USD'): string {
    let formatter = formatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
      formatters.set(currency, formatter);
    }
    return formatter.format(cents / 100);
  }
}
