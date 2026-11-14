import fs from 'node:fs';
import path from 'node:path';
import { qrMatrix, qrModuleDots, QUIET_MODULES } from './qr';
import { columnsFor, dotsFor, layoutReceipt, type PaperWidthMm, type PrintResult, type ReceiptDocument, type ReceiptRow } from '@micropos/core';

/** Draws the rows of a receipt as a PNG as wide as the paper's printable dots; `logo` is the logo picture (PNG), if any. */
/** A row to draw: the laid-out rows, with each QR code already turned into its modules and the dots a module is drawn with. */
export type RasterRow = Exclude<ReceiptRow, { kind: 'qr' }> | { kind: 'qr'; matrix: boolean[][]; moduleDots: number; quietModules: number };
export type Rasterizer = (input: { rows: RasterRow[]; columns: number; dots: number; logo: Buffer | null }) => Promise<Buffer>;

export interface ReceiptImageSinkDeps {
  /** The folder the images go in. */
  folder: () => string;
  rasterize: Rasterizer;
  /** Whether receipts are saved as images instead of printed. */
  enabled: () => boolean;
  /** The stored logo picture, or null. */
  logoPng: () => Buffer | null;
  now?: () => Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A label as part of a file name: letters, digits and dashes only. */
export const slug = (label: string): string => label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'receipt';

/**
 * A stand-in for the printer for testing without one: the receipt is laid out as the printer would print it
 * (`layoutReceipt`), drawn as a picture and saved in a folder (Downloads, in the app) under a name that says which
 * receipt it is and when it was made.
 */
export class ReceiptImageSink {
  constructor(private readonly deps: ReceiptImageSinkDeps) {}

  enabled(): boolean {
    return this.deps.enabled();
  }

  get folder(): string {
    return this.deps.folder();
  }

  async save(doc: ReceiptDocument, label: string, paperWidthMm: PaperWidthMm): Promise<PrintResult> {
    try {
      const dots = dotsFor(paperWidthMm);
      const rows: RasterRow[] = layoutReceipt(doc).map((row) => {
        if (row.kind !== 'qr') return row;
        const matrix = qrMatrix(row.data); // the same code and size the printer gets
        return { kind: 'qr', matrix, moduleDots: qrModuleDots(matrix.length, dots), quietModules: QUIET_MODULES };
      });
      const png = await this.deps.rasterize({ rows, columns: columnsFor(paperWidthMm), dots, logo: this.deps.logoPng() });
      const at = (this.deps.now ?? (() => new Date()))();
      const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
      fs.mkdirSync(this.folder, { recursive: true });
      let file = path.join(this.folder, `receipt-${slug(label)}-${stamp}.png`);
      for (let n = 1; fs.existsSync(file); n++) file = path.join(this.folder, `receipt-${slug(label)}-${stamp}-${n}.png`); // two in one second
      fs.writeFileSync(file, png);
      return { ok: true, savedTo: file };
    } catch (error) {
      return { ok: false, code: 'write-failed', error: `The receipt image could not be saved (${error instanceof Error ? error.message : String(error)})` };
    }
  }
}
