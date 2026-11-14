import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { purchaseConcern, type DesktopApi, type PurchaseConcern, type PayPurchaseInput, type PurchaseDetail, type PurchaseInput, type PurchaseSummary, type ReceivePurchaseInput } from '@micropos/core';
import { NavBadges } from '../../core/nav-badges';
import { withSession } from '../../core/auth/testing';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { ScannerService } from '../../core/scanner';
import { PurchaseViewer } from '../../core/purchase-viewer';
import { PurchasesPage } from './purchases';

// jsdom has no ResizeObserver (overlay code watches element sizes).
// jsdom has no scrollIntoView (the combobox scrolls its highlighted option into view).
Element.prototype.scrollIntoView ??= () => undefined;

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ template: '' })
class Blank {}

const DAY = 86_400_000;

const purchase = (id: string, number: string, supplierName: string, over: Partial<PurchaseDetail> = {}): PurchaseDetail => ({
  id,
  number,
  supplierId: `s-${supplierName}`,
  supplierName,
  status: 'ordered',
  orderedAt: Date.UTC(2026, 10, 1, 10),
  expectedAt: null,
  dueAt: null,
  receivedAt: null,
  reference: null,
  lineCount: 1,
  partlyReceived: false,
  total: 100_000,
  paid: 0,
  credited: 0,
  owed: 100_000,
  note: null,
  employeeName: 'Register',
  lines: [{ id: `${id}-l1`, productId: 'p1', productName: 'Rice 25kg', productCode: '111', unit: 'each', tracking: 'quantity', quantityMilli: 10_000, receivedMilli: 0, unitCost: 10_000, total: 100_000 }],
  payments: [],
  returns: [],
  ...over,
});

const summary = (p: PurchaseDetail): PurchaseSummary => {
  const { note: _note, employeeName: _employee, lines: _lines, payments: _payments, ...rest } = p;
  return rest;
};

/** A fake main process holding purchase orders in memory, recording the calls it gets. */
function fakeApi(initial: PurchaseDetail[]) {
  const rows = [...initial];
  const calls = { created: [] as PurchaseInput[], payments: [] as PayPurchaseInput[], received: [] as ReceivePurchaseInput[], cancelled: [] as string[] };
  const find = (id: string): PurchaseDetail => rows.find((r) => r.id === id)!;
  const api = {
    scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
    products: {
      list: () =>
        Promise.resolve([
          { id: 'p1', name: 'Rice 25kg', unit: 'each', tracking: 'quantity', cost: 10_000, barcode: null, deletedAt: null },
          { id: 'p2', name: 'Milk', unit: 'each', tracking: 'expiry', cost: 5_000, barcode: null, deletedAt: null },
        ]),
    },
    suppliers: { list: () => Promise.resolve([{ id: 's-Metro', name: 'Metro', phone: null, note: null, owed: 0, openOrders: 0, createdAt: 1, deletedAt: null }]) },
    purchases: {
      concerns: () => Promise.resolve(rows.map(summary).flatMap((p) => purchaseConcern(p, Date.now()) ?? [])),
      list: () => Promise.resolve(rows.map(summary)),
      get: (id: string) => Promise.resolve(rows.find((r) => r.id === id) ?? null),
      create: (input: PurchaseInput) => {
        calls.created.push(input);
        const p = purchase(`n${rows.length}`, `PO-${1001 + rows.length}`, 'Metro', { total: input.lines.reduce((s, l) => s + (l.quantityMilli * l.unitCost) / 1000, 0) });
        p.owed = p.total;
        rows.unshift(p);
        return Promise.resolve({ ok: true as const, purchase: p });
      },
      pay: (input: PayPurchaseInput) => {
        calls.payments.push(input);
        const p = find(input.purchaseId);
        if (input.amount > p.owed) return Promise.resolve({ ok: false as const, field: 'amount' as const, error: 'That is more than is owed' });
        p.paid += input.amount;
        p.owed -= input.amount;
        p.payments.unshift({ id: 'pay1', amount: input.amount, method: input.method, reference: input.reference, note: null, employeeName: 'Register', at: 9 });
        return Promise.resolve({ ok: true as const, purchase: { ...p } });
      },
      receive: (input: ReceivePurchaseInput) => {
        calls.received.push(input);
        const p = find(input.purchaseId);
        const missing = p.lines.find((l) => {
          const given = input.lines.find((x) => x.lineId === l.id);
          return l.tracking === 'expiry' && (given?.quantityMilli ?? 1) > 0 && !given?.batchNumber;
        });
        if (missing) return Promise.resolve({ ok: false as const, lineId: missing.id, field: 'batchNumber' as const, error: `${missing.productName}: Enter a batch number` });
        p.status = 'received';
        p.receivedAt = 99;
        return Promise.resolve({ ok: true as const, purchase: { ...p } });
      },
      cancel: (id: string) => {
        calls.cancelled.push(id);
        const p = find(id);
        p.status = 'cancelled';
        p.owed = 0;
        return Promise.resolve({ ok: true as const, purchase: { ...p } });
      },
    },
  } as unknown as DesktopApi;
  return { api, calls, rows };
}

