import path from 'node:path';
import { app, nativeImage } from 'electron';
import { bgraToRgba, type Bitmap, centerOnPaper, contentBounds } from './bitmap';
import { type DecodedLogo, LogoStore } from './logo-store';

/** The picture printed at the top of receipts, if the shop has put one here (a PNG or JPEG named receipt-logo.png). */
export const shopLogoFile = (): string => path.join(app.getPath('userData'), 'receipt-logo.png');

/** Widest logo kept: the printable dots of the widest paper (80 mm). */
const WIDEST_DOTS = 576;

/** Reads an uploaded picture with Electron's image support and scales it down to the widest paper; null when it is not a picture. */
function decodeLogo(bytes: Uint8Array): DecodedLogo | null {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) return null;
  const scaled = image.getSize().width > WIDEST_DOTS ? image.resize({ width: WIDEST_DOTS, quality: 'best' }) : image;
  return { png: scaled.toPNG() };
}

/** The shop logo file with its checks (upload, remove, preview). */
export const shopLogos = new LogoStore(shopLogoFile, decodeLogo);

export const hasShopLogo = (): boolean => shopLogos.has();

/** Side margin kept clear on both sides of a logo, in dots. */
const MARGIN_DOTS = 16;
/** White left under the logo before the shop name, in dots. */
export const LOGO_GAP_DOTS = 12;

/** The logo with the blank (transparent or white) border cut off, so spare space in the file does not push the name away. */
function trimmed(image: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = image.getSize();
  const bounds = contentBounds(bgraToRgba(image.toBitmap(), width, height));
  return bounds ? image.crop(bounds) : image;
}

/** The stored logo as a PNG with its blank border trimmed (what is printed and drawn in the debug image), or null when there is none. */
export function trimmedLogoPng(): Buffer | null {
  try {
    const image = nativeImage.createFromPath(shopLogoFile());
    return image.isEmpty() ? null : trimmed(image).toPNG();
  } catch (error) {
    console.error('Could not read the shop logo', error);
    return null;
  }
}

/** The shop logo trimmed, scaled to fit the paper and centred on a strip as wide as the paper, or null when there is none (or it cannot be read). */
export function loadShopLogo(paperWidthDots: number): Bitmap | null {
  try {
    const stored = nativeImage.createFromPath(shopLogoFile());
    if (stored.isEmpty()) return null;
    const image = trimmed(stored);
    const room = paperWidthDots - 2 * MARGIN_DOTS;
    const resized = image.getSize().width > room ? image.resize({ width: room, quality: 'best' }) : image;
    const { width, height } = resized.getSize();
    return centerOnPaper(bgraToRgba(resized.toBitmap(), width, height), paperWidthDots, LOGO_GAP_DOTS);
  } catch (error) {
    console.error('Could not read the shop logo', error);
    return null;
  }
}
