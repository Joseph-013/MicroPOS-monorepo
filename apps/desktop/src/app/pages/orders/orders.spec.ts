import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { type DesktopApi, type SalesOrderSummary } from '@micropos/core';
import { BannerService } from '../../core/banner';
import { withSession } from '../../core/auth/testing';
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
  isRefund: false,
  customerName: null,
  onAccount: 0,
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
  let reversed: [string, unknown][];
  let printed: string[];
  let fixture: ComponentFixture<OrdersPage>;
  let el: HTMLElement;

  beforeEach(async () => {
    reversed = [];
    printed = [];
    const api = {
      printer: { printOrder: (id: string) => (printed.push(id), Promise.resolve({ ok: true as const })) },
      orders: {
        list: () => Promise.resolve(ORDERS), get: (id: string) =>
          Promise.resolve({ id, orderNumber: 'SO-3', status: 'voided', employeeName: 'Casey Cashier', subtotal: 0, discountTotal: 0, total: 0, createdAt: 0, completedAt: null, customer: null, onAccount: 0, refundOf: null, refundedBy: null, lines: [], payments: [] }),
        void: (input: unknown) => (reversed.push(['void', input]), Promise.resolve({ ok: true as const, orderId: (input as { orderId: string }).orderId, orderNumber: 'SO-X' })),
        refund: (input: unknown) => (reversed.push(['refund', input]), Promise.resolve({ ok: true as const, orderId: (input as { orderId: string }).orderId, orderNumber: 'SO-X', refundOrderId: 'r', refundOrderNumber: 'SO-R' })),
      },
    } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: withSession(api) }] });
    await TestBed.inject(Router).navigateByUrl('/orders');
    fixture = TestBed.createComponent(OrdersPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  const numbers = (): string[] => Array.from(el.querySelectorAll('[role="row"] [role="cell"]:nth-child(2)')).map((c) => c.textContent!.trim());
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

  describe('selection', () => {
    const rowOf = (n: number): HTMLElement => Array.from(el.querySelectorAll<HTMLElement>('[role="row"]')).find((r) => r.textContent?.includes(`SO-${n}`))!;
    const selectedNumbers = (): string[] => Array.from(el.querySelectorAll<HTMLElement>('[role="row"][aria-selected="true"]')).map((r) => r.querySelectorAll('[role="cell"]')[1]!.textContent!.trim());
    const click = (target: HTMLElement, init: MouseEventInit = {}): void => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    };

    it('has a checkbox column with a header checkbox for the current page', async () => {
      (el.querySelector('[aria-label="Select SO-2"]') as HTMLElement).click();
      await fixture.whenStable();
      expect(selectedNumbers()).toEqual(['SO-2']);
      expect(el.textContent).toContain('1 selected');

      (el.querySelector('[aria-label="Select all"]') as HTMLElement).click();
      await fixture.whenStable();
      expect(selectedNumbers()).toHaveLength(4);
      expect(el.textContent).toContain('4 selected');
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Clear') as HTMLElement).click();
      await fixture.whenStable();
      expect(selectedNumbers()).toEqual([]);
    });

    it('Ctrl + click toggles a row and Shift + click selects a range, without opening the order', async () => {
      click(rowOf(4), { ctrlKey: true }); // newest first: SO-4, SO-3, SO-2, SO-1
      click(rowOf(2), { shiftKey: true });
      await fixture.whenStable();
      expect(selectedNumbers()).toEqual(['SO-4', 'SO-3', 'SO-2']);
      click(rowOf(3), { ctrlKey: true });
      await fixture.whenStable();
      expect(selectedNumbers()).toEqual(['SO-4', 'SO-2']);
      expect(TestBed.inject(Router).url).toBe('/orders'); // nothing was opened
    });

    describe('void and refund', () => {
      const button = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
        Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
      const reason = async (text: string): Promise<void> => {
        const input = document.querySelector('#order-reason') as HTMLInputElement;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await fixture.whenStable();
      };
      const settle = async (): Promise<void> => {
        for (let i = 0; i < 4; i++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          await fixture.whenStable();
        }
      };

      it('offers Void and Refund for the selected completed sales only, never a voided one', async () => {
        click(rowOf(1), { ctrlKey: true }); // completed
        click(rowOf(3), { ctrlKey: true }); // voided
        await fixture.whenStable();
        expect(el.textContent).toContain('2 selected');
        expect(button(el, 'Void 1')).toBeTruthy(); // SO-3 is already voided: not counted
        expect(button(el, 'Refund 1')).toBeTruthy();

        click(rowOf(3), { ctrlKey: true });
        click(rowOf(1), { ctrlKey: true });
        click(rowOf(3), { ctrlKey: true });
        await fixture.whenStable();
        expect(button(el, 'Void 1')).toBeUndefined(); // only the voided one is selected
        expect(button(el, 'Refund 1')).toBeUndefined();
      });

      it('voids a selection after listing the orders and asking for a reason', async () => {
        click(rowOf(1), { ctrlKey: true });
        click(rowOf(4), { shiftKey: true }); // SO-4 down to SO-1: 4, 3 (voided), 2, 1
        await fixture.whenStable();
        button(el, 'Void 3')!.click(); // SO-3 is not counted
        await settle();
        const dialog = document.querySelector('#order-action')!;
        expect(dialog.textContent).toContain('Void 3 orders?');
        expect(Array.from(dialog.querySelectorAll('app-confirm-items li span:first-child')).map((e) => e.textContent!.trim()).sort()).toEqual(['SO-1', 'SO-2', 'SO-4']);
        expect(button(dialog, 'Void')!.disabled).toBe(true);
        await reason('Customer left');
        button(dialog, 'Void')!.click();
        await settle();

        expect(reversed.map(([kind, input]) => [kind, (input as { orderId: string; reason: string }).orderId, (input as { reason: string }).reason]).sort()).toEqual([
          ['void', 'a', 'Customer left'],
          ['void', 'b', 'Customer left'],
          ['void', 'd', 'Customer left'],
        ]);
        expect(document.querySelector('#order-action')).toBeNull();
        expect(el.textContent).toContain('1 selected'); // the done rows left the selection; the voided one that was in the range stays
      });

      it('the context menu prints the receipt of the row it was opened on', async () => {
        rowOf(2).parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
        await settle();
        (Array.from(document.querySelectorAll<HTMLElement>('[hlmDropdownMenuItem]')).find((i) => i.textContent?.trim() === 'Print receipt'))!.click();
        await settle();
        expect(printed).toEqual(['b']);
        expect(TestBed.inject(BannerService).current()?.text).toBe('Receipt for SO-2 sent to the printer');
      });

      it('the context menu offers Void and Refund on a completed sale and neither on a voided one', async () => {
        const open = async (n: number): Promise<HTMLElement[]> => {
          rowOf(n).parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
          await settle();
          return Array.from(document.querySelectorAll<HTMLElement>('[hlmDropdownMenuItem]'));
        };
        expect((await open(3)).map((i) => i.textContent?.trim())).toEqual(['View', 'Print receipt']);
        document.body.click();
        document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
        await settle();
        const items = await open(2);
        expect(items.map((i) => i.textContent?.trim())).toEqual(['View', 'Print receipt', 'Void', 'Refund']);
        items[3].click();
        await settle();
        expect(document.querySelector('#order-action')?.textContent).toContain('Refund SO-2?');
        await reason('Wrong size');
        button(document.querySelector('#order-action')!, 'Refund')!.click();
        await settle();
        expect(reversed).toEqual([['refund', { orderId: 'b', reason: 'Wrong size' }]]);
      });
    });

    it('a plain click still opens the order', async () => {
      click(rowOf(3));
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(TestBed.inject(Router).url).toBe('/orders?view-sales-order=c');
      expect(selectedNumbers()).toEqual([]);
    });
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
    const detail = (id: string) => ({ id, orderNumber: `SO-${id.slice(1)}`, status: 'completed', employeeName: 'Casey Cashier', subtotal: 0, discountTotal: 0, total: 0, createdAt: 0, completedAt: null, customer: null, onAccount: 0, refundOf: null, refundedBy: null, lines: [], payments: [] });
    const api = { orders: { list: () => Promise.resolve(MANY), get: (id: string) => Promise.resolve(detail(id)) } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: withSession(api) }] });
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
    expect(row.querySelector('.row-target')!.getAttribute('aria-selected')).toBe('false');
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

