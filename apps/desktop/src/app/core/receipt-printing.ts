import { inject, Service } from '@angular/core';
import type { PrintResult } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { BannerService } from './banner';

/** The file name at the end of a path (either kind of slash). */
const fileName = (path: string): string => path.split(/[\\\\/]/).pop() ?? path;

/**
 * Prints a recorded sale's receipt. The main process does the printing (or, while Settings > Debug says so, saves the
 * receipt as an image); this asks for it and reports how it went. One place for the order dialog, the Sales Orders
 * menu and Checkout, so they all say the same thing.
 */
@Service()
export class ReceiptPrinting {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);

  /** Asks for the receipt of an order; never throws. */
  async print(orderId: string): Promise<PrintResult> {
    try {
      return (await this.api?.printer.printOrder(orderId)) ?? { ok: false, code: 'unknown', error: 'Not connected to the database' };
    } catch (error) {
      console.error('Failed to print the receipt', error);
      return { ok: false, code: 'unknown', error: 'Could not print the receipt' };
    }
  }

  /** What to say about a finished print: sent to the printer, saved as an image, or why it did not work. */
  describe(result: PrintResult, orderNumber: string): { text: string; ok: boolean } {
    if (!result.ok) return { ok: false, text: `Receipt for ${orderNumber} not printed: ${result.error}` };
    return { ok: true, text: result.savedTo ? `Receipt for ${orderNumber} saved as an image: ${fileName(result.savedTo)}` : `Receipt for ${orderNumber} sent to the printer` };
  }

  /** Prints and shows the outcome in a banner. */
  async printWithBanner(orderId: string, orderNumber: string): Promise<void> {
    const outcome = this.describe(await this.print(orderId), orderNumber);
    if (outcome.ok) this.banner.success(outcome.text, { key: 'print-receipt', duration: 'long' });
    else this.banner.error(outcome.text, { key: 'print-receipt', duration: 'long' });
  }
}
