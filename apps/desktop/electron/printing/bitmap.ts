/** A picture as RGBA pixels (4 bytes each, rows top to bottom), the shape the ESC/POS encoder reads. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Puts `source` on a white strip exactly `paperWidthDots` wide, centred. The centring is part of the picture, so it
 * does not depend on whatever alignment or margin a printer happens to be in (this is why a logo cannot come out
 * off-centre on one job and centred on the next). A source wider than the strip is cut at both sides equally.
 * Transparent pixels become white: a thermal printer has no transparency.
 */
export function centerOnPaper(source: Bitmap, paperWidthDots: number): Bitmap {
  const out = new Uint8ClampedArray(paperWidthDots * source.height * 4).fill(255);
  const offset = Math.floor((paperWidthDots - source.width) / 2);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const target = x + offset;
      if (target < 0 || target >= paperWidthDots) continue;
      const from = (y * source.width + x) * 4;
      const to = (y * paperWidthDots + target) * 4;
      const alpha = source.data[from + 3]! / 255;
      for (let c = 0; c < 3; c++) out[to + c] = Math.round(source.data[from + c]! * alpha + 255 * (1 - alpha));
      out[to + 3] = 255;
    }
  }
  return { width: paperWidthDots, height: source.height, data: out };
}

/** Electron's `toBitmap()` gives BGRA; the encoder wants RGBA. */
export function bgraToRgba(bgra: Uint8Array | Buffer, width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height * 4; i += 4) {
    data[i] = bgra[i + 2]!;
    data[i + 1] = bgra[i + 1]!;
    data[i + 2] = bgra[i]!;
    data[i + 3] = bgra[i + 3]!;
  }
  return { width, height, data };
}