describe('OrdersPage refund rows', () => {
  it('reads Refund for a refund order (not Completed) and filters it separately', async () => {
    const list = [order('s', 1, { methods: ['ewallet', 'bank_transfer'] }), order('r', 2, { isRefund: true, total: -1000 }), order('v', 3, { status: 'voided' })];
    const api = { orders: { list: () => Promise.resolve(list), get: () => Promise.resolve(null) } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: withSession(api) }] });
    const fixture = TestBed.createComponent(OrdersPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const badge = (n: number): string => Array.from(el.querySelectorAll('[role="row"]')).find((r) => r.textContent?.includes(`SO-${n}`))!.querySelector('[hlmBadge]')!.textContent!.trim();
    expect([badge(1), badge(2), badge(3)]).toEqual(['Completed', 'Refund', 'Voided']);
    expect(el.textContent).toContain('-₱10.00');
    expect(el.textContent).toContain('E-wallet, Bank transfer'); // the new payment methods read in full

    const page = fixture.componentInstance as unknown as { statusFilter: { set(v: string): void } };
    const names = (): string[] => Array.from(el.querySelectorAll('[role="row"] [role="cell"]:nth-child(2)')).map((c) => c.textContent!.trim());
    page.statusFilter.set('refund');
    await fixture.whenStable();
    expect(names()).toEqual(['SO-2']);
    page.statusFilter.set('completed'); // completed no longer includes refund orders
    await fixture.whenStable();
    expect(names()).toEqual(['SO-1']);
    fixture.destroy();
  });

  it('shows the customer and what is on account, and filters by customer', async () => {
    const list = [order('s', 1, { customerName: 'Aling Nena', onAccount: 700 }), order('t', 2), order('u', 3, { customerName: 'Bong', onAccount: 0 })];
    const api = { orders: { list: () => Promise.resolve(list), get: () => Promise.resolve(null) } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: withSession(api) }] });
    const fixture = TestBed.createComponent(OrdersPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rowText = (n: number): string => Array.from(el.querySelectorAll('[role="row"]')).find((r) => r.textContent?.includes(`SO-${n}`))!.textContent!.replace(/\s+/g, ' ');
    expect(rowText(1)).toContain('Aling Nena');
    expect(rowText(1)).toContain('₱7.00 on account');
    expect(rowText(3)).toContain('Bong');
    expect(rowText(3)).not.toContain('on account'); // fully paid
    expect(rowText(2)).not.toContain('Aling');

    const input = el.querySelector('input[aria-label="Filter customer"]') as HTMLInputElement;
    input.value = 'nena';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(Array.from(el.querySelectorAll('[role="row"] [role="cell"]:nth-child(2)')).map((c) => c.textContent!.trim())).toEqual(['SO-1']);
    fixture.destroy();
  });
});
