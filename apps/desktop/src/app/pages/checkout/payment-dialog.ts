import { NgTemplateOutlet } from '@angular/common';
import { Component, type TemplateRef } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';

export interface PaymentDialogContext {
  template: TemplateRef<unknown>;
}

/** Shows Checkout's payment controls (its `#payment` template) in a dialog; the dialog service only opens components. */
@Component({
  imports: [NgTemplateOutlet],
  // The card's spacing variable is defined by the card itself; the dialog has none, so it supplies it (and the card's vertical padding).
  host: { class: 'flex min-h-0 flex-col py-(--card-spacing) [--card-spacing:--spacing(4)]' },
  template: `<ng-container [ngTemplateOutlet]="context.template" />`,
})
export class PaymentDialog {
  protected readonly context = injectBrnDialogContext<PaymentDialogContext>();
}
