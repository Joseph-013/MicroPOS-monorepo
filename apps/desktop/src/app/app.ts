import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DesktopApiGuard } from './core/api/desktop-api-guard';
import { BannerHost, BannerService } from './core/banner';
import { OnScreenKeyboardService } from './core/keyboard';
import { KioskFocusService } from './core/kiosk/kiosk-focus.service';
import { NavRail } from './core/nav-rail';
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
  /** Height of the banner strip (`h-9`); pages and the nav rail read it as `--banner-offset`. */
  protected readonly bannerOffset = inject(BannerService).reserveSpace;

  constructor() {
    void this.apiGuard.check();
  }
}
