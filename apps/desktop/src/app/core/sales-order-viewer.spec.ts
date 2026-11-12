import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { DESKTOP_API_VERSION, type DesktopApi, type ProductRecord, type SalesOrderDetail } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { BannerService } from './banner';
import { ProductViewer } from './product-viewer';
import { SalesOrderViewer } from './sales-order-viewer';

// jsdom has no ResizeObserver (overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ template: '' })
class Blank {}

const ORDER: SalesOrderDetail = {
  id: 'o1',
  orderNumber: 'SO-1001',
  status: 'completed',
  employeeName: 'Casey Cashier',
  subtotal: 1_000,
  discountTotal: 100,
  total: 900,
  createdAt: Date.UTC(2026, 10, 13, 9, 30),
  completedAt: Date.UTC(2026, 10, 13, 9, 30),
  lines: [
    { id: 'l1', productId: 'p1', name: 'Whole Milk', unitPrice: 250, quantityMilli: 2_000, lineTotal: 500, unit: 'each' },
    { id: 'l2', productId: null, name: 'Ground Beef', unitPrice: 1000, quantityMilli: 500, lineTotal: 500, unit: 'kg' },
  ],
  payments: [{ method: 'cash', amount: 900, tendered: 1_000, change: 100, reference: null }],
};

const PRODUCT: ProductRecord = {
  id: 'p1',
  name: 'Whole Milk',
  price: 250,
  unit: 'each',
  tracking: 'quantity',
  sku: 'MILK-1',
  barcode: '590000000012',
  categories: [{ id: 'c1', name: 'Dairy' }],
  cost: 100,
  active: true,
  shelfLifeDays: null,
  onHandMilli: 5_000,
  nextExpiry: null,
  createdAt: 0,
  deletedAt: null,
};

function setup() {
  const api = {
    orders: { get: (id: string) => Promise.resolve(id === 'o1' ? ORDER : null), list: () => Promise.resolve([]) },
    products: { list: () => Promise.resolve([PRODUCT]) },
  } as unknown as DesktopApi;
  void DESKTOP_API_VERSION;
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: api }],
  });
  const viewer = TestBed.inject(SalesOrderViewer);
  TestBed.inject(ProductViewer); // both are started at launch by the app root
  return { viewer, router: TestBed.inject(Router) };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 20));
};
const dialogText = (): string => document.querySelector('#sales-order')?.textContent?.replace(/\s+/g, ' ') ?? '';

