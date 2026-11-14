import type { AppDatabase } from '../db';
import { log } from '../logging';
import { loadShopLogo } from './logo';
import { PrinterService } from './printer-service';
import { loadPrinterSettings } from './settings';
import { NetworkTransport } from './transports/network';
import { UsbTransport } from './transports/usb';

/** The printer service with the real settings, transports and logo, for the main process. */
export function createPrinterService(db: AppDatabase): PrinterService {
  return new PrinterService({
    settings: () => loadPrinterSettings(db),
    transportFor: (connection) => (connection.kind === 'network' ? new NetworkTransport(connection.host, connection.port) : new UsbTransport(connection)),
    logo: loadShopLogo,
    log,
  });
}
