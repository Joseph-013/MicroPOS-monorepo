import { PAPER_WIDTHS_MM, type PaperWidthMm } from './receipt.js';

/** How the receipt printer is reached. Network printers take raw ESC/POS on a TCP port (9100); USB ones are opened directly. */
export type PrinterConnection =
  | { kind: 'network'; host: string; port: number }
  | { kind: 'usb'; vendorId: number; productId: number; serialNumber: string; /** For people: "Epson TM-T20". */ label: string };

export interface PrinterConfig {
  /** Null until someone sets a printer up. */
  connection: PrinterConnection | null;
  paperWidthMm: PaperWidthMm;
}

/** What the shop prints at the top and bottom of a receipt (the logo, if any, is a file the main process keeps). */
export interface ReceiptShopSettings {
  name: string;
  address: string;
  footer: string;
}

export interface PrinterSettings {
  printer: PrinterConfig;
  shop: ReceiptShopSettings;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  printer: { connection: null, paperWidthMm: 58 },
  shop: { name: '', address: '', footer: '' },
};

export const DEFAULT_PRINTER_PORT = 9100;
export const MAX_SHOP_NAME = 60;
export const MAX_SHOP_ADDRESS = 200;
export const MAX_SHOP_FOOTER = 200;

/** A USB device that looks like a printer (it has a printer-class interface). */
export interface UsbPrinterInfo {
  vendorId: number;
  productId: number;
  serialNumber: string;
  label: string;
}

/** Why a print failed, so callers can react without reading error text. */
export const PRINTER_ERROR_CODES = ['not-configured', 'unreachable', 'timeout', 'no-printer-interface', 'busy', 'write-failed', 'unsupported', 'unknown'] as const;
export type PrinterErrorCode = (typeof PRINTER_ERROR_CODES)[number];

/** `savedTo` is set when the receipt was saved as an image (debug) instead of printed. */
export type PrintResult = { ok: true; savedTo?: string } | { ok: false; code: PrinterErrorCode; error: string };

export type PrinterSettingsField = 'host' | 'port' | 'usb' | 'paperWidth' | 'shopName' | 'shopAddress' | 'shopFooter';
export type SavePrinterSettingsResult = { ok: true; settings: PrinterSettings } | { ok: false; field: PrinterSettingsField | null; error: string };

export const isPaperWidth = (value: unknown): value is PaperWidthMm => (PAPER_WIDTHS_MM as readonly unknown[]).includes(value);

/** Most bytes of a logo file accepted. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** The result of uploading a logo: the saved picture as a data URL for the preview, or why it was refused. */
export type SaveLogoResult = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Debugging aids for receipts (Settings > Debug). */
export interface PrinterDebug {
  /** Save each receipt as an image in the Downloads folder instead of sending it to the printer (no printer needed). */
  saveImages: boolean;
  /** The folder the images go in. */
  folder: string;
}
