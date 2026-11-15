import { Component } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { CameraScanPanel } from './camera-scan-panel';

/** The camera scanner in a dialog of its own (opened from the top bar or navigation, where no other dialog is open). Done closes it. */
@Component({
  host: { class: 'contents' },
  imports: [CameraScanPanel, HlmButtonImports, HlmDialogImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Scan with camera</h3>
      <p hlmDialogDescription>Hold a barcode or QR code in front of the camera.</p>
    </hlm-dialog-header>
    <app-camera-scan-panel />
    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose type="button" class="px-6">Done</button>
    </hlm-dialog-footer>
  `,
})
export class CameraScanDialog {}