const SAMPLE = () => [
  purchase('a', 'PO-1003', 'Metro', { orderedAt: Date.UTC(2026, 10, 10, 10), dueAt: Date.now() - DAY, reference: 'INV-77' }),
  purchase('b', 'PO-1002', 'Bakery Supply', { orderedAt: Date.UTC(2026, 10, 5, 10), status: 'received', receivedAt: 5, paid: 100_000, owed: 0 }),
  purchase('c', 'PO-1001', 'Metro', { orderedAt: Date.UTC(2026, 10, 1, 10), status: 'cancelled', owed: 0 }),
];

describe('PurchasesPage', () => {
  let fixture: ComponentFixture<PurchasesPage>;
  let el: HTMLElement;
  let fake: ReturnType<typeof fakeApi>;
  /** The list behind the nav badge (the page's concerns button and dialog follow it). */
  const badges = signal<PurchaseConcern[]>([]);
  beforeEach(() => badges.set([]));

  async function open(rows = SAMPLE(), url = '/purchases'): Promise<void> {
    fake = fakeApi(rows);
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: withSession(fake.api) }, { provide: NavBadges, useValue: { count: () => badges().length, refresh: () => Promise.resolve(), purchaseConcerns: badges } }],
    });
    TestBed.inject(ScannerService);
    TestBed.inject(PurchaseViewer); // started at launch by the app root, before the first navigation
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(PurchasesPage);
    await settle();
    el = fixture.nativeElement as HTMLElement;
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fixture.whenStable();
    }
  };
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  const numbers = (): string[] => Array.from(el.querySelectorAll('[role="rowgroup"]:last-child [role="row"] [role="cell"]:nth-child(1)')).map((c) => c.textContent!.trim());
  const rowOf = (number: string): HTMLElement => Array.from(el.querySelectorAll<HTMLElement>('[role="row"]')).find((r) => r.textContent?.includes(number))!;
  const type = async (selector: string, text: string, root: ParentNode = el): Promise<void> => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const button = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  /** The confirmation that asks before a delivery is received. */
  const confirmReceive = (): void => {
    Array.from(document.querySelectorAll<HTMLElement>('hlm-alert-dialog-content button')).find((b) => b.textContent?.trim() === 'Receive')!.click();
  };
  const text = (selector: string): string => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ') ?? '';

  it('lists orders newest first with status, what is owed, and flags an overdue one', async () => {
    await open();
    expect(numbers()).toEqual(['PO-1003', 'PO-1002', 'PO-1001']);
    const row = (n: string): string => rowOf(n).textContent!.replace(/\s+/g, ' ');
    expect(row('PO-1003')).toContain('Ordered');
    expect(row('PO-1003')).toContain('₱1,000.00');
    expect(rowOf('PO-1003').querySelector('.text-destructive')).not.toBeNull(); // overdue due date and amount
    expect(row('PO-1002')).toContain('Received');
    expect(rowOf('PO-1002').querySelectorAll('[role="cell"]')[6].textContent!.trim()).toBe('-'); // settled
    expect(el.querySelector('header')!.textContent).toContain('₱1,000.00'); // owed across the list
  });

  it('filters by order number or reference, supplier, status and what is owed', async () => {
    await open();
    await type('input[aria-label="Filter order number or reference"]', 'inv-77');
    expect(numbers()).toEqual(['PO-1003']);
    await type('input[aria-label="Filter order number or reference"]', '');
    await type('input[aria-label="Filter supplier"]', 'bakery');
    expect(numbers()).toEqual(['PO-1002']);
    (el.querySelector('button[aria-label="Reset filters"]') as HTMLElement).click();
    const page = fixture.componentInstance as unknown as { statusFilter: { set(v: string): void }; owedFilter: { set(v: string): void } };
    page.statusFilter.set('cancelled');
    await fixture.whenStable();
    expect(numbers()).toEqual(['PO-1001']);
    page.statusFilter.set('all');
    page.owedFilter.set('overdue');
    await fixture.whenStable();
    expect(numbers()).toEqual(['PO-1003']);
    page.owedFilter.set('settled');
    await fixture.whenStable();
    expect(numbers().sort()).toEqual(['PO-1001', 'PO-1002']);
  });

  it('a click opens the order over the page (?view-purchase=<id>) and highlights the row', async () => {
    await open();
    rowOf('PO-1003').click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/purchases?view-purchase=a');
    const dialog = text('#purchase-detail');
    expect(dialog).toContain('PO-1003');
    expect(dialog).toContain('Overdue');
    expect(dialog).toContain('Metro');
    expect(dialog).toContain('INV-77');
    expect(dialog).toContain('Rice 25kg');
    expect(dialog).toContain('10 × ₱100.00');
    expect(el.querySelector('.row-target')!.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe('a');
  });

  it('records a part-payment and shows what is still owed', async () => {
    await open();
    rowOf('PO-1003').click();
    await settle();
    const dialog = document.querySelector('#purchase-detail')!;
    button(dialog, 'Record payment')!.click();
    await settle();
    button(dialog, 'Full amount')!.click();
    await settle();
    expect((dialog.querySelector('#pp-amount') as HTMLInputElement).value).toBe('1000.00');
    await type('#pp-amount', '400', dialog);
    await type('#pp-reference', 'TX-9', dialog);
    button(dialog, 'Record payment')!.click();
    await settle();

    expect(fake.calls.payments).toEqual([{ purchaseId: 'a', amount: 40_000, method: 'cash', reference: 'TX-9' }]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('₱400.00 paid to Metro');
    const after = text('#purchase-detail');
    expect(after).toContain('₱600.00'); // owed now
    expect(after).toContain('Payment · Cash');
    expect(after).toContain('TX-9');
    expect(rowOf('PO-1003').textContent).toContain('₱600.00'); // and the list shows it
  });

  it('shows a refused payment\'s reason and keeps the form', async () => {
    await open();
    rowOf('PO-1003').click();
    await settle();
    const dialog = document.querySelector('#purchase-detail')!;
    button(dialog, 'Record payment')!.click();
    await settle();
    await type('#pp-amount', '5000', dialog);
    button(dialog, 'Record payment')!.click();
    await settle();
    expect(dialog.textContent).toContain('That is more than is owed');
    expect(dialog.querySelector('#pp-amount')).not.toBeNull();
  });

  it('a delivery: scan or type what arrived per line, lot and expiry only where tracked, the rest stays to come', async () => {
    const dated = purchase('d', 'PO-1004', 'Metro', {
      lines: [
        { id: 'd-l1', productId: 'p1', productName: 'Rice 25kg', productCode: '111', unit: 'each', tracking: 'quantity', quantityMilli: 2_000, receivedMilli: 0, unitCost: 10_000, total: 20_000 },
        { id: 'd-l2', productId: 'p2', productName: 'Milk', productCode: '222', unit: 'each', tracking: 'expiry', quantityMilli: 6_000, receivedMilli: 0, unitCost: 5_000, total: 30_000 },
      ],
    });
    await open([dated]);
    rowOf('PO-1004').click();
    await settle();
    button(document.querySelector('#purchase-detail')!, 'Receive stock')!.click();
    await settle();
    const form = document.querySelector('#purchase-receive')!;
    expect(form.textContent).toContain('6 left of 6');
    expect(button(form, 'Receive')!.disabled).toBe(true); // nothing has arrived yet
    expect(form.querySelector('input[id^="rc-lot-"]')).toBeNull(); // lot and expiry wait for a quantity

    TestBed.inject(ScannerService).receive('999'); // not on the order
    await settle();
    expect(form.textContent).toContain('No product with code 999 is waiting on PO-1004');
    const scanner = TestBed.inject(ScannerService);
    scanner.receive('222'); // a Milk comes out of the box
    scanner.receive('222');
    await settle();
    expect((form.querySelector('input[aria-label="Arrived of Milk"]') as HTMLInputElement).value).toBe('2');
    expect(form.querySelector('#rc-lot-d-l2')).not.toBeNull();
    expect(form.querySelector('#rc-lot-d-l1')).toBeNull(); // Rice has not arrived

    button(form, 'Receive')!.click(); // no lot yet
    await settle();
    expect(form.textContent).toContain('Milk: Enter a batch number');
    expect(fake.calls.received).toHaveLength(0); // refused before asking to confirm

    await type('#rc-lot-d-l2', 'L-5', form);
    await type('#rc-exp-d-l2', '2027-01-31', form);
    button(form, 'Receive')!.click();
    await settle();
    // Nothing is written until it is confirmed, and the confirmation lists what arrives.
    expect(fake.calls.received).toHaveLength(0);
    const asked = document.querySelector('hlm-alert-dialog-content')!;
    expect(asked.textContent).toContain('Receive stock for PO-1004?');
    expect(asked.textContent).toContain('Milk');
    expect(asked.textContent).toContain('2');
    expect(asked.textContent).not.toContain('Rice');
    expect(asked.textContent).toContain('What has not arrived stays on the order');
    confirmReceive();
    await settle();
    expect(fake.calls.received.at(-1)).toMatchObject({ purchaseId: 'd', lines: [{ lineId: 'd-l1', quantityMilli: 0 }, { lineId: 'd-l2', quantityMilli: 2_000, batchNumber: 'L-5' }] });
    expect(TestBed.inject(BannerService).current()?.text).toBe('PO-1004 received into stock');
    expect(document.querySelector('#purchase-receive')).toBeNull();
  });

  it('an order of products that track no stock says nothing will be added to stock before it is received', async () => {
    const untracked = purchase('u', 'PO-1006', 'Metro');
    untracked.lines[0]!.tracking = 'none';
    await open([untracked]);
    rowOf('PO-1006').click();
    await settle();
    button(document.querySelector('#purchase-detail')!, 'Receive stock')!.click();
    await settle();
    const form = document.querySelector('#purchase-receive')!;
    button(form, 'Receive')!.click();
    await settle();
    expect(document.querySelector('hlm-alert-dialog-content')!.textContent).toContain('nothing is added to stock');
    expect(fake.calls.received).toHaveLength(0);
    confirmReceive();
    await settle();
    expect(fake.calls.received).toHaveLength(1);
  });

  it('Everything left fills every line with what has not arrived', async () => {
    await open([purchase('d', 'PO-1004', 'Metro')]);
    rowOf('PO-1004').click();
    await settle();
    button(document.querySelector('#purchase-detail')!, 'Receive stock')!.click();
    await settle();
    const form = document.querySelector('#purchase-receive')!;
    button(form, 'Everything left')!.click();
    await settle();
    expect((form.querySelector('input[aria-label="Arrived of Rice 25kg"]') as HTMLInputElement).value).toBe('10');
    button(form, 'Receive')!.click();
    await settle();
    confirmReceive();
    await settle();
    expect(fake.calls.received.at(-1)).toMatchObject({ lines: [{ lineId: 'd-l1', quantityMilli: 10_000 }] });
  });

  it('an order with part of it received says so, can only be received in full for the rest, and cannot be edited', async () => {
    const part = purchase('e', 'PO-1005', 'Metro', { partlyReceived: true });
    part.lines[0]!.receivedMilli = 4_000;
    await open([part]);
    expect(rowOf('PO-1005').textContent).toContain('Partly received');
    rowOf('PO-1005').click();
    await settle();
    const dialog = document.querySelector('#purchase-detail')!;
    expect(dialog.textContent).toContain('4 received');
    expect(button(dialog, 'Receive the rest')).toBeDefined();
    expect(button(dialog, 'Edit')).toBeUndefined();
    expect(button(dialog, 'Cancel order')).toBeUndefined();
    button(dialog, 'Receive the rest')!.click();
    await settle();
    expect(document.querySelector('#purchase-receive')!.textContent).toContain('6'); // what is left of 10
  });

  it('cancels an unpaid order after confirming', async () => {
    await open();
    rowOf('PO-1003').click();
    await settle();
    const dialog = document.querySelector('#purchase-detail')!;
    button(dialog, 'Cancel order')!.click();
    await settle();
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel order' && b.closest('hlm-alert-dialog-content'));
    confirm!.click();
    await settle();
    expect(fake.calls.cancelled).toEqual(['a']);
    expect(text('#purchase-detail')).toContain('Cancelled');
    expect(button(dialog, 'Cancel order')).toBeUndefined();
  });

  it('the order dialog offers Receive by item, which goes to Inventory with that order chosen', async () => {
    await open();
    expect(button(el, 'Receive stock')).toBeUndefined(); // not in the page header
    rowOf('PO-1003').click();
    await settle();
    expect(button(document.querySelector('#purchase-detail')!, 'Receive stock')).toBeDefined(); // the delivery session is separate
    button(document.querySelector('#purchase-detail')!, 'Receive by item')!.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/items/inventory?receive-order=a');
  });

  it('places an order: pick a supplier and products, with quantity and cost', async () => {
    await open();
    button(el, 'New purchase')!.click();
    await settle();
    const form = document.querySelector('#purchase-form')!;
    expect(form.textContent).toContain('New purchase');
    // Nothing chosen yet.
    button(form, 'Place order')!.click();
    await settle();
    expect(form.textContent).toContain('Choose a supplier');
    expect(fake.calls.created).toEqual([]);

    const choose = async (inputId: string, label: string): Promise<void> => {
      const input = form.querySelector(inputId) as HTMLInputElement;
      input.focus();
      (input.closest('hlm-combobox')!.querySelector('button[data-slot="input-group-button"]') as HTMLElement).click();
      await settle();
      const item = Array.from(document.querySelectorAll<HTMLElement>('hlm-combobox-item')).find((i) => i.textContent?.trim() === label);
      item!.click();
      await settle();
    };
    await choose('#po-supplier', 'Metro');
    await choose('#po-product', 'Rice 25kg');
    await choose('#po-product', 'Milk');
    const quantities = form.querySelectorAll<HTMLInputElement>('input[aria-label^="Quantity of"]');
    expect(quantities).toHaveLength(2);
    // The same product cannot be added twice: Rice is no longer offered.
    await type('input[aria-label="Quantity of Rice 25kg"]', '10', form);
    await type('input[aria-label="Cost of Rice 25kg"]', '95', form);
    await type('input[aria-label="Quantity of Milk"]', '4', form);
    await type('input[aria-label="Cost of Milk"]', '', form);
    button(form, 'Place order')!.click();
    await settle();
    expect(form.textContent).toContain('Enter a quantity and a cost for every product');
    await type('input[aria-label="Cost of Milk"]', '50', form);
    await type('#po-due', '2026-12-01', form);
    await type('#po-ref', ' INV-1 ', form);
    expect(form.textContent!.replace(/\s+/g, '')).toContain('Total₱1,150.00'.replace(/\s+/g, ''));
    button(form, 'Place order')!.click();
    await settle();

    expect(fake.calls.created).toHaveLength(1);
    expect(fake.calls.created[0]).toMatchObject({
      supplierId: 's-Metro',
      expectedAt: null,
      reference: 'INV-1',
      lines: [
        { productId: 'p1', quantityMilli: 10_000, unitCost: 9_500 },
        { productId: 'p2', quantityMilli: 4_000, unitCost: 5_000 },
      ],
    });
    expect(fake.calls.created[0]!.dueAt).toBe(new Date('2026-12-01T23:59:59.999').getTime());
    expect(TestBed.inject(BannerService).current()?.text).toBe('PO-1004 placed');
    expect(document.querySelector('#purchase-form')).toBeNull();
    expect(numbers()).toContain('PO-1004');
  });

  it('has a concerns button by the title that lists late and overdue orders, and a row opens the order', async () => {
    await open([
      ...SAMPLE(), // PO-1003 is overdue for payment
      purchase('d', 'PO-1004', 'Cold Chain', { expectedAt: Date.now() - 3 * DAY }),
    ]);
    const rowsFor = (...ids: string[]): PurchaseConcern[] => fake.rows.filter((r) => ids.includes(r.id)).flatMap((r) => purchaseConcern(summary(r), Date.now()) ?? []);
    badges.set(rowsFor('a', 'd'));
    await settle();
    const button = el.querySelector('button[title="Purchase concerns"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('2');
    button.click();
    await settle();
    const dialog = document.querySelector('hlm-dialog-content, [role="dialog"]')!;
    expect(dialog.textContent).toContain('Purchase concerns');
    const rows = (): string[] => Array.from(dialog.querySelectorAll('li button')).map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows().sort()).toEqual(['PO-1003 MetroPayment 1 day overdue₱1,000.00', 'PO-1004 Cold ChainDelivery 3 days late₱1,000.00']);
    await type('input[aria-label="Filter order or supplier"]', 'cold', dialog);
    expect(rows()).toEqual(['PO-1004 Cold ChainDelivery 3 days late₱1,000.00']);
    (dialog.querySelector('li button') as HTMLElement).click();
    await settle();
    expect(TestBed.inject(Router).url).toContain('view-purchase=d');
    // Resolving one (here the list is refreshed without it) updates the open dialog, and the button's number.
    await type('input[aria-label="Filter order or supplier"]', '', dialog);
    badges.set(rowsFor('a'));
    await settle();
    expect(rows()).toEqual(['PO-1003 MetroPayment 1 day overdue₱1,000.00']);
    expect(el.querySelector('button[title="Purchase concerns"]')!.textContent?.trim()).toBe('1');
  });

  it('has no concerns button when nothing needs attention', async () => {
    await open();
    expect(el.querySelector('button[title="Purchase concerns"]')).toBeNull();
  });

  it('shows what was sent back to the supplier on the order, and what was refunded', async () => {
    const order = purchase('r', 'PO-1009', 'Metro', {
      credited: 30_000,
      owed: 70_000,
      returns: [{ id: 'x1', at: Date.UTC(2026, 10, 12, 9), supplierName: 'Metro', purchaseNumber: 'PO-1009', productId: 'p1', productName: 'Bread', unit: 'each', batchNumber: 'L7', quantityMilli: 4_000, refundAmount: 30_000, creditedAmount: 30_000, note: 'Stale', employeeName: 'Admin' }],
    });
    await open([order], '/purchases?view-purchase=r');
    await settle();
    const box = document.querySelector('hlm-dialog-content, [role="dialog"]')!;
    expect(box.textContent).toContain('Refunded');
    const returns = box.querySelector('[aria-label="Returns"]')!;
    expect(returns.textContent).toContain('Returned · Bread · L7');
    expect(returns.textContent).toContain('4');
    expect(returns.textContent).toContain('₱300.00');
    expect(returns.textContent).toContain('Stale');
  });
});
