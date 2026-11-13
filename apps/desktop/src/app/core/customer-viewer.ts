import { inject, Service } from '@angular/core';
import type { CustomerAccount } from '@micropos/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { CustomerAccountForm, type CustomerAccountContext } from '../pages/customers/customer-account';
import { CustomersService } from './data/customers.service';
import { ParamDialogViewer } from './param-dialog-viewer';

/** `?view-customer=<customer id>` on any page opens that customer's account in a dialog over the page. */
export const VIEW_CUSTOMER_PARAM = 'view-customer';

/** Opens the account named by `?view-customer=<id>` (see `ParamDialogViewer`). */
@Service()
export class CustomerViewer extends ParamDialogViewer<CustomerAccount> {
  private readonly dialogs = inject(HlmDialogService);
  private readonly customers = inject(CustomersService);
  protected readonly missingText = 'Customer not found';

  constructor() {
    super(VIEW_CUSTOMER_PARAM);
  }

  protected load(id: string): Promise<CustomerAccount | null> {
    return this.customers.account(id);
  }

  protected show(account: CustomerAccount) {
    return this.dialogs.open<unknown, CustomerAccountContext>(CustomerAccountForm, {
      id: 'customer-account',
      contentClass: 'w-[min(34rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { account },
    });
  }
}
