import { Component, inject } from '@angular/core';
import { CameraScan } from './camera-scan';
import { CameraScanPanel } from './camera-scan-panel';

/** Where a dialog shows the camera when its Scan button (`CameraScanButton`) is on: put it in the dialog's header under the title. */
@Component({
  selector: 'app-camera-scan-inline',
  imports: [CameraScanPanel],
  host: { class: 'block min-w-0 empty:hidden' },
  template: `
    @if (camera.inline()) {
      <app-camera-scan-panel />
    }
  `,
})
export class CameraScanInline {
  protected readonly camera = inject(CameraScan);
}
