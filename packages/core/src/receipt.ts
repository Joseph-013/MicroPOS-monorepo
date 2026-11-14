import type { SalesOrderDetail } from './draft.js';
import type { Money } from './index.js';
import { formatQuantity } from './quantity.js';

/**
 * Receipts as plain data. A receipt is built here, in pure code, from a sale and the shop's details; turning it into
 * the bytes of a particular printer (ESC/POS and so on) and sending them is the job of whoever owns the printer (the
 * desktop app's main process, which later also serves phones). Nothing in this file knows about printers.
 */

/** Paper widths the printers use, in millimetres. */
export const PAPER_WIDTHS_MM = [58, 80] as const;
export type PaperWidthMm = (typeof PAPER_WIDTHS_MM)[number];
export const DEFAULT_PAPER_WIDTH_MM: PaperWidthMm = 58;

/** Characters in a line of normal text on that paper (the usual 12 x 24 dot font), and printable dots across it. */
export const columnsFor = (paperWidthMm: PaperWidthMm): number => (paperWidthMm === 80 ? 48 : 32);
export const dotsFor = (paperWidthMm: PaperWidthMm): number => (paperWidthMm === 80 ? 576 : 384);

export type ReceiptAlign = 'left' | 'center' | 'right';

export type ReceiptLine =
  | { kind: 'text'; text: string; align?: ReceiptAlign; bold?: boolean }
  /** Cells share the line: `width` is the number of characters; the last cell takes what is left when it has none. */
  | { kind: 'columns'; cells: { text: string; align: ReceiptAlign; width?: number }[]; bold?: boolean }
  | { kind: 'rule'; style: 'dash' | 'double' }
  | { kind: 'feed'; lines: number }
  /** The shop's logo, when it has one (the printer side supplies the picture). */
  | { kind: 'logo' };

export interface ReceiptDocument {
  /** Characters per line it was laid out for. */
  columns: number;
  lines: ReceiptLine[];
}

/** What the shop puts on its receipts. */
export interface ReceiptShop {
  name: string;
  address: string;
  /** A closing message ("Thank you!"), may be several lines. */
  footer: string;
  /** Whether a logo is set up and should be printed at the top. */
  hasLogo: boolean;
}

export const EMPTY_RECEIPT_SHOP: ReceiptShop = { name: '', address: '', footer: '', hasLogo: false };

const METHOD_NAMES: Record<string, string> = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', bank_transfer: 'Bank transfer', other: 'Other' };

/** 123456 -> "1,234.56"; negative amounts keep their sign. Integer maths only. */
export function formatReceiptMoney(cents: Money): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** Breaks text into lines of at most `width` characters at spaces; a word longer than a line is cut. Empty text gives no lines. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > width) {
        if (current) {
          lines.push(current);
          current = '';
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!current) current = rest;
      else if (current.length + 1 + rest.length <= width) current += ` ${rest}`;
      else {
        lines.push(current);
        current = rest;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

const dateText = (ms: number): string =>
  new Date(ms).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A left label and a right value on one line (the label is cut when both do not fit). */
function pair(label: string, value: string, columns: number, bold = false): ReceiptLine {
  const valueWidth = Math.min(value.length, columns - 1);
  return { kind: 'columns', bold, cells: [{ text: label.slice(0, columns - valueWidth - 1), align: 'left', width: columns - valueWidth }, { text: value, align: 'right' }] };
}

/**
 * The receipt of a recorded sale, laid out for `columns` characters per line: shop header, order details, one entry
 * per item (name, then quantity x price and the line total), totals, payments, what went on account, and the footer.
 * Voided and refunded orders say so; a refund order carries its negative amounts as they are.
 */
export function buildSaleReceipt(order: SalesOrderDetail, shop: ReceiptShop, columns: number): ReceiptDocument {
  const lines: ReceiptLine[] = [];
  const text = (t: string, align: ReceiptAlign = 'left', bold = false): void => void lines.push({ kind: 'text', text: t, align, bold });
  const centered = (block: string, bold = false): void => wrapText(block, columns).forEach((l) => text(l, 'center', bold));

  if (shop.hasLogo) lines.push({ kind: 'logo' });
  centered(shop.name, true);
  centered(shop.address);
  if (shop.name || shop.address || shop.hasLogo) lines.push({ kind: 'rule', style: 'dash' });

  if (order.status === 'voided') text('*** VOIDED ***', 'center', true);
  if (order.status === 'refunded') text('*** REFUNDED ***', 'center', true);
  if (order.refundOf) text(`REFUND of ${order.refundOf.orderNumber}`, 'center', true);
  text(`Order ${order.orderNumber}`, 'left', true);
  text(dateText(order.completedAt ?? order.createdAt));
  text(`Cashier: ${order.employeeName}`);
  if (order.customer) text(`Customer: ${order.customer.name}`);
  lines.push({ kind: 'rule', style: 'dash' });

  for (const line of order.lines) {
    wrapText(line.name, columns).forEach((l) => text(l));
    const weighed = line.unit !== null && line.unit !== 'each';
    const quantity = `${formatQuantity(line.quantityMilli)}${weighed ? ` ${line.unit}` : ''} x ${formatReceiptMoney(line.unitPrice)}`;
    lines.push(pair(`  ${quantity}`, formatReceiptMoney(line.lineTotal), columns));
  }
  lines.push({ kind: 'rule', style: 'dash' });

  if (order.discountTotal !== 0) {
    lines.push(pair('Subtotal', formatReceiptMoney(order.subtotal), columns));
    lines.push(pair('Discount', formatReceiptMoney(-Math.abs(order.discountTotal)), columns));
  }
  lines.push(pair('TOTAL', `PHP ${formatReceiptMoney(order.total)}`, columns, true));

  for (const payment of order.payments) {
    lines.push(pair(METHOD_NAMES[payment.method] ?? payment.method, formatReceiptMoney(payment.amount), columns));
    if (payment.tendered !== null) lines.push(pair('  Tendered', formatReceiptMoney(payment.tendered), columns));
    if (payment.change) lines.push(pair('  Change', formatReceiptMoney(payment.change), columns));
    if (payment.reference) wrapText(`  Ref ${payment.reference}`, columns).forEach((l) => text(l));
  }
  if (order.onAccount !== 0) lines.push(pair('On account', formatReceiptMoney(order.onAccount), columns, true));

  if (shop.footer.trim()) {
    lines.push({ kind: 'rule', style: 'dash' });
    centered(shop.footer);
  }
  lines.push({ kind: 'feed', lines: 2 });
  return { columns, lines };
}

/** A short page to check a printer and its paper width: a ruler as wide as the paper, then sample lines. */
export function buildTestReceipt(shop: ReceiptShop, columns: number, now: number): ReceiptDocument {
  const ruler = Array.from({ length: columns }, (_, i) => ((i + 1) % 10 === 0 ? String(((i + 1) / 10) % 10) : '-')).join('');
  const lines: ReceiptLine[] = [];
  if (shop.hasLogo) lines.push({ kind: 'logo' });
  if (shop.name) lines.push({ kind: 'text', text: shop.name, align: 'center', bold: true });
  lines.push(
    { kind: 'text', text: 'Printer test', align: 'center', bold: true },
    { kind: 'text', text: dateText(now), align: 'center' },
    { kind: 'text', text: ruler },
    pair('Left', 'Right', columns),
    { kind: 'text', text: `${columns} characters per line`, align: 'center' },
    { kind: 'feed', lines: 2 },
  );
  return { columns, lines };
}
