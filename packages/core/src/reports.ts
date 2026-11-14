import type { CashFlow, CashSessionRecord } from './cash.js';
import type { OrderPaymentMethod } from './draft.js';
import type { Money } from './index.js';
import { formatQuantity } from './quantity.js';
import { type ReceiptDocument, type ReceiptLine, type ReceiptShop, formatReceiptMoney, wrapText } from './receipt.js';

/** One payment method's total for the day: sales and refunds are in it (refunds subtract). */
export interface MethodTotal {
  method: OrderPaymentMethod;
  amount: Money;
}

/** What was sold, grouped by item name: quantity (thousandths) and money. */
export interface ItemSold {
  name: string;
  unit: string | null;
  quantityMilli: number;
  total: Money;
}

/** The daily sales report (DSR) for one day, midnight to midnight. */
export interface DailyReport {
  /** `YYYY-MM-DD`, in local time. */
  day: string;
  /** Sales rung up that day, not voided: how many, before discounts, discounts, and what was charged. */
  sales: { count: number; gross: Money; discounts: Money; net: Money };
  /** Orders voided that day (whenever they were sold). */
  voids: { count: number; total: Money };
  /** Refund orders made that day: the amount is negative. */
  refunds: { count: number; total: Money };
  /** Net sales less refunds. */
  netAfterRefunds: Money;
  /** Money taken by payment method (refunds and voids taken off). */
  byMethod: MethodTotal[];
  /** Sales left on customers' accounts that day, and what customers paid back, by method. */
  credit: { given: Money; interest: Money; paymentsReceived: MethodTotal[] };
  /** Cash movements of the day, which add up to what the drawer gained or lost (no float). */
  cash: CashFlow;
  items: ItemSold[];
  /** Drawer sessions that were open at some time that day. */
  sessions: CashSessionRecord[];
}


/** `YYYY-MM-DD` of a time in local time. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Start (inclusive) and end (exclusive) in epoch ms of a local day, or null when the text is not a real date. */
export function dayRange(day: string): { from: number; to: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const from = new Date(y, m - 1, d);
  if (from.getFullYear() !== y || from.getMonth() !== m - 1 || from.getDate() !== d) return null;
  // The next midnight, not +24 h: a day with a clock change is 23 or 25 hours long.
  return { from: from.getTime(), to: new Date(y, m - 1, d + 1).getTime() };
}

const METHOD_NAMES: Record<string, string> = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' };

function pair(label: string, value: string, columns: number, bold = false): ReceiptLine {
  const valueWidth = Math.min(value.length, columns - 1);
  return { kind: 'columns', bold, cells: [{ text: label.slice(0, columns - valueWidth - 1), align: 'left', width: columns - valueWidth }, { text: value, align: 'right' }] };
}

const timeText = (ms: number): string => new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

/**
 * The daily report as a document for the receipt printer: the shop, the day, sales, what was taken by method, credit,
 * cash movements and each drawer session's count, then the top items. `itemLimit` keeps a long list from printing for
 * metres of paper; the rest is summed on one line.
 */
export function buildDailyReceipt(report: DailyReport, shop: ReceiptShop, columns: number, itemLimit = 15): ReceiptDocument {
  const lines: ReceiptLine[] = [];
  const text = (t: string, bold = false): void => void lines.push({ kind: 'text', text: t, align: 'left', bold });
  const rule = (): void => void lines.push({ kind: 'rule', style: 'dash' });
  const heading = (t: string): void => {
    rule();
    text(t, true);
  };

  if (shop.name) wrapText(shop.name, columns).forEach((l) => lines.push({ kind: 'text', text: l, align: 'center', bold: true }));
  lines.push({ kind: 'text', text: 'DAILY SALES REPORT', align: 'center', bold: true }, { kind: 'text', text: report.day, align: 'center' });

  heading('Sales');
  lines.push(pair(`${report.sales.count} sales`, formatReceiptMoney(report.sales.gross), columns));
  if (report.sales.discounts) lines.push(pair('Discounts', formatReceiptMoney(-report.sales.discounts), columns));
  lines.push(pair('Net sales', formatReceiptMoney(report.sales.net), columns));
  if (report.refunds.count) lines.push(pair(`${report.refunds.count} refunds`, formatReceiptMoney(report.refunds.total), columns));
  lines.push(pair('NET', `PHP ${formatReceiptMoney(report.netAfterRefunds)}`, columns, true));
  if (report.voids.count) lines.push(pair(`${report.voids.count} voided`, formatReceiptMoney(report.voids.total), columns));

  heading('Taken by');
  for (const m of report.byMethod) lines.push(pair(METHOD_NAMES[m.method] ?? m.method, formatReceiptMoney(m.amount), columns));

  if (report.credit.given || report.credit.paymentsReceived.length || report.credit.interest) {
    heading('Customer credit');
    if (report.credit.given) lines.push(pair('Put on account', formatReceiptMoney(report.credit.given), columns));
    if (report.credit.interest) lines.push(pair('Interest charged', formatReceiptMoney(report.credit.interest), columns));
    for (const m of report.credit.paymentsReceived) lines.push(pair(`Paid back: ${METHOD_NAMES[m.method] ?? m.method}`, formatReceiptMoney(m.amount), columns));
  }

  const cash = report.cash;
  heading('Cash');
  lines.push(pair('Sales', formatReceiptMoney(cash.sales), columns));
  if (cash.customerPayments) lines.push(pair('Customer payments', formatReceiptMoney(cash.customerPayments), columns));
  if (cash.supplierPayments) lines.push(pair('Paid to suppliers', formatReceiptMoney(-cash.supplierPayments), columns));
  if (cash.movementsIn) lines.push(pair('Paid in', formatReceiptMoney(cash.movementsIn), columns));
  if (cash.movementsOut) lines.push(pair('Paid out', formatReceiptMoney(-cash.movementsOut), columns));

  for (const s of report.sessions) {
    heading(`Drawer ${timeText(s.openedAt)}${s.closedAt ? ` - ${timeText(s.closedAt)}` : ' (open)'}`);
    lines.push(pair('Opening float', formatReceiptMoney(s.openingFloat), columns));
    if (s.closedAt !== null && s.countedCash !== null && s.expectedCash !== null && s.variance !== null) {
      lines.push(pair('Expected', formatReceiptMoney(s.expectedCash), columns), pair('Counted', formatReceiptMoney(s.countedCash), columns));
      lines.push(pair(s.variance === 0 ? 'Matches' : s.variance < 0 ? 'SHORT' : 'OVER', formatReceiptMoney(Math.abs(s.variance)), columns, true));
    }
  }

  if (report.items.length) {
    heading('Items sold');
    for (const item of report.items.slice(0, itemLimit)) {
      wrapText(item.name, columns).forEach((l) => text(l));
      const quantity = `${formatQuantity(item.quantityMilli)}${item.unit && item.unit !== 'each' ? ` ${item.unit}` : ''}`;
      lines.push(pair(`  ${quantity}`, formatReceiptMoney(item.total), columns));
    }
    const rest = report.items.slice(itemLimit);
    if (rest.length) lines.push(pair(`${rest.length} more items`, formatReceiptMoney(rest.reduce((sum, i) => sum + i.total, 0)), columns));
  }
  lines.push({ kind: 'feed', lines: 3 });
  return { columns, lines };
}
