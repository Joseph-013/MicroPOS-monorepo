import qrcode from 'qrcode-generator';
import type { Bitmap } from './bitmap';
import { centerOnPaper } from './bitmap';

/** The QR code of `text` as rows of modules (true = dark). Error correction M: a few damaged modules still scan. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M'); // type 0: the smallest version that fits
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** Quiet zone around a code, in modules (the QR standard asks for four). */
export const QUIET_MODULES = 4;

/**
 * How many dots one module is drawn with: as many as fit in about 60% of the paper's width, never more than 8 (bigger
 * helps no scanner) and never fewer than 2. A thermal print is rarely sharp, so modules are kept large.
 */
export function qrModuleDots(moduleCount: number, paperWidthDots: number): number {
  return Math.max(2, Math.min(8, Math.floor((paperWidthDots * 0.6) / (moduleCount + 2 * QUIET_MODULES))));
}

/** The code as a black and white picture with its quiet zone, centred on a strip as wide as the paper (like the logo). */
export function qrBitmap(text: string, paperWidthDots: number): Bitmap {
  const matrix = qrMatrix(text);
  const module = qrModuleDots(matrix.length, paperWidthDots);
  const side = (matrix.length + 2 * QUIET_MODULES) * module;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix.length; col++) {
      if (!matrix[row]![col]) continue;
      for (let dy = 0; dy < module; dy++) {
        for (let dx = 0; dx < module; dx++) {
          const x = (col + QUIET_MODULES) * module + dx;
          const y = (row + QUIET_MODULES) * module + dy;
          const at = (y * side + x) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
    }
  }
  return centerOnPaper({ width: side, height: side, data }, paperWidthDots);
}
