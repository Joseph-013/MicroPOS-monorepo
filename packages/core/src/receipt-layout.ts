import type { ReceiptAlign, ReceiptDocument } from './receipt.js';

/** One printed row: a line of text exactly as wide as the paper (padded with spaces), or the shop logo. */
export type ReceiptRow = { kind: 'text'; text: string; bold: boolean } | { kind: 'logo' } | { kind: 'qr'; data: string };

function aligned(text: string, width: number, align: ReceiptAlign): string {
  const cut = text.slice(0, width);
  const room = width - cut.length;
  if (align === 'right') return ' '.repeat(room) + cut;
  if (align === 'center') return ' '.repeat(Math.floor(room / 2)) + cut + ' '.repeat(room - Math.floor(room / 2));
  return cut + ' '.repeat(room);
}

/**
 * What a printer would put on each line of paper, character for character: the document laid out for its width. Text
 * is aligned inside the width, a row of columns is cut to its cell widths (a cell without a width shares what the
 * others leave), a rule fills the line, a feed is empty rows. This is the plain-text picture of a receipt, used to
 * check layouts without a printer (it is what the receipt image shows).
 */
export function layoutReceipt(doc: ReceiptDocument): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  for (const line of doc.lines) {
    switch (line.kind) {
      case 'text':
        rows.push({ kind: 'text', text: aligned(line.text, doc.columns, line.align ?? 'left'), bold: line.bold === true });
        break;
      case 'columns': {
        const fixed = line.cells.reduce((sum, c) => sum + (c.width ?? 0), 0);
        const open = line.cells.filter((c) => c.width === undefined).length;
        const share = open ? Math.max(1, Math.floor((doc.columns - fixed) / open)) : 0;
        const text = line.cells.map((c) => aligned(c.text, c.width ?? share, c.align)).join('');
        rows.push({ kind: 'text', text: text.slice(0, doc.columns).padEnd(doc.columns), bold: line.bold === true });
        break;
      }
      case 'rule':
        rows.push({ kind: 'text', text: (line.style === 'double' ? '=' : '-').repeat(doc.columns), bold: false });
        break;
      case 'feed':
        for (let i = 0; i < line.lines; i++) rows.push({ kind: 'text', text: ' '.repeat(doc.columns), bold: false });
        break;
      case 'logo':
        rows.push({ kind: 'logo' });
        break;
      case 'qr':
        rows.push({ kind: 'qr', data: line.data });
        break;
    }
  }
  return rows;
}
