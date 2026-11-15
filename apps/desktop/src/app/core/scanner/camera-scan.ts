import { inject, Service, signal } from '@angular/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { cameraScanSupported } from './camera-detector';
import { CameraScanDialog } from './camera-scan-dialog';

/** Opens the camera scanner (see `CameraScanDialog`). Offered on paired phones and tablets; `available` says whether to show the button. */
@Service()
export class CameraScan {
  private readonly dialogs = inject(HlmDialogService);
  private shown = false;
  /** The camera is shown inside the dialog that has the Scan button (`CameraScanInline`), instead of a dialog of its own. */
  readonly inline = signal(false);
  readonly available = cameraScanSupported();

  open(): void {
    if (!this.available || this.shown) return;
    this.shown = true;
    const ref = this.dialogs.open(CameraScanDialog, { id: 'camera-scan', contentClass: 'w-[min(30rem,95vw)] max-w-none sm:max-w-none max-h-[95vh]' });
    ref.closed$.subscribe(() => (this.shown = false));
  }
}
