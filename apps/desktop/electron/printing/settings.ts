import {
  DEFAULT_PRINTER_PORT,
  DEFAULT_PRINTER_SETTINGS,
  isPaperWidth,
  MAX_SHOP_ADDRESS,
  MAX_SHOP_FOOTER,
  MAX_SHOP_NAME,
  type PrinterConnection,
  type PrinterSettings,
  type SavePrinterSettingsResult,
} from '@micropos/core';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { settings } from '../db/schema';

const KEY = 'printerSettings';

const clean = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').trim();
  return text.length > max ? null : text;
};

const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Checks what the settings form sent; returns clean settings or the first problem, named by field. */
export function sanitizePrinterSettings(raw: unknown): PrinterSettings | { field: Extract<SavePrinterSettingsResult, { ok: false }>['field']; error: string } {
  const v = (raw ?? {}) as { printer?: { connection?: unknown; paperWidthMm?: unknown }; shop?: Record<string, unknown> };
  const paperWidthMm = v.printer?.paperWidthMm;
  if (!isPaperWidth(paperWidthMm)) return { field: 'paperWidth', error: 'Choose the paper width' };

  let connection: PrinterConnection | null = null;
  const c = v.printer?.connection as Record<string, unknown> | null | undefined;
  if (c) {
    if (c['kind'] === 'network') {
      const host = typeof c['host'] === 'string' ? c['host'].trim() : '';
      if (!host || host.length > 253 || !HOST.test(host)) return { field: 'host', error: 'Enter the printer address' };
      const port = c['port'] ?? DEFAULT_PRINTER_PORT;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return { field: 'port', error: 'Enter a port from 1 to 65535' };
      connection = { kind: 'network', host, port };
    } else if (c['kind'] === 'usb') {
      const { vendorId, productId } = c;
      if (!Number.isInteger(vendorId) || !Number.isInteger(productId) || (vendorId as number) < 0 || (productId as number) < 0) return { field: 'usb', error: 'Choose the printer' };
      const serialNumber = typeof c['serialNumber'] === 'string' ? c['serialNumber'] : '';
      const label = typeof c['label'] === 'string' ? c['label'].slice(0, 100) : 'USB printer';
      connection = { kind: 'usb', vendorId: vendorId as number, productId: productId as number, serialNumber, label };
    } else return { field: null, error: 'Choose how the printer is connected' };
  }

  const name = clean(v.shop?.['name'], MAX_SHOP_NAME);
  if (name === null) return { field: 'shopName', error: 'The shop name is too long' };
  const address = clean(v.shop?.['address'], MAX_SHOP_ADDRESS);
  if (address === null) return { field: 'shopAddress', error: 'The address is too long' };
  const footer = clean(v.shop?.['footer'], MAX_SHOP_FOOTER);
  if (footer === null) return { field: 'shopFooter', error: 'The closing message is too long' };
  return { printer: { connection, paperWidthMm }, shop: { name, address, footer } };
}

/** The saved printer and shop settings (the defaults until someone saves some). */
export function loadPrinterSettings(db: AppDatabase): PrinterSettings {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
  if (!row) return structuredClone(DEFAULT_PRINTER_SETTINGS);
  const clean = sanitizePrinterSettings(row.value);
  return 'error' in clean ? structuredClone(DEFAULT_PRINTER_SETTINGS) : clean;
}

export function savePrinterSettings(db: AppDatabase, raw: unknown, now = Date.now()): SavePrinterSettingsResult {
  const result = sanitizePrinterSettings(raw);
  if ('error' in result) return { ok: false, ...result };
  db.insert(settings).values({ key: KEY, value: result, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: result, updatedAt: now } }).run();
  return { ok: true, settings: result };
}
