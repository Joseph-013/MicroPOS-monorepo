import { inject, Service } from '@angular/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { firstValueFrom } from 'rxjs';
import { OrderActionForm, type OrderActionContext, type OrderActionKind, type OrderActionOutcome } from '../pages/orders/order-action-form';
import { BannerService } from './banner';
import { OrdersService } from './data/orders.service';

/**
 * Void and refund from anywhere (the order dialog, the Sales Orders table): opens the confirmation, then reports
 * what happened in a banner and refreshes the order list. Resolves with the outcome, or null when cancelled.
 */
@Service()
export class OrderActions {
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  private readonly orders = inject(OrdersService);

  async run(kind: OrderActionKind, orders: OrderActionContext['orders']): Promise<OrderActionOutcome | null> {
    if (!orders.length) return null;
    const ref = this.dialogs.open<OrderActionOutcome, OrderActionContext>(OrderActionForm, {
      // A service dialog needs an id of its own so it never clashes with the order dialog underneath.
      id: 'order-action',
      contentClass: 'w-[min(30rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { kind, orders },
    });
    const outcome = (await firstValueFrom(ref.closed$)) ?? null;
    if (!outcome) return null;
    await this.orders.load();
    this.report(outcome);
    return outcome;
  }

  private report(outcome: OrderActionOutcome): void {
    const { done, failed } = outcome;
    const verb = outcome.kind === 'void' ? 'voided' : 'refunded';
    if (done.length) {
      const what = done.length === 1 ? `Order ${done[0]!.orderNumber}` : `${done.length} orders`;
      const refund = done.length === 1 && done[0]!.refundOrderNumber ? ` (${done[0]!.refundOrderNumber})` : '';
      this.banner.success(`${what} ${verb}${refund}`, { key: 'order-action', duration: 'long' });
    }
    if (failed.length) {
      this.banner.error(failed.map((f) => f.error).join('. '), { key: 'order-action-failed', duration: 'long' });
    }
  }
}
