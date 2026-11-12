import { inject, Service } from '@angular/core';
import type { SalesOrderDetail } from '@micropos/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { SalesOrderForm, type SalesOrderFormContext } from '../pages/orders/sales-order-form';
import { OrdersService } from './data/orders.service';
import { ParamDialogViewer } from './param-dialog-viewer';

/** `?view-sales-order=<order id>` on any page opens that order in a dialog over the page. */
export const VIEW_SALES_ORDER_PARAM = 'view-sales-order';

/** Opens the sales order named by `?view-sales-order=<id>` in view mode (see `ParamDialogViewer`). */
@Service()
export class SalesOrderViewer extends ParamDialogViewer<SalesOrderDetail> {
  private readonly dialogs = inject(HlmDialogService);
  private readonly orders = inject(OrdersService);
  protected readonly missingText = 'Order not found';

  constructor() {
    super(VIEW_SALES_ORDER_PARAM);
  }

  protected load(id: string): Promise<SalesOrderDetail | null> {
    return this.orders.get(id);
  }

  protected show(order: SalesOrderDetail) {
    return this.dialogs.open<unknown, SalesOrderFormContext>(SalesOrderForm, {
      id: 'sales-order',
      contentClass: 'w-[min(36rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { order, mode: 'view' },
    });
  }
}
