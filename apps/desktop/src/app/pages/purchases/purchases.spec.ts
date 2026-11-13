import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { DesktopApi, PayPurchaseInput, PurchaseDetail, PurchaseInput, PurchaseSummary, ReceivePurchaseInput } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
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
  total: 100_000,
  paid: 0,
  owed: 100_000,
  note: null,
  employeeName: 'Register',
  lines: [{ id: `${id}-l1`, productId: 'p1', productName: 'Rice 25kg', unit: 'each', tracking: 'quantity', quantityMilli: 10_000, unitCost: 10_000, total: 100_000 }],
  payments: [],
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
    products: {
      list: () =>
        Promise.resolve([
          { id: 'p1', name: 'Rice 25kg', unit: 'each', tracking: 'quantity', cost: 10_000, barcode: null, deletedAt: null },
          { id: 'p2', name: 'Milk', unit: 'each', tracking: 'expiry', cost: 5_000, barcode: null, deletedAt: null },
        ]),
    },
    suppliers: { list: () => Promise.resolve([{ id: 's-Metro', name: 'Metro', phone: null, note: null, owed: 0, openOrders: 0, createdAt: 1, deletedAt: null }]) },
    purchases: {
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
        const missing = p.lines.find((l) => l.tracking === 'expiry' && !input.lines.find((x) => x.lineId === l.id)?.batchNumber);
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

  async function open(rows = SAMPLE(), url = '/purchases'): Promise<void> {
    fake = fakeApi(rows);
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: fake.api }] });
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

  it('receives an order: lot and expiry are asked for only where the product tracks them', async () => {
    const dated = purchase('d', 'PO-1004', 'Metro', {
      lines: [
        { id: 'd-l1', productId: 'p1', productName: 'Rice 25kg', unit: 'each', tracking: 'quantity', quantityMilli: 2_000, unitCost: 10_000, total: 20_000 },
        { id: 'd-l2', productId: 'p2', productName: 'Milk', unit: 'each', tracking: 'expiry', quantityMilli: 6_000, unitCost: 5_000, total: 30_000 },
      ],
    });
    await open([dated]);
    rowOf('PO-1004').click();
    await settle();
    button(document.querySelector('#purchase-detail')!, 'Receive stock')!.click();
    await settle();
    const form = document.querySelector('#purchase-receive')!;
    expect(form.querySelectorAll('input[id^="rc-lot-"]')).toHaveLength(1); // only Milk
    expect(form.querySelector('#rc-lot-d-l2')).not.toBeNull();
    expect(form.querySelector('#rc-exp-d-l2')).not.toBeNull();

    button(form, 'Receive stock')!.click(); // no lot yet
    await settle();
    expect(form.textContent).toContain('Milk: Enter a batch number');

    await type('#rc-lot-d-l2', 'L-5', form);
    await type('#rc-exp-d-l2', '2027-01-31', form);
    button(form, 'Receive stock')!.click();
    await settle();
    expect(fake.calls.received.at(-1)).toMatchObject({ purchaseId: 'd', lines: [{ lineId: 'd-l1', batchNumber: null, expiresAt: null }, { lineId: 'd-l2', batchNumber: 'L-5' }] });
    expect(TestBed.inject(BannerService).current()?.text).toBe('PO-1004 received into stock');
    expect(document.querySelector('#purchase-receive')).toBeNull();
    expect(text('#purchase-detail')).toContain('Received');
    expect(rowOf('PO-1004').textContent).toContain('Received');
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
});
