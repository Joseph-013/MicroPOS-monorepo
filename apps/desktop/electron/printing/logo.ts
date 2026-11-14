import fs from 'node:fs';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import { bgraToRgba, type Bitmap, centerOnPaper } from './bitmap';

/** The picture printed at the top of receipts, if the shop has put one here (a PNG or JPEG named receipt-logo.png). */
export const shopLogoFile = (): string => path.join(app.getPath('userData'), 'receipt-logo.png');

export const hasShopLogo = (): boolean => fs.existsSync(shopLogoFile());

/** Side margin kept clear on both sides of a logo, in dots. */
const MARGIN_DOTS = 16;

/** The shop logo scaled to fit the paper and centred on a strip as wide as the paper, or null when there is none (or it cannot be read). */
export function loadShopLogo(paperWidthDots: number): Bitmap | null {
  try {
    const image = nativeImage.createFromPath(shopLogoFile());
    if (image.isEmpty()) return null;
    const room = paperWidthDots - 2 * MARGIN_DOTS;
    const resized = image.getSize().width > room ? image.resize({ width: room, quality: 'best' }) : image;
    const { width, height } = resized.getSize();
    return centerOnPaper(bgraToRgba(resized.toBitmap(), width, height), paperWidthDots);
  } catch (error) {
    console.error('Could not read the shop logo', error);
    return null;
  }
}
