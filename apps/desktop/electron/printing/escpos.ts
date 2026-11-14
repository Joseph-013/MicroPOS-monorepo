import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { columnsFor, dotsFor, type PaperWidthMm, type ReceiptDocument } from '@micropos/core';
import type { Bitmap } from './bitmap';
import { qrBitmap } from './qr';

/**
 * Turns a receipt into ESC/POS bytes for a printer with paper `paperWidthMm` wide. Every job states what it relies on
 * instead of trusting the printer's leftover state: it starts with a full reset, then sets the left margin to 0 and
 * the print width to the paper's full width, and aligns left, so a job prints the same on a freshly switched-on
 * printer as on one that has been printing all day.
 */
export function encodeReceipt(doc: ReceiptDocument, options: { paperWidthMm: PaperWidthMm; logo?: Bitmap | null }): Uint8Array {
  const columns = columnsFor(options.paperWidthMm);
  const dots = dotsFor(options.paperWidthMm);
  const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', columns, imageMode: 'raster', feedBeforeCut: 3 });

  encoder.initialize(); // ESC @
  encoder.raw([0x1d, 0x4c, 0x00, 0x00]); // GS L: left margin 0
  encoder.raw([0x1d, 0x57, dots & 0xff, dots >> 8]); // GS W: print area as wide as the paper
  encoder.align('left');

  for (const line of doc.lines) {
    switch (line.kind) {
      case 'text':
        encoder.align(line.align ?? 'left').bold(line.bold === true).line(line.text);
        break;
      case 'columns': {
        const fixed = line.cells.reduce((sum, c) => sum + (c.width ?? 0), 0);
        const open = line.cells.filter((c) => c.width === undefined).length;
        const share = open ? Math.max(1, Math.floor((columns - fixed) / open)) : 0;
        encoder
          .align('left')
          .bold(line.bold === true)
          .table(
            line.cells.map((c) => ({ width: c.width ?? share, align: c.align })),
            [line.cells.map((c) => c.text)],
          );
        break;
      }
      case 'rule':
        encoder.align('left').bold(false).line((line.style === 'double' ? '=' : '-').repeat(columns));
        break;
      case 'feed':
        encoder.newline(line.lines);
        break;
      case 'qr': {
        // Sent as a picture, centred inside it like the logo: it prints the same on any printer (not every one has a QR command).
        const picture = qrBitmap(line.data, dots);
        encoder.align('center').image(picture, picture.width, picture.height, 'threshold').align('left');
        break;
      }
      case 'logo':
        if (options.logo) encoder.align('center').image(options.logo, options.logo.width, options.logo.height, 'threshold').align('left'); // its own bottom gap is part of the picture
        break;
    }
  }
  encoder.bold(false).align('left');
  return encoder.cut().encode();
}
