import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';
import { Scan, ScannerService } from './scanner.service';

/**
 * Makes a text field accept barcode scans. While the field is focused a scan types into it like
 * normal input (Enter included, so a surrounding form or search can react) and `(scan)` emits the
 * code. Other claims do not receive that scan. Fields without this directive never keep scanned text.
 *
 *   <input hlmInput appScanInput (scan)="lookup($event.code)" />
 */
@Directive({ selector: 'input[appScanInput], textarea[appScanInput]', host: { 'data-scan-input': '' } })
export class ScanInputDirective {
  readonly scan = output<Scan>();

  constructor() {
    const unregister = inject(ScannerService).registerInput(inject<ElementRef<Element>>(ElementRef).nativeElement, (scan) =>
      this.scan.emit(scan),
    );
    inject(DestroyRef).onDestroy(unregister);
  }
}
