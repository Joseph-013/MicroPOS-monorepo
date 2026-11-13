import { inject, Service } from '@angular/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { ProductForm, type ProductFormContext } from '../pages/products/product-form';
import { BannerService } from './banner';
import { ParamDialogViewer } from './param-dialog-viewer';

/** `?new-product=<barcode>` on any page opens the add-product form over it with that barcode filled in. */
export const NEW_PRODUCT_PARAM = 'new-product';

/**
 * Opens the add-product form named by `?new-product=<barcode>` (see `ParamDialogViewer`), so a product can be created
 * where it was found missing (a scan while receiving stock) without visiting the Products page. The new product
 * starts with stock tracked by quantity, since it is being received. Link to it with `viewer.open(code)`.
 */
@Service()
export class NewProductViewer extends ParamDialogViewer<string> {
  private readonly dialogs = inject(HlmDialogService);
  private readonly toasts = inject(BannerService);
  protected readonly missingText = 'Barcode missing';

  constructor() {
    super(NEW_PRODUCT_PARAM);
  }

  protected load(code: string): Promise<string | null> {
    return Promise.resolve(code.trim() || null);
  }

  protected show(code: string) {
    const ref = this.dialogs.open<boolean, ProductFormContext>(ProductForm, {
      // Its own id, as on the Products page (the Delete confirmation inside needs it).
      id: 'product-form',
      contentClass: 'w-[min(40rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { prefill: { barcode: code, tracking: 'quantity' } },
    });
    ref.closed$.subscribe((saved) => {
      if (saved) this.toasts.success('Product added', { key: 'product-saved' });
    });
    return ref;
  }
}
