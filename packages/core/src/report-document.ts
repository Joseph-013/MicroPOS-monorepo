import type { Money } from './index.js';
import { formatQuantity } from './quantity.js';
import type { SalesReport } from './reports.js';

/** The reports an admin can choose between. */
export const REPORT_KINDS = ['summary', 'payments', 'credit', 'items'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABELS: Record<ReportKind, string> = { summary: 'Sales summary', payments: 'Payments by method', credit: 'Customer credit', items: 'Items sold' };
export const isReportKind = (value: unknown): value is ReportKind => (REPORT_KINDS as readonly unknown[]).includes(value);

export const EXPORT_FORMATS = ['csv', 'pdf', 'print'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportFormat = (value: unknown): value is ExportFormat => (EXPORT_FORMATS as readonly unknown[]).includes(value);

/** `savedTo` is set when a file was written; `canceled` when the person closed the save or print dialog. */
export type ExportResult = { ok: true; savedTo?: string } | { ok: false; canceled?: true; error: string };

/** A report as plain tables of text, so the page, the CSV file and the PDF or printout all show the same thing. */
export interface ReportSection {
  heading: string;
  /** Column titles, or null for a list of label and amount rows. */
  head: string[] | null;
  /** Which columns are right aligned (numbers). */
  right: boolean[];
  rows: string[][];
  /** Rows to show in bold, such as a total. */
  strong?: number[];
}
export interface ReportDocument {
  title: string;
  /** "15 Jun 2026" or "1 Jun 2026 to 15 Jun 2026". */
  period: string;
  sections: ReportSection[];
}

const METHOD_NAMES: Record<string, string> = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' };
export const methodName = (method: string): string => METHOD_NAMES[method] ?? method;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (day: string): string => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const pair = (label: string, amount: string): string[] => [label, amount];

/** `money` formats cents: the page and the PDF use the currency, the CSV a plain number a spreadsheet can add up. */
export function buildReportDocument(kind: ReportKind, r: SalesReport, money: (cents: Money) => string): ReportDocument {
  const sales = (): ReportSection => {
    const rows = [pair(plural(r.sales.count, 'sale', 'sales'), money(r.sales.gross))];
    if (r.sales.discounts) rows.push(pair('Discounts', money(-r.sales.discounts)));
    if (r.refunds.count) rows.push(pair(plural(r.refunds.count, 'refund', 'refunds'), money(r.refunds.total)));
    rows.push(pair('Net sales', money(r.netAfterRefunds)));
    const strong = [rows.length - 1];
    if (r.voids.count) rows.push(pair(`${r.voids.count} voided (not in net sales)`, money(r.voids.total)));
    return { heading: 'Sales', head: null, right: [false, true], rows, strong };
  };
  const payments = (): ReportSection => ({
    heading: 'Taken by',
    head: null,
    right: [false, true],
    rows: r.byMethod.length ? r.byMethod.map((m) => pair(methodName(m.method), money(m.amount))) : [pair('Nothing taken', '')],
  });
  const credit = (): ReportSection => {
    const rows = [pair('Put on account', money(r.credit.given)), pair('Interest charged', money(r.credit.interest))];
    for (const m of r.credit.paymentsReceived) rows.push(pair(`Paid back: ${methodName(m.method)}`, money(m.amount)));
    return { heading: 'Customer credit', head: null, right: [false, true], rows };
  };
  const items = (): ReportSection => ({
    heading: 'Items sold',
    head: ['Item', 'Quantity', 'Total'],
    right: [false, true, true],
    rows: r.items.map((i) => [i.name, `${formatQuantity(i.quantityMilli)}${i.unit && i.unit !== 'each' ? ' ' + i.unit : ''}`, money(i.total)]),
  });
  const sections = { summary: [sales(), payments(), credit(), items()], payments: [payments()], credit: [credit()], items: [items()] }[kind];
  return { title: REPORT_LABELS[kind], period: r.from === r.to ? niceDay(r.from) : `${niceDay(r.from)} to ${niceDay(r.to)}`, sections };
}

const csvCell = (text: string): string => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
/** CSV for a spreadsheet: a title and period, then each section with a blank line between. Starts with a byte order mark so Excel reads the peso sign and accents. */
export function reportToCsv(doc: ReportDocument): string {
  const lines: string[] = [csvCell(doc.title), csvCell(doc.period)];
  for (const s of doc.sections) {
    lines.push('', csvCell(s.heading));
    if (s.head) lines.push(s.head.map(csvCell).join(','));
    for (const row of s.rows) lines.push(row.map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A printable page (also the source of the PDF). Self-contained: no scripts and no outside files. */
export function reportToHtml(doc: ReportDocument, shopName = ''): string {
  const body = doc.sections
    .map((s) => {
      const head = s.head ? `<thead><tr>${s.head.map((h, i) => `<th class="${s.right[i] ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead>` : '';
      const rows = s.rows.map((row, n) => `<tr${s.strong?.includes(n) ? ' class="b"' : ''}>${row.map((c, i) => `<td class="${s.right[i] ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
      return `<h2>${esc(s.heading)}</h2><table>${head}<tbody>${rows}</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page{margin:16mm}body{font:12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 4px}
p{margin:2px 0;color:#555}table{width:100%;border-collapse:collapse}td,th{padding:3px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
th{font-weight:600;border-bottom:1px solid #888}.r{text-align:right;white-space:nowrap}.b td{font-weight:700;border-bottom:1px solid #888}tr{break-inside:avoid}
</style></head><body>${shopName ? `<p>${esc(shopName)}</p>` : ''}<h1>${esc(doc.title)}</h1><p>${esc(doc.period)}</p>${body}</body></html>`;
}
