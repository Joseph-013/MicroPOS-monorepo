import { inject, Service } from '@angular/core';
import type { PurchaseDetail } from '@micropos/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { PurchaseDetailForm, type PurchaseDetailContext } from '../pages/purchases/purchase-detail';
import { PurchasesService } from './data/purchases.service';
import { ParamDialogViewer } from './param-dialog-viewer';

/** `?view-purchase=<purchase order id>` on any page opens that purchase order in a dialog over the page. */
export const VIEW_PURCHASE_PARAM = 'view-purchase';

/** Opens the purchase order named by `?view-purchase=<id>` (see `ParamDialogViewer`). */
@Service()
export class PurchaseViewer extends ParamDialogViewer<PurchaseDetail> {
  private readonly dialogs = inject(HlmDialogService);
  private readonly purchases = inject(PurchasesService);
  protected readonly missingText = 'Purchase order not found';

  constructor() {
    super(VIEW_PURCHASE_PARAM);
  }

  protected load(id: string): Promise<PurchaseDetail | null> {
    return this.purchases.get(id);
  }

  protected show(purchase: PurchaseDetail) {
    return this.dialogs.open<unknown, PurchaseDetailContext>(PurchaseDetailForm, {
      id: 'purchase-detail',
      contentClass: 'w-[min(34rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { purchase },
    });
  }
}
