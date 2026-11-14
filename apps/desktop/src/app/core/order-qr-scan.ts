import { DestroyRef, inject, Service } from '@angular/core';
import { parseOrderQr } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';
import { BannerService } from './banner';
import { SalesOrderViewer } from './sales-order-viewer';
import { ScannerService } from './scanner';

/**
 * Scanning the QR code on a receipt (the code `MICROPOS-ORDER-<order number>`, see `order-qr` in core) opens that sale's
 * dialog over whatever page is showing, wherever the scanner is otherwise claimed (Checkout, a form...). Only people who
 * may view sales orders get it; for anyone else the scan is just taken and ignored with a note. Started once at the
 * root. Anything that is not an order code is left to the pages as before.
 */
@Service()
export class OrderQrScan {
  private readonly api = inject(DESKTOP_API);
  private readonly auth = inject(AuthService);
  private readonly banner = inject(BannerService);
  private readonly viewer = inject(SalesOrderViewer);

  constructor() {
    const remove = inject(ScannerService).addHook((code) => this.handle(code));
    inject(DestroyRef).onDestroy(remove);
  }

  private handle(code: string): boolean {
    const orderNumber = parseOrderQr(code);
    if (!orderNumber) return false;
    if (!this.auth.can('orders.view')) {
      this.banner.warning('You cannot open sales orders', { key: 'order-qr' });
      return true;
    }
    void this.open(orderNumber);
    return true;
  }

  private async open(orderNumber: string): Promise<void> {
    try {
      const id = await this.api?.orders.idByNumber(orderNumber);
      if (id) await this.viewer.open(id);
      else this.banner.warning(`Order ${orderNumber} not found`, { key: 'order-qr', duration: 'long' });
    } catch (error) {
      console.error('Failed to open the scanned order', error);
      this.banner.error('Could not open the order', { key: 'order-qr' });
    }
  }
}
