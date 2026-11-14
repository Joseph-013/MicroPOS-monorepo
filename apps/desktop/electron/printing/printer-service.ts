import {
  buildDailyReceipt,
  buildSaleReceipt,
  type DailyReport,
  buildTestReceipt,
  columnsFor,
  dotsFor,
  type PrinterConnection,
  type PrinterErrorCode,
  type PrinterSettings,
  type PrintResult,
  type ReceiptDocument,
  type ReceiptShop,
  type SalesOrderDetail,
} from '@micropos/core';
import type { Bitmap } from './bitmap';
import { encodeReceipt } from './escpos';
import { isTransient, PrinterError } from './errors';
import type { ReceiptImageSink } from './receipt-image';
import type { PrinterTransport } from './transports/types';

export interface PrinterServiceDeps {
  settings: () => PrinterSettings;
  /** The transport for a saved connection. */
  transportFor: (connection: PrinterConnection) => PrinterTransport;
  /** The shop logo scaled and centred for the paper, or null when there is none. */
  logo: (paperWidthDots: number) => Bitmap | null;
  log: { error(source: string, message: string, details?: unknown): void; info(source: string, message: string, details?: unknown): void };
  /** A stand-in for the printer that saves each receipt as an image (debug); used instead of the printer while it is on. */
  images?: Pick<ReceiptImageSink, 'enabled' | 'save'>;
  /** How long to wait before the one retry of a transient failure. */
  retryDelayMs?: number;
  now?: () => number;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The receipt printer, owned by the main process (the local business server): anything that wants a receipt printed
 * (the till's window now, phones over the local network later) calls `print`, `printSale` or `printTest`. Jobs run one
 * at a time in the order they arrive. Each job reads the saved settings, builds the bytes, and sends them through a
 * transport that connects, writes and lets go; a transient failure (printer busy, a timeout) is tried once more.
 */
export class PrinterService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PrinterServiceDeps) {}

  /** Prints a receipt document. Never throws: the outcome is the result, so callers (and, later, remote clients) can report it. */
  print(doc: ReceiptDocument, label = 'receipt'): Promise<PrintResult> {
    const job = this.queue.then(() => this.run(doc, label));
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** The receipt of a recorded sale, with the shop's header and footer. */
  printSale(order: SalesOrderDetail): Promise<PrintResult> {
    const { printer, shop } = this.deps.settings();
    return this.print(buildSaleReceipt(order, this.shop(shop, printer.paperWidthMm), columnsFor(printer.paperWidthMm)), order.orderNumber);
  }

  /** The daily sales report of a day, with the shop's name at the top. */
  printDaily(report: DailyReport): Promise<PrintResult> {
    const { printer, shop } = this.deps.settings();
    return this.print(buildDailyReceipt(report, this.shop(shop, printer.paperWidthMm), columnsFor(printer.paperWidthMm)), `report ${report.day}`);
  }

  /** A short page to check the printer and its paper width. */
  printTest(): Promise<PrintResult> {
    const { printer, shop } = this.deps.settings();
    return this.print(buildTestReceipt(this.shop(shop, printer.paperWidthMm), columnsFor(printer.paperWidthMm), (this.deps.now ?? Date.now)()), 'test page');
  }

  private shop(shop: PrinterSettings['shop'], paperWidthMm: PrinterSettings['printer']['paperWidthMm']): ReceiptShop {
    return { ...shop, hasLogo: this.deps.logo(dotsFor(paperWidthMm)) !== null };
  }

  private async run(doc: ReceiptDocument, label: string): Promise<PrintResult> {
    const { printer } = this.deps.settings();
    if (this.deps.images?.enabled()) {
      const saved = await this.deps.images.save(doc, label, printer.paperWidthMm);
      if (saved.ok) this.deps.log.info('printer', `Saved ${label} as an image (${saved.savedTo})`);
      else this.fail(saved.code, saved.error, label);
      return saved;
    }
    if (!printer.connection) return this.fail('not-configured', 'No printer is set up', label);
    let bytes: Uint8Array;
    try {
      bytes = encodeReceipt(doc, { paperWidthMm: printer.paperWidthMm, logo: this.deps.logo(dotsFor(printer.paperWidthMm)) });
    } catch (error) {
      this.deps.log.error('printer', `Could not build ${label}`, error);
      return { ok: false, code: 'unknown', error: 'The receipt could not be prepared' };
    }
    const transport = this.deps.transportFor(printer.connection);
    for (let attempt = 1; ; attempt++) {
      try {
        await transport.send(bytes);
        this.deps.log.info('printer', `Printed ${label} (${bytes.length} bytes)`);
        return { ok: true };
      } catch (error) {
        const code: PrinterErrorCode = error instanceof PrinterError ? error.code : 'unknown';
        if (attempt === 1 && isTransient(code)) {
          await wait(this.deps.retryDelayMs ?? 750);
          continue;
        }
        return this.fail(code, error instanceof PrinterError ? error.message : 'The printer did not respond', label, error);
      }
    }
  }

  private fail(code: PrinterErrorCode, message: string, label: string, cause?: unknown): PrintResult {
    this.deps.log.error('printer', `Could not print ${label}: ${message} [${code}]`, cause instanceof Error && !(cause instanceof PrinterError) ? cause : undefined);
    return { ok: false, code, error: message };
  }
}
