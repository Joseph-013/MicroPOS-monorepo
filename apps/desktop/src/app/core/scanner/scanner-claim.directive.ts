import { booleanAttribute, Directive, effect, inject, input, output } from '@angular/core';
import { Scan, ScannerService } from './scanner.service';

/**
 * Takes control of the scanner while the element exists (and `appScannerClaim` is not false),
 * emitting each scan to `(scan)`. Control returns to the previous owner when the element is
 * destroyed, e.g. when a dialog closes.
 *
 *   <div appScannerClaim (scan)="add($event.code)">...</div>
 *   <div [appScannerClaim]="isOpen" (scan)="...">...</div>
 */
@Directive({ selector: '[appScannerClaim]' })
export class ScannerClaimDirective {
  private readonly scanner = inject(ScannerService);

  readonly active = input(true, { alias: 'appScannerClaim', transform: booleanAttribute });
  readonly scan = output<Scan>();

  constructor() {
    effect((onCleanup) => {
      if (!this.active()) return;
      const claim = this.scanner.claim((scan) => this.scan.emit(scan));
      onCleanup(() => claim.release());
    });
  }
}
