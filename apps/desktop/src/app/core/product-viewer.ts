import { inject, Service } from '@angular/core';
import type { ProductRecord } from '@micropos/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { ProductView, type ProductViewContext } from '../pages/products/product-view';
import { ProductsService } from './data/products.service';
import { ParamDialogViewer } from './param-dialog-viewer';

/** `?view-product=<product id>` on any page opens that product in a dialog over the page. */
export const VIEW_PRODUCT_PARAM = 'view-product';

/** Opens the product named by `?view-product=<id>` in view mode, deleted ones included (see `ParamDialogViewer`). */
@Service()
export class ProductViewer extends ParamDialogViewer<ProductRecord> {
  private readonly dialogs = inject(HlmDialogService);
  private readonly products = inject(ProductsService);
  protected readonly missingText = 'Product not found';

  constructor() {
    super(VIEW_PRODUCT_PARAM);
  }

  protected async load(id: string): Promise<ProductRecord | null> {
    return (await this.products.find(id)) ?? null;
  }

  protected show(product: ProductRecord) {
    return this.dialogs.open<unknown, ProductViewContext>(ProductView, {
      id: 'product-view',
      contentClass: 'w-[min(30rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
      context: { product, mode: 'view' },
    });
  }
}
