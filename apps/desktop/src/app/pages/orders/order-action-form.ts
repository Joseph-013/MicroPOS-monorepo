import { Component, computed, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { OrdersService } from '../../core/data/orders.service';
import { MoneyPipe } from '../../core/money.pipe';
import { ConfirmItems, type ConfirmItem } from '../../core/ui/confirm-items';

export type OrderActionKind = 'void' | 'refund';

export interface OrderActionContext {
  kind: OrderActionKind;
  orders: { id: string; orderNumber: string; total: number }[];
}

/** What happened to each order; the dialog closes with this (or with nothing when cancelled). */
export interface OrderActionOutcome {
  kind: OrderActionKind;
  done: { orderId: string; orderNumber: string; refundOrderId?: string; refundOrderNumber?: string }[];
  failed: { orderNumber: string; error: string }[];
}

/** Confirms voiding or refunding one or several orders: lists them, asks for the reason, then does it. */
@Component({
  host: { class: 'contents' },
  imports: [ConfirmItems, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ title() }}</h3>
      <p hlmDialogDescription>{{ description() }}</p>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <app-confirm-items [items]="items()" />
      @if (kind === 'refund') {
        <p class="flex justify-between text-sm"><span>Refund total</span><span>{{ total() }}</span></p>
      }
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="order-reason">Reason</label>
        <input
          hlmInput
          id="order-reason"
          type="text"
          maxlength="200"
          autocomplete="off"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
        />
      </div>
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5" [disabled]="busy()">Cancel</button>
      <button hlmBtn [variant]="kind === 'void' ? 'destructive' : 'default'" type="button" class="px-6" [disabled]="busy() || !reason().trim()" (click)="submit()">
        {{ kind === 'void' ? 'Void' : 'Refund' }}
      </button>
    </hlm-dialog-footer>
  `,
})
export class OrderActionForm {
  private readonly context = injectBrnDialogContext<OrderActionContext>();
  private readonly ref = inject<BrnDialogRef<OrderActionOutcome>>(BrnDialogRef);
  private readonly service = inject(OrdersService);
  private readonly money = new MoneyPipe();

  protected readonly kind = this.context.kind;
  protected readonly reason = signal('');
  protected readonly busy = signal(false);

  protected readonly title = computed(() => {
    const verb = this.kind === 'void' ? 'Void' : 'Refund';
    const orders = this.context.orders;
    return orders.length === 1 ? `${verb} ${orders[0]!.orderNumber}?` : `${verb} ${orders.length} orders?`;
  });
  protected readonly description = computed(() =>
    this.kind === 'void'
      ? 'The order is cancelled and its stock goes back.'
      : 'A refund order is recorded, the payment is reversed and the stock goes back.',
  );
  protected readonly items = computed<ConfirmItem[]>(() => this.context.orders.map((o) => ({ label: o.orderNumber, detail: this.money.transform(o.total) })));
  protected readonly total = computed(() => this.money.transform(this.context.orders.reduce((sum, o) => sum + o.total, 0)));

  protected async submit(): Promise<void> {
    const reason = this.reason().trim();
    if (!reason || this.busy()) return;
    this.busy.set(true);
    const outcome: OrderActionOutcome = { kind: this.kind, done: [], failed: [] };
    for (const order of this.context.orders) {
      const result = await this.service.reverse(this.kind, order.id, reason);
      if (result.ok) outcome.done.push({ orderId: result.orderId, orderNumber: result.orderNumber, refundOrderId: result.refundOrderId, refundOrderNumber: result.refundOrderNumber });
      else outcome.failed.push({ orderNumber: order.orderNumber, error: result.error });
    }
    this.ref.close(outcome);
  }
}
