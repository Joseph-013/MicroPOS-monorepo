import { Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideScanLine } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { CameraScan } from './camera-scan';

/**
 * Opens the camera scanner from inside a dialog, where the top bar and navigation are covered. Put it in the header of
 * any dialog that claims the scanner; it shows only where camera scanning is available (paired phones and tablets).
 * Leaves room on its right for the dialog's close button.
 */
@Component({
  selector: 'app-camera-scan-button',
  imports: [NgIcon, HlmButtonImports],
  providers: [provideIcons({ lucideScanLine })],
  host: { class: 'me-8 shrink-0 empty:hidden' },
  template: `
    @if (camera.available) {
      <button hlmBtn variant="outline" type="button" class="gap-2 px-3" (click)="camera.open()">
        <ng-icon name="lucideScanLine" size="18" strokeWidth="1.5" />
        Scan
      </button>
    }
  `,
})
export class CameraScanButton {
  protected readonly camera = inject(CameraScan);
}
