import { BrowserWindow } from 'electron';
import type { Rasterizer } from './receipt-image';

/** One character cell of the 12 x 24 dot printer font, and the type size that fits it. */
const CELL_WIDTH = 12;
const CELL_HEIGHT = 24;
const MARGIN = 24;

/**
 * Draws the receipt on a canvas in a window that is never shown (Electron has no canvas of its own in the main
 * process): every character goes in its own cell so columns line up exactly as on paper, black on white; the logo is
 * scaled to fit and reduced to black and white as the printer would. Only used for the debug images.
 */
export const rasterizeWithWindow: Rasterizer = async ({ rows, columns, dots, logo }) => {
  const window = new BrowserWindow({ show: false, width: dots, height: 200, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await window.loadURL('data:text/html;charset=utf-8,<!doctype html><canvas id="c"></canvas>');
    const input = JSON.stringify({ rows, columns, dots, logo: logo ? `data:image/png;base64,${logo.toString('base64')}` : null, cellWidth: CELL_WIDTH, cellHeight: CELL_HEIGHT, margin: MARGIN });
    const dataUrl: string = await window.webContents.executeJavaScript(`(${draw.toString()})(${input})`);
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    window.destroy();
  }
};

/** Runs inside the hidden window (so it cannot use anything from this file). */
async function draw(input: { rows: ({ kind: 'text'; text: string; bold: boolean } | { kind: 'logo' } | { kind: 'qr'; matrix: boolean[][]; moduleDots: number; quietModules: number })[]; columns: number; dots: number; logo: string | null; cellWidth: number; cellHeight: number; margin: number }): Promise<string> {
  const { rows, dots, cellWidth, cellHeight, margin } = input;
  let logo: HTMLImageElement | null = null;
  if (input.logo) {
    const image = new Image();
    image.src = input.logo;
    await image.decode();
    logo = image;
  }
  const logoWidth = logo ? Math.min(logo.naturalWidth, dots - 32) : 0;
  const logoHeight = logo ? Math.round((logo.naturalHeight * logoWidth) / logo.naturalWidth) : 0;
  const qrSide = (r: { matrix: boolean[][]; moduleDots: number; quietModules: number }): number => (r.matrix.length + 2 * r.quietModules) * r.moduleDots;
  const height = margin * 2 + rows.reduce((sum, r) => sum + (r.kind === 'logo' ? (logo ? logoHeight + cellHeight : 0) : r.kind === 'qr' ? qrSide(r) : cellHeight), 0);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = dots;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dots, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  let y = margin;
  for (const row of rows) {
    if (row.kind === 'qr') {
      const side = qrSide(row);
      const left = Math.floor((dots - side) / 2);
      for (let r = 0; r < row.matrix.length; r++) {
        for (let c = 0; c < row.matrix.length; c++) {
          if (row.matrix[r]![c]) ctx.fillRect(left + (c + row.quietModules) * row.moduleDots, y + (r + row.quietModules) * row.moduleDots, row.moduleDots, row.moduleDots);
        }
      }
      y += side;
      continue;
    }
    if (row.kind === 'logo') {
      if (!logo) continue;
      const x = Math.floor((dots - logoWidth) / 2);
      ctx.drawImage(logo, x, y, logoWidth, logoHeight);
      // Black and white, as the printer prints it (threshold on brightness; transparent counts as white).
      const picture = ctx.getImageData(0, y, dots, logoHeight);
      for (let i = 0; i < picture.data.length; i += 4) {
        const alpha = picture.data[i + 3]! / 255;
        const luma = (0.299 * picture.data[i]! + 0.587 * picture.data[i + 1]! + 0.114 * picture.data[i + 2]!) * alpha + 255 * (1 - alpha);
        const v = luma < 128 ? 0 : 255;
        picture.data[i] = picture.data[i + 1] = picture.data[i + 2] = v;
        picture.data[i + 3] = 255;
      }
      ctx.putImageData(picture, 0, y);
      y += logoHeight + cellHeight;
      continue;
    }
    ctx.font = `${row.bold ? 'bold ' : ''}20px "DejaVu Sans Mono", "Liberation Mono", Menlo, Consolas, monospace`;
    for (let i = 0; i < row.text.length; i++) {
      const ch = row.text[i]!;
      if (ch !== ' ') ctx.fillText(ch, i * cellWidth + Math.max(0, (cellWidth - ctx.measureText(ch).width) / 2), y + 19);
    }
    y += cellHeight;
  }
  return canvas.toDataURL('image/png');
}
