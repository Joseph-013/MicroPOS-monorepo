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
 * Transparent pixels become white: a thermal printer has no transparency. `bottomPadDots` of white are added under it.
 */
export function centerOnPaper(source: Bitmap, paperWidthDots: number, bottomPadDots = 0): Bitmap {
  const height = source.height + bottomPadDots;
  const out = new Uint8ClampedArray(paperWidthDots * height * 4).fill(255);
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
  return { width: paperWidthDots, height, data: out };
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

/** The box around everything that is not blank (transparent or near white), or null when the picture is all blank. */
export function contentBounds(bitmap: Bitmap): { x: number; y: number; width: number; height: number } | null {
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const at = (y * bitmap.width + x) * 4;
      const blank = bitmap.data[at + 3]! < 16 || (bitmap.data[at]! >= 240 && bitmap.data[at + 1]! >= 240 && bitmap.data[at + 2]! >= 240);
      if (blank) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
