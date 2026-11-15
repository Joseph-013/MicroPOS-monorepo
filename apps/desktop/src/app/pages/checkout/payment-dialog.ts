import { NgTemplateOutlet } from '@angular/common';
import { Component, type TemplateRef } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';

export interface PaymentDialogContext {
  template: TemplateRef<unknown>;
}

/** Shows Checkout's payment controls (its `#payment` template) in a dialog; the dialog service only opens components. */
@Component({
  imports: [NgTemplateOutlet],
  host: { class: 'contents' },
  template: `<ng-container [ngTemplateOutlet]="context.template" />`,
})
export class PaymentDialog {
  protected readonly context = injectBrnDialogContext<PaymentDialogContext>();
}
