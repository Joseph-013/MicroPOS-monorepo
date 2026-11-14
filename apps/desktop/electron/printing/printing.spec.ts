import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSaleReceipt, columnsFor, DEFAULT_PRINTER_SETTINGS, type PrinterSettings, type ReceiptDocument, type SalesOrderDetail, wrapText, formatReceiptMoney } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { centerOnPaper, type Bitmap } from './bitmap';
import { encodeReceipt } from './escpos';
import { PrinterError } from './errors';
import { PrinterService } from './printer-service';
import { loadPrinterSettings, sanitizePrinterSettings, savePrinterSettings } from './settings';
import { NetworkTransport } from './transports/network';
import type { PrinterTransport } from './transports/types';
import { findPrinterInterface, listUsbPrinters, UsbTransport, type UsbDeviceLike, type UsbLike } from './transports/usb';

const order = (over: Partial<SalesOrderDetail> = {}): SalesOrderDetail => ({
  id: 'o1', orderNumber: 'SO-1001', status: 'completed', employeeName: 'Admin', subtotal: 121_00, discountTotal: 0, total: 121_00, createdAt: Date.UTC(2026, 10, 14, 2, 41), completedAt: Date.UTC(2026, 10, 14, 2, 41),
  lines: [
    { id: 'l1', productId: 'p1', name: 'Whole Milk (1 gal)', unitPrice: 4_29, quantityMilli: 2_000, lineTotal: 8_58, unit: 'each' },
    { id: 'l2', productId: 'p2', name: 'A very long product name that cannot fit on one line of a narrow receipt', unitPrice: 12_99, quantityMilli: 1_250, lineTotal: 16_24, unit: 'kg' },
  ],
  customer: null, onAccount: 0, refundOf: null, refundedBy: null,
  payments: [{ method: 'cash', amount: 121_00, tendered: 150_00, change: 29_00, reference: null }],
  ...over,
});
const shop = { name: 'Aling Nena Store', address: '12 Rizal St, Cebu', footer: 'Thank you!', hasLogo: false };
const text = (doc: ReceiptDocument): string[] => doc.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : l.kind === 'columns' ? [l.cells.map((c) => c.text).join('|')] : []));

describe('the receipt document', () => {
  it('formats money with integer maths and wraps text without cutting words', () => {
    expect([0, 5, 1234, 123456, 100000000, -250].map(formatReceiptMoney)).toEqual(['0.00', '0.05', '12.34', '1,234.56', '1,000,000.00', '-2.50']);
    expect(wrapText('a very long product name', 10)).toEqual(['a very', 'long', 'product', 'name']);
    expect(wrapText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrapText('', 10)).toEqual([]);
    expect(wrapText('one\ntwo', 10)).toEqual(['one', 'two']);
  });

  it('lays a sale out: header, order, items with quantity x price, totals and payment, footer', () => {
    const doc = buildSaleReceipt(order(), shop, 32);
    const lines = text(doc);
    expect(lines.slice(0, 2)).toEqual(['Aling Nena Store', '12 Rizal St, Cebu']);
    expect(lines).toContain('Order SO-1001');
    expect(lines).toContain('Cashier: Admin');
    expect(lines).toContain('  2 x 4.29|8.58'); // each: no unit
    expect(lines).toContain('  1.25 kg x 12.99|16.24'); // weighed: with the unit
    expect(lines).toContain('TOTAL|PHP 121.00');
    expect(lines).toContain('Cash|121.00');
    expect(lines).toContain('  Tendered|150.00');
    expect(lines).toContain('  Change|29.00');
    expect(lines.at(-1)).toBe('Thank you!');
    // The long name is wrapped: no text line is longer than the paper.
    for (const l of doc.lines) if (l.kind === 'text') expect(l.text.length).toBeLessThanOrEqual(32);
  });

  it('says so on voided, refunded and refund orders, shows a customer and what is on account, and a discount', () => {
    expect(text(buildSaleReceipt(order({ status: 'voided' }), shop, 32))).toContain('*** VOIDED ***');
    expect(text(buildSaleReceipt(order({ status: 'refunded' }), shop, 32))).toContain('*** REFUNDED ***');
    expect(text(buildSaleReceipt(order({ refundOf: { id: 'x', orderNumber: 'SO-1000' }, total: -121_00 }), shop, 32))).toContain('REFUND of SO-1000');
    const credit = text(buildSaleReceipt(order({ customer: { id: 'c', name: 'Aling Nena' }, onAccount: 50_00, discountTotal: 5_00, subtotal: 126_00 }), shop, 32));
    expect(credit).toContain('Customer: Aling Nena');
    expect(credit).toContain('On account|50.00');
    expect(credit).toContain('Discount|-5.00');
    expect(credit).toContain('Subtotal|126.00');
  });

  it('has no header block for a shop with nothing set up, and prints the logo first when there is one', () => {
    expect(buildSaleReceipt(order(), { name: '', address: '', footer: '', hasLogo: false }, 32).lines[0]).toMatchObject({ kind: 'text', text: 'Order SO-1001' });
    expect(buildSaleReceipt(order(), { ...shop, hasLogo: true }, 32).lines[0]).toEqual({ kind: 'logo' });
  });
});

