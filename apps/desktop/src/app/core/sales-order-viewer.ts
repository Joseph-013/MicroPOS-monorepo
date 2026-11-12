import { DestroyRef, inject, Service } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { filter } from 'rxjs';
import { SalesOrderForm, type SalesOrderFormContext } from '../pages/orders/sales-order-form';
import { BannerService } from './banner';
import { OrdersService } from './data/orders.service';

/** `?view-sales-order=<order id>` on any page opens that order in a dialog over the page. */
export const VIEW_SALES_ORDER_PARAM = 'view-sales-order';

/**
 * Opens the sales order named by the `view-sales-order` query parameter, on top of whatever page is showing, and
 * removes the parameter again when the dialog closes. Anything can link to an order by setting the parameter
 * (`open(id)`, or a `routerLink` with `[queryParams]`); the address bar and back button then agree with the screen.
 * Started once at launch (`App` injects it).
 */
@Service()
export class SalesOrderViewer {
  private readonly router = inject(Router);
  private readonly dialogs = inject(HlmDialogService);
  private readonly orders = inject(OrdersService);
  private readonly banner = inject(BannerService);

  /** The order whose dialog is open (or being fetched). */
  private shown: string | null = null;
  private ref: BrnDialogRef<unknown> | null = null;

  constructor() {
    const subscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => void this.sync());
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /** Shows an order over the current page by setting the query parameter. */
  open(id: string): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [VIEW_SALES_ORDER_PARAM]: id }, queryParamsHandling: 'merge' });
  }

  private requested(): string | null {
    return this.router.parseUrl(this.router.url).queryParams[VIEW_SALES_ORDER_PARAM] ?? null;
  }

  /** Makes the dialog match the address: open for a new id, closed when the parameter is gone. */
  private async sync(): Promise<void> {
    const id = this.requested();
    if (id === this.shown) return;
    if (this.ref) {
      this.ref.close();
      this.ref = null;
    }
    this.shown = id;
    if (!id) return;

    const order = await this.orders.get(id);
    if (this.shown !== id) return; // the address changed while the order was loading
    if (!order) {
      this.banner.error('Order not found', { key: 'sales-order-missing' });
      this.shown = null;
      await this.clear();
      return;
    }
    const ref = this.dialogs.open<unknown, SalesOrderFormContext>(SalesOrderForm, {
      id: 'sales-order',
      contentClass: 'w-[min(36rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { order, mode: 'view' },
    });
    this.ref = ref;
    ref.closed$.subscribe(() => {
      if (this.ref !== ref) return; // closed because the address moved on
      this.ref = null;
      this.shown = null;
      void this.clear();
    });
  }

  /** Takes the parameter out of the address (replacing the entry, so Back does not reopen the dialog). */
  private clear(): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [VIEW_SALES_ORDER_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
