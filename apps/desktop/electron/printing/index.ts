import path from 'node:path';
import { app } from 'electron';
import type { AppDatabase } from '../db';
import { getSaveReceiptImages } from './debug-settings';
import { ReceiptImageSink } from './receipt-image';
import { rasterizeWithWindow } from './receipt-image-electron';
import { log } from '../logging';
import { loadShopLogo, shopLogos } from './logo';
import { PrinterService } from './printer-service';
import { loadPrinterSettings } from './settings';
import { NetworkTransport } from './transports/network';
import { UsbTransport } from './transports/usb';

/** The folder receipt images go in while debugging: a folder of its own in Downloads. */
export const receiptImagesFolder = (): string => path.join(app.getPath('downloads'), 'MicroPOS receipts');

/** The stand-in printer that saves receipts as images (Settings > Debug). */
export function createReceiptImageSink(db: AppDatabase): ReceiptImageSink {
  return new ReceiptImageSink({ folder: receiptImagesFolder, rasterize: rasterizeWithWindow, enabled: () => getSaveReceiptImages(db), logoPng: () => shopLogos.read() });
}

/** The printer service with the real settings, transports and logo, for the main process. */
export function createPrinterService(db: AppDatabase): PrinterService {
  return new PrinterService({
    images: createReceiptImageSink(db),
    settings: () => loadPrinterSettings(db),
    transportFor: (connection) => (connection.kind === 'network' ? new NetworkTransport(connection.host, connection.port) : new UsbTransport(connection)),
    logo: loadShopLogo,
    log,
  });
}
