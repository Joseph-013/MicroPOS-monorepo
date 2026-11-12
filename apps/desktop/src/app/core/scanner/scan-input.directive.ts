import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';
import { Scan, ScannerService } from './scanner.service';

/**
 * Makes a text field accept barcode scans. While the field is focused a scan sets its value to the code (and
 * fires its `input` event, so bindings update) and `(scan)` emits the code. Other claims do not receive that
 * scan. Fields without this directive never receive scanned text; scans go to the claims instead.
 *
 *   <input hlmInput appScanInput (scan)="lookup($event.code)" />
 */
@Directive({ selector: 'input[appScanInput], textarea[appScanInput]', host: { 'data-scan-input': '' } })
export class ScanInputDirective {
  readonly scan = output<Scan>();

  constructor() {
    const field = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef).nativeElement;
    const unregister = inject(ScannerService).registerInput(field, (scan) => {
      field.value = scan.code;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      this.scan.emit(scan);
    });
    inject(DestroyRef).onDestroy(unregister);
  }
}
