import { Directive, input } from '@angular/core';
import { BrnDialogClose } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';

/**
 * The confirming button of an alert dialog. It runs the `(click)` handler and then closes the dialog
 * (the generated version did not close it, which left confirmations hanging open).
 */
@Directive({
  selector: 'button[hlmAlertDialogAction]',
  exportAs: 'hlmAlertDialogAction',
  hostDirectives: [BrnDialogClose, { directive: HlmButton, inputs: ['variant', 'size'] }],
  host: { 'data-slot': 'alert-dialog-action', '[type]': 'type()' },
})
export class HlmAlertDialogAction {
  public readonly type = input<'button' | 'submit' | 'reset'>('button');
}
