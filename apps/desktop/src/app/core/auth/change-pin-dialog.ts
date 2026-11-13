import { Component, inject } from '@angular/core';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { ChangePinForm } from './change-pin-form';

/** Change PIN, opened from Settings. Closes with `true` once the PIN is changed. */
@Component({
  host: { class: 'contents' },
  imports: [ChangePinForm, HlmDialogImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Change PIN</h3>
    </hlm-dialog-header>
    <div class="-mx-2 min-h-0 overflow-y-auto px-2 py-1">
      <app-change-pin-form (changed)="ref.close(true)" />
    </div>
  `,
})
export class ChangePinDialog {
  protected readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
}
