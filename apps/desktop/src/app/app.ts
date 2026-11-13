import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DesktopApiGuard } from './core/api/desktop-api-guard';
import { BannerHost, BannerService } from './core/banner';
import { OnScreenKeyboardService } from './core/keyboard';
import { CustomerDisplayService } from './core/customer-display.service';
import { CustomerViewer } from './core/customer-viewer';
import { LastRoute } from './core/last-route';
import { KioskFocusService } from './core/kiosk/kiosk-focus.service';
import { NavRail } from './core/nav-rail';
import { NewProductViewer } from './core/new-product-viewer';
import { ProductViewer } from './core/product-viewer';
import { PurchaseViewer } from './core/purchase-viewer';
import { SalesOrderViewer } from './core/sales-order-viewer';
import { ScannerService } from './core/scanner';
import { AppSettings } from './core/settings/app-settings.service';
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
  /** Opens `?new-product=<barcode>` in the add-product form over any page. */
  private readonly newProductViewer = inject(NewProductViewer);
  /** Opens `?view-customer=<id>` in a customer account dialog over any page. */
  private readonly customerViewer = inject(CustomerViewer);
  /** Opens `?view-purchase=<id>` in a purchase order dialog over any page. */
  private readonly purchaseViewer = inject(PurchaseViewer);
  /** Height of the banner strip (`h-9`); pages and the nav rail read it as `--banner-offset`. */
  protected readonly bannerOffset = inject(BannerService).reserveSpace;

  /** True in the customer-facing window, which shows the display page alone: no navigation, banner or start-up work. */
  protected readonly isDisplay = location.hash.startsWith('#/customer-display');

  constructor() {
    if (this.isDisplay) return;
    void this.apiGuard.check();
    inject(LastRoute).track();
    // The customer display opens with the app when asked to in Settings (it remembers its monitor and position).
    if (inject(AppSettings).customerDisplayOnStart()) void inject(CustomerDisplayService).show();
  }
}
