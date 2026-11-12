import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { KioskFocusService } from './core/kiosk/kiosk-focus.service';
import { NavRail } from './core/nav-rail';
import { ScannerService } from './core/scanner';

@Component({
  imports: [NavRail, RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  // Global listeners, started at launch.
  private readonly scanner = inject(ScannerService);
  private readonly kioskFocus = inject(KioskFocusService);
}
