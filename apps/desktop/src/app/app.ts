import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DesktopApiGuard } from './core/api/desktop-api-guard';
import { BannerHost, BannerService } from './core/banner';
import { OnScreenKeyboardService } from './core/keyboard';
import { CustomerViewer } from './core/customer-viewer';
import { KioskFocusService } from './core/kiosk/kiosk-focus.service';
import { NavRail } from './core/nav-rail';
import { ProductViewer } from './core/product-viewer';
import { SalesOrderViewer } from './core/sales-order-viewer';
import { ScannerService } from './core/scanner';
import { TooSmallOverlay } from './core/viewport/too-small-overlay';

@Component({
  imports: [BannerHost, NavRail, RouterOutlet, TooSmallOverlay],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  // Global listeners, started at launch.
  private readonly scanner = inject(ScannerService);
  private readonly kioskFocus = inject(KioskFocusService);
  private readonly onScreenKeyboard = inject(OnScreenKeyboardService);
  private readonly apiGuard = inject(DesktopApiGuard);
  /** Opens `?view-sales-order=<id>` in a dialog over any page. */
  private readonly salesOrderViewer = inject(SalesOrderViewer);
  /** Opens `?view-product=<id>` in a read-only product dialog over any page. */
  private readonly productViewer = inject(ProductViewer);
  /** Opens `?view-customer=<id>` in a customer account dialog over any page. */
  private readonly customerViewer = inject(CustomerViewer);
  /** Height of the banner strip (`h-9`); pages and the nav rail read it as `--banner-offset`. */
  protected readonly bannerOffset = inject(BannerService).reserveSpace;

  constructor() {
    void this.apiGuard.check();
  }
}
