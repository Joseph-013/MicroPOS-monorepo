import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMinus, lucidePlus } from '@ng-icons/lucide';
import type { CatalogProduct } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { CatalogService } from '../../core/data/catalog.service';
import { MoneyPipe } from '../../core/money.pipe';
import { claimScanner } from '../../core/scanner';

export const ALL_CATEGORIES = 'All categories';

interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  /** Unit price in cents. */
  unitPrice: number;
}

/** Checkout: order lines on the left, payment controls on the right, item browser in a dialog. */
@Component({
  imports: [
    NgIcon,
    MoneyPipe,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmComboboxImports,
    HlmDialogImports,
    HlmInputImports,
    HlmLabelImports,
    HlmTabsImports,
  ],
  providers: [provideIcons({ lucideMinus, lucidePlus })],
  templateUrl: './checkout.html',
})
export class CheckoutPage {
  protected readonly catalog = inject(CatalogService);

  // Order (not saved yet: sales are not wired to the database).
  protected readonly lines = signal<OrderLine[]>([]);
  protected readonly unknownCode = signal('');
  protected readonly lineTotals = computed(() => this.lines().map((l) => ({ ...l, total: l.quantity * l.unitPrice })));
  protected readonly subtotal = computed(() => this.lineTotals().reduce((sum, l) => sum + l.total, 0));
  protected readonly discount = signal(0);
  protected readonly total = computed(() => this.subtotal() - this.discount());
  protected readonly quickTender = [2000, 5000, 10000];

  // Item browser (dialog). One search box matches name, barcode, SKU and PLU.
  protected readonly category = signal<string | null>(ALL_CATEGORIES);
  protected readonly query = signal('');
  protected readonly categoryNames = computed(() => [
    ALL_CATEGORIES,
    ...this.catalog
      .categories()
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b)),
  ]);
  protected readonly visibleProducts = computed(() => {
    const category = this.category() ?? ALL_CATEGORIES;
    const query = this.query().trim().toLowerCase();
    return this.catalog
      .products()
      .filter(
        (p) =>
          (category === ALL_CATEGORIES || p.categories.some((c) => c.name === category)) &&
          (!query || [p.name, p.barcode, p.sku, p.plu].some((field) => field?.toLowerCase().includes(query))),
      );
  });

  constructor() {
    void this.catalog.load();
    // Take control of the scanner while checkout is open; released automatically when the page is destroyed.
    claimScanner(({ code }) => {
      const product = this.catalog.findByCode(code);
      if (product) this.add(product);
      this.unknownCode.set(product ? '' : code);
    });
  }

  protected add(product: CatalogProduct): void {
    this.lines.update((lines) =>
      lines.some((l) => l.productId === product.id)
        ? lines.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, { productId: product.id, name: product.name, quantity: 1, unitPrice: product.price }],
    );
  }

  protected change(productId: string, delta: number): void {
    this.lines.update((lines) =>
      lines
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }
}
