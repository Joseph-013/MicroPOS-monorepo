import { Component, inject } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';

export type CopyChoice = 'add' | 'replace';

export interface CopyConfirmContext {
  /** Items already on the Checkout order. */
  existingItems: number;
  orderNumber: string;
}

/** Asked before a sale's items are copied to a Checkout that already has an order in progress. Closes with the choice, or nothing when cancelled. */
@Component({
  imports: [HlmButtonImports, HlmDialogImports],
  host: { class: 'contents' },
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Checkout has an order in progress</h3>
      <p hlmDialogDescription>
        It holds {{ context.existingItems }} {{ context.existingItems === 1 ? 'item' : 'items' }}. Copy the items of {{ context.orderNumber }} on top of it, or overwrite it (its items, discount, customer and note are cleared).
      </p>
    </hlm-dialog-header>
    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn variant="destructive" type="button" class="px-5" (click)="ref.close('replace')">Overwrite</button>
      <button hlmBtn type="button" class="px-5" (click)="ref.close('add')">Copy on top</button>
    </hlm-dialog-footer>
  `,
})
export class CheckoutCopyConfirm {
  protected readonly context = injectBrnDialogContext<CopyConfirmContext>();
  protected readonly ref = inject(BrnDialogRef<CopyChoice>);
}
