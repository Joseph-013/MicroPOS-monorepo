import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { type DesktopApi, type SalesOrderSummary } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { SalesOrderViewer } from '../../core/sales-order-viewer';
import { OrdersPage } from './orders';

// jsdom has no ResizeObserver (some overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ template: '' })
class Blank {}

const order = (id: string, n: number, over: Partial<SalesOrderSummary> = {}): SalesOrderSummary => ({
  id,
  orderNumber: `SO-${n}`,
  status: 'completed',
  employeeName: 'Casey Cashier',
  total: 1_000 * n,
  createdAt: Date.UTC(2026, 10, n, 12),
  itemCount: n,
  methods: ['cash'],
  ...over,
});
const ORDERS = [
  order('a', 1),
  order('b', 2, { methods: ['card'], employeeName: 'Morgan Manager' }),
  order('c', 3, { status: 'voided' }),
  order('d', 4, { methods: ['cash', 'card'] }),
];

describe('OrdersPage', () => {
  let fixture: ComponentFixture<OrdersPage>;
  let el: HTMLElement;

  beforeEach(async () => {
    const api = {
      orders: {
        list: () => Promise.resolve(ORDERS), get: (id: string) =>
          Promise.resolve({ id, orderNumber: 'SO-3', status: 'voided', employeeName: 'Casey Cashier', subtotal: 0, discountTotal: 0, total: 0, createdAt: 0, completedAt: null, lines: [], payments: [] }),
      },
    } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: api }] });
    await TestBed.inject(Router).navigateByUrl('/orders');
    fixture = TestBed.createComponent(OrdersPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  const numbers = (): string[] => Array.from(el.querySelectorAll('[role="row"] [role="cell"]:first-child')).map((c) => c.textContent!.trim());
  const type = async (label: string, text: string): Promise<void> => {
    const input = el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };

  it('lists orders newest first with cashier, items, payment, status and total', () => {
    expect(numbers()).toEqual(['SO-4', 'SO-3', 'SO-2', 'SO-1']);
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Morgan Manager');
    expect(text).toContain('Cash, Card'); // a split payment
    expect(text).toContain('Voided');
    expect(text).toContain('₱40.00');
  });

  it('sorts by a column when its title is clicked', async () => {
    const title = Array.from(el.querySelectorAll('[role="columnheader"] button')).find((b) => b.textContent?.trim() === 'Total') as HTMLButtonElement;
    title.click();
    await fixture.whenStable();
    expect(numbers()).toEqual(['SO-1', 'SO-2', 'SO-3', 'SO-4']);
    title.click();
    await fixture.whenStable();
    expect(numbers()).toEqual(['SO-4', 'SO-3', 'SO-2', 'SO-1']);
  });

  it('filters by order number and cashier, and resets', async () => {
    await type('Filter order', 'SO-2');
    expect(numbers()).toEqual(['SO-2']);
    await type('Filter order', '');
    await type('Filter cashier', 'morgan');
    expect(numbers()).toEqual(['SO-2']);
    (el.querySelector('button[aria-label="Reset filters"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(numbers()).toHaveLength(4);
  });

  it('opens an order by clicking its row: the address gets ?view-sales-order=<id>', async () => {
    const row = Array.from(el.querySelectorAll('[role="row"]')).find((r) => r.textContent?.includes('SO-3')) as HTMLElement;
    row.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(TestBed.inject(Router).url).toBe('/orders?view-sales-order=c');
    expect(document.querySelector('#sales-order')?.textContent).toContain('SO-3'); // the dialog is over the list
  });

  it('says when there are no orders', async () => {
    const empty = TestBed.createComponent(OrdersPage);
    TestBed.inject(DESKTOP_API)!.orders.list = () => Promise.resolve([]);
    await empty.componentInstance['service'].load();
    await empty.whenStable();
    expect(empty.nativeElement.textContent).toContain('No orders found');
  });
});

describe('OrdersPage paging and highlighting', () => {
  // 120 orders, o1 oldest ... o120 newest; newest first means o120 is row 1 and o10 is row 111 (page 3 of 3).
  const MANY = Array.from({ length: 120 }, (_, i) => order(`o${i + 1}`, i + 1, { createdAt: (i + 1) * 60_000 }));
  let fixture: ComponentFixture<OrdersPage>;
  let el: HTMLElement;

  async function open(url = '/orders'): Promise<void> {
    const detail = (id: string) => ({ id, orderNumber: `SO-${id.slice(1)}`, status: 'completed', employeeName: 'Casey Cashier', subtotal: 0, discountTotal: 0, total: 0, createdAt: 0, completedAt: null, lines: [], payments: [] });
    const api = { orders: { list: () => Promise.resolve(MANY), get: (id: string) => Promise.resolve(detail(id)) } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: api }] });
    TestBed.inject(SalesOrderViewer); // started at launch by the app root, before the first navigation
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(OrdersPage);
    await settle();
    el = fixture.nativeElement as HTMLElement;
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fixture.whenStable();
    }
  };
  const rows = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-row-id]'));
  const footer = (): string => el.querySelector('app-pager')?.textContent?.replace(/\s+/g, ' ') ?? '';
  const button = (label: string): HTMLButtonElement => el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const pager = () => (fixture.componentInstance as unknown as { pager: { setPageSize(n: number): void } }).pager;

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  it('shows one page at a time, with the range, total and page number', async () => {
    await open();
    expect(rows()).toHaveLength(50);
    expect(rows()[0].dataset['rowId']).toBe('o120');
    expect(footer()).toContain('1–50 of 120');
    expect(footer()).toContain('Page 1 of 3');
    expect(button('Previous page').disabled).toBe(true);

    button('Next page').click();
    await fixture.whenStable();
    expect(footer()).toContain('51–100 of 120');
    expect(rows()[0].dataset['rowId']).toBe('o70');

    button('Last page').click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(20);
    expect(footer()).toContain('101–120 of 120');
    expect(button('Next page').disabled).toBe(true);
  });

  it('changes the page size, and goes back to page 1 when a filter or the sort changes', async () => {
    await open();
    pager().setPageSize(25);
    await settle();
    expect(rows()).toHaveLength(25);
    expect(footer()).toContain('Page 1 of 5');

    button('Next page').click();
    await fixture.whenStable();
    expect(footer()).toContain('Page 2 of 5');
    const input = el.querySelector('input[aria-label="Filter order"]') as HTMLInputElement;
    input.value = 'SO-1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(footer()).toContain('Page 1 of');
  });

  it('?highlight=<id> shows the page that holds the order and highlights its row, without selecting it', async () => {
    await open('/orders?highlight=o10');
    expect(footer()).toContain('Page 3 of 3');
    const row = rows().find((r) => r.dataset['rowId'] === 'o10')!;
    expect(row.querySelector('.row-target')).not.toBeNull();
    expect(el.querySelectorAll('.row-target')).toHaveLength(1);
    expect(row.querySelector('[aria-selected]')).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/orders'); // the parameter is used up
  });

  it('clears filters that hide the target order', async () => {
    await open();
    const input = el.querySelector('input[aria-label="Filter order"]') as HTMLInputElement;
    input.value = 'SO-120';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(rows()).toHaveLength(1);

    await TestBed.inject(Router).navigateByUrl('/orders?highlight=o10');
    await settle();
    expect(input.value).toBe('');
    expect(footer()).toContain('Page 3 of 3');
    expect(rows().find((r) => r.dataset['rowId'] === 'o10')?.querySelector('.row-target')).toBeTruthy();
  });

  it('highlights the order whose dialog is open', async () => {
    await open('/orders?view-sales-order=o10');
    expect(document.querySelector('#sales-order')?.textContent).toContain('SO-10');
    expect(footer()).toContain('Page 3 of 3');
    expect(rows().find((r) => r.dataset['rowId'] === 'o10')?.querySelector('.row-target')).toBeTruthy();
  });
});