describe('SalesOrderViewer', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  it('opens the order named in ?view-sales-order over the current page, in view mode', async () => {
    const { router } = setup();
    await router.navigateByUrl('/items/products?view-sales-order=o1');
    await settle();
    const text = dialogText();
    expect(text).toContain('SO-1001');
    expect(text).toContain('Completed');
    expect(text).toContain('Casey Cashier');
    expect(text).toContain('Whole Milk');
    expect(text).toContain('0.5 kg'); // a weighed line shows its unit
    expect(text).toContain('Tendered');
    expect(router.url).toBe('/items/products?view-sales-order=o1'); // the page underneath stays where it was
  });

  it('open(id) sets the parameter and keeps the rest of the address', async () => {
    const { router, viewer } = setup();
    await router.navigateByUrl('/orders?status=x');
    await viewer.open('o1');
    await settle();
    expect(router.url).toBe('/orders?status=x&view-sales-order=o1');
    expect(dialogText()).toContain('SO-1001');
  });

  it('each line has a product name that opens the product, and a small link to the Products page', async () => {
    const { router } = setup();
    await router.navigateByUrl('/orders?view-sales-order=o1');
    await settle();
    const name = Array.from(document.querySelectorAll<HTMLButtonElement>('#sales-order li button')).find((b) => b.textContent?.trim() === 'Whole Milk');
    expect(name).toBeTruthy();
    const link = document.querySelector('#sales-order a[href^="/items/products"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/items/products?highlight=p1'); // the page of the table holding it, row highlighted
    expect(link.getAttribute('aria-label')).toBe('Open Whole Milk in Products');
    expect(document.querySelectorAll('#sales-order li a[href^="/items/products"]')).toHaveLength(1); // Ground Beef has no product
    expect(document.querySelectorAll('#sales-order li button')).toHaveLength(1);
  });

  it('opens the product in view mode over the order, and closing it leaves the order open', async () => {
    const { router } = setup();
    await router.navigateByUrl('/orders?view-sales-order=o1');
    await settle();
    (Array.from(document.querySelectorAll<HTMLButtonElement>('#sales-order li button')).find((b) => b.textContent?.trim() === 'Whole Milk'))!.click();
    await settle();
    expect(router.url).toBe('/orders?view-sales-order=o1&view-product=p1');
    const product = document.querySelector('#product-view')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(product).toContain('Whole Milk');
    expect(product).toContain('Active');
    expect(product).toContain('₱2.50');
    expect(product).toContain('Barcode');
    expect(product).toContain('590000000012');
    expect(product).toContain('Dairy');
    expect(product).toContain('5'); // in stock
    expect(document.querySelector('#sales-order')).not.toBeNull(); // still there underneath

    // The product dialog's own link goes to the Products page, like the small one on the line.
    expect(document.querySelector('#product-view a[href="/items/products?highlight=p1"]')).not.toBeNull();

    (document.querySelector('#product-view [hlmDialogClose]') as HTMLButtonElement).click();
    await settle();
    expect(router.url).toBe('/orders?view-sales-order=o1');
    expect(document.querySelector('#product-view')).toBeNull();
    expect(dialogText()).toContain('SO-1001');
  });

  it('following the Products link closes both dialogs', async () => {
    const { router } = setup();
    await router.navigateByUrl('/orders?view-sales-order=o1&view-product=p1');
    await settle();
    (document.querySelector('#product-view a[href="/items/products?highlight=p1"]') as HTMLAnchorElement).click();
    await settle();
    expect(router.url).toBe('/items/products?highlight=p1');
    expect(document.querySelector('#product-view')).toBeNull();
    expect(document.querySelector('#sales-order')).toBeNull();
  });

  it('says so when the product does not exist', async () => {
    const { router } = setup();
    await router.navigateByUrl('/orders?view-product=nope');
    await settle();
    expect(TestBed.inject(BannerService).current()?.text).toBe('Product not found');
    expect(router.url).toBe('/orders');
  });

  it('offers a link to the Sales Orders page unless the dialog is already over it', async () => {
    const { router } = setup();
    await router.navigateByUrl('/items/products?view-sales-order=o1');
    await settle();
    const link = document.querySelector('#sales-order a[href^="/orders"]') as HTMLAnchorElement;
    expect(link?.getAttribute('aria-label')).toBe('Open Sales Orders');
    expect(link.getAttribute('href')).toBe('/orders?highlight=o1'); // the table page holding this order, row highlighted
    link.click(); // navigating there drops view-sales-order, which closes the dialog
    await settle();
    expect(router.url).toBe('/orders?highlight=o1');
    expect(dialogText()).toBe('');

    await router.navigateByUrl('/orders?view-sales-order=o1');
    await settle();
    expect(dialogText()).toContain('SO-1001');
    expect(document.querySelector('#sales-order a[href^="/orders"]')).toBeNull();
  });

  it('removes the parameter when the dialog is closed', async () => {
    const { router } = setup();
    await router.navigateByUrl('/orders?view-sales-order=o1');
    await settle();
    (document.querySelector('#sales-order button[hlmDialogClose], #sales-order [hlmDialogClose]') as HTMLButtonElement).click();
    await settle();
    expect(router.url).toBe('/orders');
    expect(dialogText()).toBe('');
  });

  it('says so and clears the parameter when the order does not exist', async () => {
    const { router } = setup();
    await router.navigateByUrl('/orders?view-sales-order=missing');
    await settle();
    expect(TestBed.inject(BannerService).current()?.text).toBe('Order not found');
    expect(router.url).toBe('/orders');
    expect(dialogText()).toBe('');
  });
});