describe('centring a logo', () => {
  const solid = (width: number, height: number, rgba: [number, number, number, number]): Bitmap => ({ width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => rgba).flat()) });
  const pixel = (b: Bitmap, x: number, y: number): number[] => Array.from(b.data.slice((y * b.width + x) * 4, (y * b.width + x) * 4 + 4));

  it('puts the picture in the middle of a strip as wide as the paper, so it cannot depend on the printer', () => {
    const out = centerOnPaper(solid(100, 4, [0, 0, 0, 255]), 384);
    expect(out.width).toBe(384);
    expect(out.height).toBe(4);
    expect(pixel(out, 141, 0)).toEqual([255, 255, 255, 255]); // white margin
    expect(pixel(out, 142, 0)).toEqual([0, 0, 0, 255]); // (384 - 100) / 2 = 142: the first black column
    expect(pixel(out, 241, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 242, 0)).toEqual([255, 255, 255, 255]);
  });

  it('turns transparency white, and cuts a picture that is too wide equally on both sides', () => {
    expect(pixel(centerOnPaper(solid(8, 1, [0, 0, 0, 0]), 16), 4, 0)).toEqual([255, 255, 255, 255]);
    const wide = centerOnPaper(solid(20, 1, [0, 0, 0, 255]), 16);
    expect(wide.width).toBe(16);
    expect(pixel(wide, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('the ESC/POS bytes', () => {
  const bytes = (doc: ReceiptDocument, over: Partial<Parameters<typeof encodeReceipt>[1]> = {}) => encodeReceipt(doc, { paperWidthMm: 58, ...over });
  const asText = (b: Uint8Array): string => Buffer.from(b).toString('latin1');
  const has = (b: Uint8Array, seq: number[]): boolean => Buffer.from(b).includes(Buffer.from(seq));

  it('starts with a full reset, a zero left margin and the paper full print width, and ends by cutting', () => {
    const out = bytes(buildSaleReceipt(order(), shop, 32));
    const at = (seq: number[]): number => Buffer.from(out).indexOf(Buffer.from(seq));
    const firstText = Buffer.from(out).indexOf(Buffer.from('Aling'));
    expect(Array.from(out.slice(0, 2))).toEqual([0x1b, 0x40]); // ESC @ first
    const margin = at([0x1d, 0x4c, 0, 0]); // GS L 0
    const width = at([0x1d, 0x57, 384 & 0xff, 384 >> 8]); // GS W 384 dots (58 mm)
    expect(margin).toBeGreaterThan(1);
    expect(width).toBeGreaterThan(margin);
    expect(firstText).toBeGreaterThan(width); // all of it before anything is printed
    expect(has(out.slice(-12), [0x1d, 0x56])).toBe(true); // GS V: cut
  });

  it('uses the print width of the paper it is for', () => {
    const out = bytes({ columns: 48, lines: [{ kind: 'text', text: 'x' }] }, { paperWidthMm: 80 });
    expect(has(out, [0x1d, 0x57, 576 & 0xff, 576 >> 8])).toBe(true); // 576 dots across 80 mm
  });

  it('contains the text of the receipt', () => {
    const t = asText(bytes(buildSaleReceipt(order(), shop, 32)));
    for (const part of ['Aling Nena Store', 'SO-1001', 'Whole Milk', 'TOTAL', 'PHP 121.00', 'Thank you!']) expect(t).toContain(part);
  });

  it('prints a logo as a raster image of the full paper width, and skips it when there is none', () => {
    const logo = centerOnPaper({ width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4).fill(0) }, 384);
    const doc: ReceiptDocument = { columns: 32, lines: [{ kind: 'logo' }, { kind: 'text', text: 'hi' }] };
    const withLogo = bytes(doc, { logo });
    expect(has(withLogo, [0x1d, 0x76, 0x30])).toBe(true); // GS v 0: raster bit image
    expect(withLogo.length).toBeGreaterThan(bytes(doc).length + 300);
    expect(has(bytes(doc), [0x1d, 0x76, 0x30])).toBe(false);
  });

  it('keeps every row to the paper width', () => {
    const t = asText(bytes(buildSaleReceipt(order(), shop, 32))).split('\n');
    for (const row of t) expect(row.replace(/[\x00-\x1f\x80-\xff]/g, '').length).toBeLessThanOrEqual(40);
  });

  it('knows how many characters a line holds', () => {
    expect([columnsFor(58), columnsFor(80)]).toEqual([32, 48]);
  });
});

describe('the network transport', () => {
  let server: net.Server;
  let received: Buffer[];
  let port: number;
  const listen = (onConnection?: (socket: net.Socket) => void): Promise<void> =>
    new Promise((resolve) => {
      received = [];
      server = net.createServer((socket) => {
        socket.on('data', (d) => received.push(d));
        socket.on('error', () => undefined);
        onConnection?.(socket);
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('sends the bytes and finishes, even when the printer keeps its side of the connection open', async () => {
    await listen(); // never closes its side, like many printers
    const data = Uint8Array.from({ length: 5000 }, (_, i) => i % 256);
    await new NetworkTransport('127.0.0.1', port, 2000).send(data);
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(received).equals(Buffer.from(data))).toBe(true);
  });

  it('reports a printer that cannot be reached', async () => {
    await listen();
    const closedPort = port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(new NetworkTransport('127.0.0.1', closedPort, 1000).send(new Uint8Array([1]))).rejects.toMatchObject({ code: 'unreachable' });
    await listen(); // so afterEach has a server to close
  });

  it('reports a printer that does not answer in time', async () => {
    await listen();
    // A non-routable address never answers: the connection attempt times out.
    await expect(new NetworkTransport('10.255.255.1', 9100, 300).send(new Uint8Array([1]))).rejects.toMatchObject({ code: expect.stringMatching(/timeout|unreachable/) });
  });
});

describe('the USB transport', () => {
  const device = (over: Partial<UsbDeviceLike> = {}, calls: string[] = []): UsbDeviceLike => ({
    vendorId: 0x04b8,
    productId: 0x0e15,
    serialNumber: 'S1',
    manufacturerName: 'Epson',
    productName: 'TM-T20',
    configuration: { configurationValue: 1 },
    configurations: [{ interfaces: [{ interfaceNumber: 0, alternate: { interfaceClass: 7, endpoints: [{ direction: 'in', type: 'bulk', endpointNumber: 1, packetSize: 64 }, { direction: 'out', type: 'bulk', endpointNumber: 2, packetSize: 64 }] } }] }],
    open: async () => void calls.push('open'),
    close: async () => void calls.push('close'),
    selectConfiguration: async () => void calls.push('select'),
    claimInterface: async (n) => void calls.push(`claim ${n}`),
    releaseInterface: async (n) => void calls.push(`release ${n}`),
    transferOut: async (endpoint, data) => (calls.push(`out ${endpoint} ${data.length}`), { status: 'ok' }),
    ...over,
  });
  const usb = (...devices: UsbDeviceLike[]): UsbLike => ({ getDevices: async () => devices });
  const target = { vendorId: 0x04b8, productId: 0x0e15, serialNumber: 'S1' };

  it('finds the printer interface and its bulk-out endpoint, and ignores devices without one', () => {
    expect(findPrinterInterface(device())).toEqual({ interfaceNumber: 0, endpointNumber: 2, packetSize: 64 });
    expect(findPrinterInterface({ configurations: [{ interfaces: [{ interfaceNumber: 0, alternate: { interfaceClass: 3, endpoints: [] } }] }] })).toBeNull();
  });

  it('lists only devices that look like printers', async () => {
    const keyboard = device({ productName: 'Keyboard', configurations: [{ interfaces: [{ interfaceNumber: 0, alternate: { interfaceClass: 3, endpoints: [] } }] }] });
    expect(await listUsbPrinters(usb(device(), keyboard))).toEqual([{ vendorId: 0x04b8, productId: 0x0e15, serialNumber: 'S1', label: 'Epson TM-T20' }]);
  });

  it('opens, claims, sends in packets, then releases and closes', async () => {
    const calls: string[] = [];
    await new UsbTransport(target, () => usb(device({}, calls))).send(new Uint8Array(150));
    expect(calls).toEqual(['open', 'claim 0', 'out 2 64', 'out 2 64', 'out 2 22', 'release 0', 'close']);
  });

  it('lets go of the printer when sending fails, and says why', async () => {
    const calls: string[] = [];
    const failing = device({ transferOut: async () => { throw new Error('stall'); } }, calls);
    await expect(new UsbTransport(target, () => usb(failing)).send(new Uint8Array(10))).rejects.toMatchObject({ code: 'write-failed' });
    expect(calls).toEqual(['open', 'claim 0', 'release 0', 'close']);
  });

  it('reports a printer that is not plugged in, one that cannot be claimed, and a device that is not a printer', async () => {
    await expect(new UsbTransport(target, () => usb()).send(new Uint8Array(1))).rejects.toMatchObject({ code: 'unreachable' });
    const calls: string[] = [];
    const busy = device({ claimInterface: async () => { throw new Error('LIBUSB_ERROR_ACCESS'); } }, calls);
    await expect(new UsbTransport(target, () => usb(busy)).send(new Uint8Array(1))).rejects.toMatchObject({ code: 'busy' });
    expect(calls).toEqual(['open', 'close']); // nothing was claimed, so nothing to release
    const other = device({ configurations: [{ interfaces: [] }] });
    await expect(new UsbTransport(target, () => usb(other)).send(new Uint8Array(1))).rejects.toMatchObject({ code: 'no-printer-interface' });
  });
});

describe('the printer service', () => {
  const settings = (connection: PrinterSettings['printer']['connection']): PrinterSettings => ({ printer: { connection, paperWidthMm: 58 }, shop: { name: 'Shop', address: '', footer: '' } });
  const logged: string[] = [];
  const log = { error: (s: string, m: string) => void logged.push(`error ${s} ${m}`), info: (s: string, m: string) => void logged.push(`info ${s} ${m}`) };
  const make = (transport: PrinterTransport, current: PrinterSettings) => new PrinterService({ settings: () => current, transportFor: () => transport, logo: () => null, log, retryDelayMs: 1 });
  beforeEach(() => (logged.length = 0));

  it('prints a sale through the transport and logs it', async () => {
    const sent: Uint8Array[] = [];
    const service = make({ send: async (b) => void sent.push(b) }, settings({ kind: 'network', host: 'h', port: 9100 }));
    expect(await service.printSale(order())).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(Buffer.from(sent[0]!).toString('latin1')).toContain('SO-1001');
    expect(logged[0]).toMatch(/^info printer Printed SO-1001/);
  });

  it('says so when no printer is set up, without trying anything', async () => {
    const service = make({ send: async () => { throw new Error('should not be called'); } }, settings(null));
    expect(await service.printTest()).toEqual({ ok: false, code: 'not-configured', error: 'No printer is set up' });
    expect(logged[0]).toMatch(/error printer .*not-configured/);
  });

  it('tries a transient failure once more, and gives up after that', async () => {
    let calls = 0;
    const flaky = make({ send: async () => { if (++calls === 1) throw new PrinterError('busy', 'busy'); } }, settings({ kind: 'network', host: 'h', port: 1 }));
    expect(await flaky.printTest()).toEqual({ ok: true });
    expect(calls).toBe(2);
    let always = 0;
    const down = make({ send: async () => { always++; throw new PrinterError('timeout', 'No answer'); } }, settings({ kind: 'network', host: 'h', port: 1 }));
    expect(await down.printTest()).toEqual({ ok: false, code: 'timeout', error: 'No answer' });
    expect(always).toBe(2);
  });

  it('does not retry what retrying cannot fix', async () => {
    let calls = 0;
    const service = make({ send: async () => { calls++; throw new PrinterError('unreachable', 'gone'); } }, settings({ kind: 'network', host: 'h', port: 1 }));
    expect(await service.printTest()).toMatchObject({ ok: false, code: 'unreachable' });
    expect(calls).toBe(1);
    const odd = make({ send: async () => { throw new Error('???'); } }, settings({ kind: 'network', host: 'h', port: 1 }));
    expect(await odd.printTest()).toMatchObject({ ok: false, code: 'unknown' });
  });

  it('runs jobs one at a time, in the order they arrive', async () => {
    const events: string[] = [];
    let n = 0;
    const slow = make({ send: async () => { const id = ++n; events.push(`start ${id}`); await new Promise((r) => setTimeout(r, id === 1 ? 30 : 1)); events.push(`end ${id}`); } }, settings({ kind: 'network', host: 'h', port: 1 }));
    await Promise.all([slow.printTest(), slow.printTest(), slow.printTest()]);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  });

  it('reads the saved settings for every job, so a change applies to the next one', async () => {
    let current = settings(null);
    const service = new PrinterService({ settings: () => current, transportFor: () => ({ send: async () => undefined }), logo: () => null, log, retryDelayMs: 1 });
    expect((await service.printTest()).ok).toBe(false);
    current = settings({ kind: 'network', host: 'h', port: 1 });
    expect((await service.printTest()).ok).toBe(true);
  });
});

describe('the saved printer settings', () => {
  let dir: string;
  let handle: ReturnType<typeof createDatabase>;
  let db: AppDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-printer-'));
    handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
    db = handle.db;
  });
  afterEach(() => {
    handle.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const form = (over: Record<string, unknown> = {}) => ({ printer: { connection: { kind: 'network', host: '192.168.1.50', port: 9100 }, paperWidthMm: 80 }, shop: { name: ' Nena ', address: '', footer: 'Thanks' }, ...over });

  it('starts with no printer, and keeps what was saved', () => {
    expect(loadPrinterSettings(db)).toEqual(DEFAULT_PRINTER_SETTINGS);
    expect(savePrinterSettings(db, form())).toMatchObject({ ok: true });
    expect(loadPrinterSettings(db)).toEqual({ printer: { connection: { kind: 'network', host: '192.168.1.50', port: 9100 }, paperWidthMm: 80 }, shop: { name: 'Nena', address: '', footer: 'Thanks' } });
  });

  it('accepts a USB printer and no printer at all', () => {
    const usb = { kind: 'usb', vendorId: 1208, productId: 3605, serialNumber: 'S1', label: 'Epson TM-T20' };
    expect(sanitizePrinterSettings(form({ printer: { connection: usb, paperWidthMm: 58 } }))).toMatchObject({ printer: { connection: usb } });
    expect(sanitizePrinterSettings(form({ printer: { connection: null, paperWidthMm: 58 } }))).toMatchObject({ printer: { connection: null } });
  });

  it('refuses what is not valid, naming the field', () => {
    const bad = (printer: unknown, shop?: unknown) => sanitizePrinterSettings(form({ printer, ...(shop ? { shop } : {}) }));
    expect(bad({ connection: null, paperWidthMm: 70 })).toMatchObject({ field: 'paperWidth' });
    expect(bad({ connection: { kind: 'network', host: '', port: 9100 }, paperWidthMm: 58 })).toMatchObject({ field: 'host' });
    expect(bad({ connection: { kind: 'network', host: 'bad host!', port: 9100 }, paperWidthMm: 58 })).toMatchObject({ field: 'host' });
    expect(bad({ connection: { kind: 'network', host: 'printer.local', port: 70000 }, paperWidthMm: 58 })).toMatchObject({ field: 'port' });
    expect(bad({ connection: { kind: 'usb', vendorId: 'x', productId: 1 }, paperWidthMm: 58 })).toMatchObject({ field: 'usb' });
    expect(bad({ connection: { kind: 'serial' }, paperWidthMm: 58 })).toMatchObject({ field: null });
    expect(bad({ connection: null, paperWidthMm: 58 }, { name: 'x'.repeat(61) })).toMatchObject({ field: 'shopName' });
    expect(bad({ connection: null, paperWidthMm: 58 }, { name: 'a', address: 'x'.repeat(201) })).toMatchObject({ field: 'shopAddress' });
    expect(bad({ connection: null, paperWidthMm: 58 }, { name: 'a', footer: 'x'.repeat(201) })).toMatchObject({ field: 'shopFooter' });
    expect(savePrinterSettings(db, form({ printer: { connection: null, paperWidthMm: 1 } }))).toMatchObject({ ok: false, field: 'paperWidth' });
    expect(loadPrinterSettings(db)).toEqual(DEFAULT_PRINTER_SETTINGS); // a refused save changes nothing
  });
});
