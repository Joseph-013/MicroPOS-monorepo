import type { CustomerAlert } from '@micropos/core';
import { MoneyPipe } from '../../core/money.pipe';

const money = new MoneyPipe();

/** Why a customer is flagged: "Over ₱5,000.00 · Unpaid 45 days". */
export function alertText(alert: CustomerAlert | null): string {
  if (!alert) return '';
  return [
    alert.overAmount !== null ? `Over ${money.transform(alert.overAmount)}` : '',
    alert.unpaidDays !== null ? `Unpaid ${alert.unpaidDays} ${alert.unpaidDays === 1 ? 'day' : 'days'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
