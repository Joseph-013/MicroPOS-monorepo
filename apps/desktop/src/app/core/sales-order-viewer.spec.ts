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
  refundOf: null,
  refundedBy: null,
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

/** What the fake main process answers: the order as stored now, and the calls it received. */
const fake = { order: ORDER as SalesOrderDetail, voids: [] as unknown[], refunds: [] as unknown[] };

function setup() {
  fake.order = ORDER;
  fake.voids = [];
  fake.refunds = [];
  const api = {
    orders: {
      get: (id: string) => Promise.resolve(id === 'o1' ? fake.order : null),
      list: () => Promise.resolve([]),
      void: (input: unknown) => {
        fake.voids.push(input);
        fake.order = { ...fake.order, status: 'voided' };
        return Promise.resolve({ ok: true as const, orderId: 'o1', orderNumber: 'SO-1001' });
      },
      refund: (input: unknown) => {
        fake.refunds.push(input);
        fake.order = { ...fake.order, status: 'refunded', refundedBy: { id: 'r1', orderNumber: 'SO-1002' } };
        return Promise.resolve({ ok: true as const, orderId: 'o1', orderNumber: 'SO-1001', refundOrderId: 'r1', refundOrderNumber: 'SO-1002' });
      },
    },
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

  describe('void and refund', () => {
    const text = (selector: string): string => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ') ?? '';
    const button = (root: string, label: string): HTMLButtonElement =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(`${root} button`)).find((b) => b.textContent?.trim() === label)!;
    const typeReason = async (value: string): Promise<void> => {
      const input = document.querySelector('#order-reason') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    };

    const openOrder = async (order: SalesOrderDetail): Promise<void> => {
      const { router } = setup();
      fake.order = order;
      await router.navigateByUrl('/orders?view-sales-order=o1');
      await settle();
    };

    it('a completed sale offers Void and Refund', async () => {
      await openOrder(ORDER);
      expect(button('#sales-order', 'Void')).toBeTruthy();
      expect(button('#sales-order', 'Refund')).toBeTruthy();
    });

    it('a voided sale offers neither', async () => {
      await openOrder({ ...ORDER, status: 'voided' });
      expect(text('#sales-order')).toContain('Voided');
      expect(button('#sales-order', 'Void')).toBeUndefined();
      expect(button('#sales-order', 'Refund')).toBeUndefined();
    });

    it('a refund order offers neither, is labelled Refund and links to the sale it reverses', async () => {
      await openOrder({ ...ORDER, total: -900, refundOf: { id: 'o0', orderNumber: 'SO-1000' } });
      expect(button('#sales-order', 'Void')).toBeUndefined();
      expect(button('#sales-order', 'Refund')).toBeUndefined();
      expect(text('#sales-order')).toContain('Refund of');
      expect(text('#sales-order')).toContain('SO-1000');
    });

    it('voiding lists the order, needs a reason, calls the API and shows the order voided', async () => {
      const { router } = setup();
      await router.navigateByUrl('/orders?view-sales-order=o1');
      await settle();
      button('#sales-order', 'Void').click();
      await settle();

      expect(text('#order-action')).toContain('Void SO-1001?');
      expect(text('#order-action')).toContain('₱9.00'); // what is about to be voided
      expect(button('#order-action', 'Void').disabled).toBe(true); // no reason yet
      await typeReason('  Wrong item  ');
      button('#order-action', 'Void').click();
      await settle();

      expect(fake.voids).toEqual([{ orderId: 'o1', reason: 'Wrong item' }]);
      expect(document.querySelector('#order-action')).toBeNull();
      expect(TestBed.inject(BannerService).current()?.text).toBe('Order SO-1001 voided');
      expect(text('#sales-order')).toContain('Voided'); // the dialog under it shows the new state
      expect(button('#sales-order', 'Void')).toBeUndefined();
    });

    it('refunding says which refund order was made and links the two orders', async () => {
      const { router } = setup();
      await router.navigateByUrl('/orders?view-sales-order=o1');
      await settle();
      button('#sales-order', 'Refund').click();
      await settle();
      expect(text('#order-action')).toContain('Refund SO-1001?');
      expect(text('#order-action')).toContain('Refund total');
      await typeReason('Spoiled');
      button('#order-action', 'Refund').click();
      await settle();
      expect(fake.refunds).toEqual([{ orderId: 'o1', reason: 'Spoiled' }]);
      expect(TestBed.inject(BannerService).current()?.text).toBe('Order SO-1001 refunded (SO-1002)');
      expect(text('#sales-order')).toContain('Refunded by');
      expect(text('#sales-order')).toContain('SO-1002');
    });

    it('cancelling does nothing', async () => {
      const { router } = setup();
      await router.navigateByUrl('/orders?view-sales-order=o1');
      await settle();
      button('#sales-order', 'Void').click();
      await settle();
      button('#order-action', 'Cancel').click();
      await settle();
      expect(fake.voids).toEqual([]);
      expect(document.querySelector('#order-action')).toBeNull();
      expect(button('#sales-order', 'Void')).toBeTruthy();
    });
  });
});
