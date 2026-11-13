import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type AdjustStockInput,
  type BatchRecord,
  DESKTOP_API_VERSION,
  type DesktopApi,
  type ProductInput,
  type PurchaseDetail,
  type ProductRecord,
  type ReceiveStockInput,
  type RepackageDraft,
  type RepackageInput,
} from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { provideRouter, Router } from '@angular/router';
import { NewProductViewer } from '../../core/new-product-viewer';
import { ScannerService } from '../../core/scanner';
import { InventoryPage } from './inventory';

// jsdom has no ResizeObserver (overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom has no scrollIntoView (the combobox scrolls its highlighted option into view).
Element.prototype.scrollIntoView ??= () => undefined;

const DAY = 86_400_000;
const batch = (id: string, name: string, over: Partial<BatchRecord> = {}): BatchRecord => ({
  id,
  productId: `p-${name}`,
  productName: name,
  productCode: null,
  unit: 'each',
  tracking: 'expiry',
  batchNumber: `L-${id}`,
  receivedAt: Date.now() - 10 * DAY,
  expiresAt: Date.now() + 20 * DAY,
  unitCost: 250,
  unitPrice: 429,
  receivedMilli: 10_000,
  onHandMilli: 6_000,
  ...over,
});

const product = (id: string, name: string, over: Partial<ProductRecord> = {}): ProductRecord => ({
  id,
  name,
  sku: null,
  barcode: `590${id}`,
  categories: [],
  price: 429,
  cost: 250,
  unit: 'each',
  tracking: 'expiry',
  shelfLifeDays: 7,
  onHandMilli: 0,
  nextExpiry: null,
  active: true,
  createdAt: 1,
  deletedAt: null,
  ...over,
});

function fakeApi(initial: BatchRecord[], catalog: ProductRecord[] = [], orders: PurchaseDetail[] = []) {
  const rows = [...initial];
  const drafts = { saved: null as RepackageDraft | null };
  const calls = { adjust: [] as AdjustStockInput[], receive: [] as ReceiveStockInput[], repackage: [] as RepackageInput[] };
  const api = {
    platform: 'linux',
    version: () => Promise.resolve(DESKTOP_API_VERSION),
    scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
    purchases: {
      list: () => Promise.resolve(orders.map(({ lines: _l, payments: _p, note: _n, employeeName: _e, ...summary }) => summary)),
      get: (id: string) => Promise.resolve(orders.find((o) => o.id === id) ?? null),
    },
    products: {
      list: () => Promise.resolve([...catalog]),
      loadDraft: () => Promise.resolve(null),
      saveDraft: () => Promise.resolve(),
      clearDraft: () => Promise.resolve(),
      create: (input: ProductInput) => {
        const created = product(`n${catalog.length}`, input.name, { barcode: input.barcode, tracking: input.tracking, price: input.price, cost: input.cost });
        catalog.push(created);
        return Promise.resolve({ ok: true as const, product: created });
      },
    },
    inventory: {
      listBatches: (options?: { includeEmpty?: boolean }) => Promise.resolve(rows.filter((b) => options?.includeEmpty || b.onHandMilli > 0)),
      receive: (input: ReceiveStockInput) => {
        calls.receive.push(input);
        for (const order of orders) {
          const line = order.lines.find((l) => l.id === input.purchaseLineId);
          if (!line) continue;
          line.receivedMilli += input.quantityMilli;
          order.partlyReceived = true;
          if (order.lines.every((l) => l.receivedMilli >= l.quantityMilli)) Object.assign(order, { status: 'received', partlyReceived: false });
        }
        const created = batch(`new-${rows.length}`, 'Milk', { batchNumber: input.batchNumber, expiresAt: input.expiresAt, onHandMilli: input.quantityMilli, receivedMilli: input.quantityMilli });
        rows.push(created);
        return Promise.resolve({ ok: true as const, batch: created });
      },
      loadRepackageDraft: () => Promise.resolve(drafts.saved),
      saveRepackageDraft: (draft: RepackageDraft) => {
        drafts.saved = draft;
        return Promise.resolve();
      },
      clearRepackageDraft: () => {
        drafts.saved = null;
        return Promise.resolve();
      },
      repackage: (input: RepackageInput) => {
        calls.repackage.push(input);
        return Promise.resolve({ ok: true as const, repackageId: 'rp-1' });
      },
      adjust: (input: AdjustStockInput) => {
        calls.adjust.push(input);
        const row = rows.find((b) => b.id === input.batchId)!;
        row.onHandMilli += input.type === 'adjust' ? input.quantityMilli : -Math.abs(input.quantityMilli);
        return Promise.resolve({ ok: true as const, batch: row });
      },
    },
  } as unknown as DesktopApi;
  return { api, calls, drafts };
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('InventoryPage', () => {
  let fixture: ComponentFixture<InventoryPage>;
  let el: HTMLElement;
  let calls: ReturnType<typeof fakeApi>['calls'];
  let drafts: ReturnType<typeof fakeApi>['drafts'];

  async function open(rows: BatchRecord[], catalog: ProductRecord[] = [], orders: PurchaseDetail[] = [], url = ''): Promise<void> {
    const fake = fakeApi(rows, catalog, orders);
    calls = fake.calls;
    drafts = fake.drafts;
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DESKTOP_API, useValue: fake.api }] });
    TestBed.inject(ScannerService);
    if (url) await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(InventoryPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fixture.whenStable();
    }
  };
  const bodyRows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('[role="row"]')].filter((r) => r.querySelector('[role="cell"]'));
  const cells = (row: HTMLElement): string[] => [...row.querySelectorAll('[role="cell"]')].map((c) => c.textContent!.trim());
  const names = (): string[] => bodyRows().map((r) => cells(r)[1]!);
  const type = async (root: ParentNode, selector: string, value: string): Promise<void> => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const dialog = (): HTMLElement => document.querySelector('hlm-dialog-content') as HTMLElement;
  const tick = (label: string): HTMLElement => el.querySelector(`[aria-label="${label}"]`) as HTMLElement;

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  it('lists batches soonest-expiring first, with a status for each expiry', async () => {
    await open([
      batch('1', 'Cheese', { expiresAt: Date.now() + 30 * DAY }),
      batch('2', 'Milk', { expiresAt: Date.now() - 2 * DAY }),
      batch('3', 'Yogurt', { expiresAt: Date.now() + 1 * DAY }),
      batch('4', 'Rice', { expiresAt: null, tracking: 'batch' }),
    ]);
    expect(names()).toEqual(['Milk', 'Yogurt', 'Cheese', 'Rice']); // no expiry last
    const status = (row: number): string => cells(bodyRows()[row]!)[4]!;
    expect(status(0)).toBe('Expired');
    expect(status(1)).toBe('Expiring soon');
    expect(status(2)).toBe('OK');
    expect(status(3)).toBe('No expiry');
    expect(el.textContent).toContain('6'); // on hand
  });

  it('hides used-up batches until Show empty is on', async () => {
    await open([batch('1', 'Milk'), batch('2', 'Old', { onHandMilli: 0 })]);
    expect(names()).toEqual(['Milk']);
    (el.querySelector('hlm-switch button') as HTMLElement).click();
    await settle();
    expect(names().sort()).toEqual(['Milk', 'Old']);
    expect(el.textContent).toContain('Empty');
  });

  it('has a filter under each title and a reset button', async () => {
    await open([batch('1', 'Milk'), batch('2', 'Cheese', { expiresAt: Date.now() - DAY })]);
    const reset = (): HTMLButtonElement => el.querySelector('button[aria-label="Reset filters"]') as HTMLButtonElement;
    expect(reset().disabled).toBe(true);
    await type(el, 'input[aria-label="Filter product"]', 'chee');
    expect(names()).toEqual(['Cheese']);
    expect(reset().disabled).toBe(false);
    reset().click();
    await fixture.whenStable();
    expect(names()).toHaveLength(2);
    await type(el, 'input[aria-label="Filter batch"]', 'L-1');
    expect(names()).toEqual(['Milk']);
  });

  it('sorts by a column and reverses on a second click', async () => {
    await open([batch('1', 'Milk', { onHandMilli: 9_000 }), batch('2', 'Eggs', { onHandMilli: 3_000 })]);
    const header = (label: string): HTMLButtonElement => [...el.querySelectorAll('[role="columnheader"] button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    header('On hand').click();
    await fixture.whenStable();
    expect(names()).toEqual(['Eggs', 'Milk']);
    header('On hand').click();
    await fixture.whenStable();
    expect(names()).toEqual(['Milk', 'Eggs']);
  });

  it('opens the adjust form from a row and removes the quantity as waste', async () => {
    await open([batch('1', 'Milk')]);
    bodyRows()[0]!.click();
    await settle();
    expect(dialog().textContent).toContain('Adjust stock');
    await type(dialog(), '#a-qty', '2');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.adjust).toEqual([{ batchId: '1', type: 'waste', quantityMilli: 2000, note: null }]);
    expect(document.querySelector('hlm-dialog-content')).toBeNull();
    expect(cells(bodyRows()[0]!)[5]).toContain('4'); // 6 - 2
  });

  it('writes off a selection only after a confirmation, taking the whole remaining quantity', async () => {
    await open([batch('1', 'Milk', { expiresAt: Date.now() - DAY }), batch('2', 'Cheese'), batch('3', 'Eggs')]);
    tick('Select Milk L-1').click();
    tick('Select Cheese L-2').click();
    await settle();
    expect(el.textContent).toContain('2 selected');
    buttonByText(el, 'Write off 2').click();
    await settle();
    expect(calls.adjust).toHaveLength(0); // asks first
    expect(document.querySelector('hlm-alert-dialog-content')?.textContent).toContain('Write off 2 batches?');
    ([...document.querySelectorAll('[hlmAlertDialogAction]')].pop() as HTMLButtonElement).click();
    await settle();
    expect(calls.adjust.map((a) => [a.batchId, a.type, a.quantityMilli])).toEqual([['1', 'expired', 6000], ['2', 'waste', 6000]]);
    expect(names()).toEqual(['Eggs']);
  });

  it('receives stock for a tracked product, pre-filling cost and expiry from the product', async () => {
    await open([], [product('1', 'Milk', { shelfLifeDays: 7, cost: 250 })]);
    buttonByText(el, 'Receive stock').click();
    await settle();
    expect(dialog().textContent).toContain('Receive stock');
    // Pick the product the way a scan does.
    TestBed.inject(ScannerService).receive('5901');
    await settle();
    expect((dialog().querySelector('#r-cost') as HTMLInputElement).value).toBe('2.50');
    expect((dialog().querySelector('#r-expiry') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await type(dialog(), '#r-lot', 'L99');
    await type(dialog(), '#r-qty', '12');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    expect(calls.receive).toHaveLength(1);
    expect(calls.receive[0]).toMatchObject({ productId: '1', batchNumber: 'L99', quantityMilli: 12_000, unitCost: 250 });
    expect(calls.receive[0]!.expiresAt).toBeGreaterThan(Date.now());
    expect(names()).toEqual(['Milk']);
  });

  it('a scan for an unknown product offers to create it over the dialog, then picks it', async () => {
    await open([], [product('1', 'Milk', { tracking: 'none' })]);
    TestBed.inject(NewProductViewer); // started at launch by the app root
    buttonByText(el, 'Receive stock').click();
    await settle();
    const scanner = TestBed.inject(ScannerService);

    scanner.receive('5901'); // exists, but stock is not tracked for it
    await settle();
    expect(dialog().textContent).toContain('Stock is not tracked for Milk');
    expect(buttonByText(dialog(), 'Create product')).toBeUndefined();

    scanner.receive('4800123');
    await settle();
    expect(dialog().textContent).toContain('No product with code 4800123');
    buttonByText(dialog(), 'Create product').click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/?new-product=4800123');
    const form = document.querySelector('#product-form')!;
    expect(form.textContent).toContain('Add product');
    expect((form.querySelector('#p-barcode') as HTMLInputElement).value).toBe('4800123');
    await type(form, '#p-name', 'Instant coffee');
    await type(form, '#p-price', '12');
    buttonByText(form, 'Save').click();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/'); // the parameter is gone
    expect(document.querySelector('#product-form')).toBeNull();
    // Back in Receive stock the new product is already chosen (it tracks stock by quantity).
    expect((dialog().querySelector('input#r-product, #r-product input') as HTMLInputElement).value).toBe('Instant coffee');
    expect(buttonByText(dialog(), 'Create product')).toBeUndefined();
  });

  it('Receive another keeps the dialog open and clears the form after each receipt', async () => {
    await open([], [product('1', 'Milk', { tracking: 'quantity', cost: 250 }), product('2', 'Eggs', { tracking: 'quantity', cost: 900 })]);
    buttonByText(el, 'Receive stock').click();
    await settle();
    (dialog().querySelector('hlm-checkbox button, hlm-checkbox [role="checkbox"]') as HTMLElement).click();
    await settle();
    const scanner = TestBed.inject(ScannerService);

    scanner.receive('5901');
    await settle();
    await type(dialog(), '#r-qty', '12');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    expect(dialog()).not.toBeNull(); // still open
    expect(calls.receive).toHaveLength(1);
    expect((dialog().querySelector('input#r-product, #r-product input') as HTMLInputElement).value).toBe('');
    expect(dialog().querySelector('#r-qty')).toBeNull(); // the fields wait for the next product
    expect(buttonByText(dialog(), 'Close')).toBeDefined();

    scanner.receive('5902');
    await settle();
    expect((dialog().querySelector('#r-cost') as HTMLInputElement).value).toBe('9.00');
    await type(dialog(), '#r-qty', '3');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    expect(calls.receive.map((r) => [r.productId, r.quantityMilli])).toEqual([['1', 12_000], ['2', 3_000]]);
  });

  it('Edit product opens the product over Receive stock, also for one that tracks no stock', async () => {
    await open([], [product('1', 'Milk', { tracking: 'quantity' }), product('2', 'Tea', { tracking: 'none' })]);
    buttonByText(el, 'Receive stock').click();
    await settle();
    TestBed.inject(ScannerService).receive('5901');
    await settle();
    expect(dialog().querySelector('#r-lot')).toBeNull(); // tracked by quantity only: no lot to enter
    expect(dialog().textContent).toContain('Tracked by quantity');
    buttonByText(dialog(), 'Edit product').click();
    await settle();
    const form = document.querySelector('#product-form')!;
    expect((form.querySelector('#p-name') as HTMLInputElement).value).toBe('Milk');
    buttonByText(form, 'Close').click();
    await settle();
    expect(document.querySelector('#product-form')).toBeNull();

    TestBed.inject(ScannerService).receive('5902'); // exists but stock is not tracked
    await settle();
    expect(dialog().textContent).toContain('Stock is not tracked for Tea');
    expect(dialog().querySelector('#r-qty')).toBeNull();
    expect(buttonByText(dialog(), 'Receive').disabled).toBe(true);
    expect(buttonByText(dialog(), 'Edit product')).toBeDefined();
  });

  it('receives against a purchase order: its products only, quantity and cost from the order, until it is complete', async () => {
    const line = (id: string, productId: string, productName: string, quantityMilli: number, unitCost: number): PurchaseDetail['lines'][number] => ({ id, productId, productName, productCode: null, unit: 'each', tracking: 'quantity', quantityMilli, receivedMilli: 0, unitCost, total: 0 });
    const order = {
      id: 'o1', number: 'PO-1001', supplierId: 's', supplierName: 'Metro', status: 'ordered', orderedAt: 1, expectedAt: null, dueAt: null, receivedAt: null, reference: null, lineCount: 2,
      partlyReceived: false, total: 0, paid: 0, owed: 0, note: null, employeeName: null, payments: [],
      lines: [line('l1', '1', 'Milk', 10_000, 4_000), line('l2', '2', 'Eggs', 3_000, 900)],
    } as PurchaseDetail;
    await open([], [product('1', 'Milk', { tracking: 'quantity' }), product('2', 'Eggs', { tracking: 'quantity' }), product('3', 'Tea', { tracking: 'quantity' })], [order]);
    buttonByText(el, 'Receive stock').click();
    await settle();
    const choose = async (inputId: string, label: string): Promise<void> => {
      const input = dialog().querySelector(inputId) as HTMLInputElement;
      input.focus();
      (input.closest('hlm-combobox')!.querySelector('button[data-slot="input-group-button"]') as HTMLElement).click();
      await settle();
      [...document.querySelectorAll<HTMLElement>('hlm-combobox-item')].find((i) => i.textContent?.trim().startsWith(label))!.click();
      await settle();
    };
    await choose('#r-order', 'PO-1001');
    const scanner = TestBed.inject(ScannerService);

    scanner.receive('5903'); // Tea is not on the order
    await settle();
    expect(dialog().textContent).toContain('Tea is not waiting on PO-1001');

    scanner.receive('5901');
    await settle();
    expect(dialog().textContent).toContain('Ordered 10 · received 0 · 10 left');
    expect((dialog().querySelector('#r-qty') as HTMLInputElement).value).toBe('10');
    expect((dialog().querySelector('#r-cost') as HTMLInputElement).value).toBe('40.00');
    await type(dialog(), '#r-qty', '6');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    expect(calls.receive[0]).toMatchObject({ productId: '1', quantityMilli: 6_000, unitCost: 4_000, purchaseLineId: 'l1' });
    expect(order.partlyReceived).toBe(true);
  });

  it('?receive-order=<id> opens Receive stock with that order chosen, then drops the parameter', async () => {
    const order = {
      id: 'o1', number: 'PO-1001', supplierId: 's', supplierName: 'Metro', status: 'ordered', orderedAt: 1, expectedAt: null, dueAt: null, receivedAt: null, reference: null, lineCount: 1,
      partlyReceived: false, total: 0, paid: 0, owed: 0, note: null, employeeName: null, payments: [],
      lines: [{ id: 'l1', productId: '1', productName: 'Milk', productCode: null, unit: 'each', tracking: 'quantity', quantityMilli: 5_000, receivedMilli: 0, unitCost: 4_000, total: 0 }],
    } as PurchaseDetail;
    await open([], [product('1', 'Milk', { tracking: 'quantity' })], [order], '/?receive-order=o1');
    await settle();
    expect(dialog().textContent).toContain('Receive stock');
    expect((dialog().querySelector('input#r-order, #r-order input') as HTMLInputElement).value).toBe('PO-1001');
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('an order of products that track no stock still lists them, marked not tracked, instead of an empty list', async () => {
    const order = {
      id: 'o1', number: 'PO-1001', supplierId: 's', supplierName: 'Metro', status: 'ordered', orderedAt: 1, expectedAt: null, dueAt: null, receivedAt: null, reference: null, lineCount: 1,
      partlyReceived: false, total: 0, paid: 0, owed: 0, note: null, employeeName: null, payments: [],
      lines: [{ id: 'l1', productId: '1', productName: 'Tea', productCode: null, unit: 'each', tracking: 'none', quantityMilli: 5_000, receivedMilli: 0, unitCost: 400, total: 0 }],
    } as PurchaseDetail;
    await open([], [product('1', 'Tea', { tracking: 'none' }), product('2', 'Milk', { tracking: 'quantity' })], [order], '/?receive-order=o1');
    await settle();
    const input = dialog().querySelector('input#r-product, #r-product input') as HTMLInputElement;
    input.focus();
    (input.closest('hlm-combobox')!.querySelector('button[data-slot="input-group-button"]') as HTMLElement).click();
    await settle();
    const items = [...document.querySelectorAll('hlm-combobox-item')].map((i) => i.textContent!.replace(/\s+/g, ' ').trim());
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Tea');
    expect(items[0]).toContain('Not tracked');

    // The checkbox above the list widens it to every product (those are received on their own, not against the order).
    expect(dialog().textContent).toContain('Only products on PO-1001');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    (dialog().querySelector('hlm-checkbox button, hlm-checkbox [role="checkbox"]') as HTMLElement).click();
    await settle();
    input.focus();
    (input.closest('hlm-combobox')!.querySelector('button[data-slot="input-group-button"]') as HTMLElement).click();
    await settle();
    expect([...document.querySelectorAll('hlm-combobox-item')].map((i) => i.textContent!.trim().slice(0, 3)).sort()).toEqual(['Mil', 'Tea']);
  });

  it('takes an expiry given as a month only, as the last day of that month', async () => {
    await open([], [product('1', 'Milk', { shelfLifeDays: null })]);
    buttonByText(el, 'Receive stock').click();
    await settle();
    TestBed.inject(ScannerService).receive('5901');
    await settle();
    buttonByText(dialog(), 'Month').click();
    await settle();
    await type(dialog(), '#r-expiry-month', '2027-02');
    await type(dialog(), '#r-lot', 'L5');
    await type(dialog(), '#r-qty', '3');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    const expiresAt = calls.receive[0]!.expiresAt!;
    expect(new Date(expiresAt).getFullYear()).toBe(2027);
    expect(new Date(expiresAt).getMonth()).toBe(1); // February
    expect(new Date(expiresAt).getDate()).toBe(28); // its last day (2027 is not a leap year)
  });

  it('the Expires filter treats a first date as a single day until the end date is changed or cleared', async () => {
    await open([
      batch('1', 'A', { expiresAt: new Date(2026, 5, 10, 9).getTime() }),
      batch('2', 'B', { expiresAt: new Date(2026, 5, 11, 9).getTime() }),
      batch('3', 'C', { expiresAt: new Date(2026, 5, 12, 9).getTime() }),
    ]);
    (el.querySelector('button[aria-label="Expires date range"]') as HTMLElement).click();
    await fixture.whenStable();
    await type(document, 'input[aria-label="Expires from"]', '2026-06-11');
    expect(names()).toEqual(['B']); // exactly that day
    await type(document, 'input[aria-label="Expires to"]', '2026-06-12');
    expect(names()).toEqual(['B', 'C']);
    await type(document, 'input[aria-label="Expires to"]', '');
    expect(names()).toEqual(['B', 'C']); // from the 11th on
  });

  it('asks for the expiry date and a valid quantity before receiving', async () => {
    await open([], [product('1', 'Milk', { shelfLifeDays: null })]);
    buttonByText(el, 'Receive stock').click();
    await settle();
    TestBed.inject(ScannerService).receive('5901');
    await settle();
    await type(dialog(), '#r-lot', 'L1');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    expect(dialog().textContent).toContain('Enter a valid quantity');
    await type(dialog(), '#r-qty', '3');
    buttonByText(dialog(), 'Receive').click();
    await settle();
    expect(dialog().textContent).toContain('Enter an expiry date');
    expect(calls.receive).toHaveLength(0);
  });
  it('repackages a scanned product into another one and sends both quantities', async () => {
    await open([], [product('1', 'Rice sack', { unit: 'each' }), product('2', 'Rice', { unit: 'kg' })]);
    buttonByText(el, 'Repackage').click();
    await settle();
    expect(dialog().textContent).toContain('Repackage');
    TestBed.inject(ScannerService).receive('5901'); // picks the sack to open
    await settle();
    await type(dialog(), '#rp-qty', '1');
    // Choose the target in the second combobox.
    const targetInput = dialog().querySelector('#rp-target-0') as HTMLInputElement;
    targetInput.focus();
    const trigger = targetInput.closest('hlm-combobox')!.querySelector('button[data-slot="input-group-button"]') as HTMLElement;
    trigger.click();
    await settle();
    const option = [...document.querySelectorAll('hlm-combobox-item')].find((i) => i.textContent?.trim() === 'Rice') as HTMLElement;
    option.click();
    await settle();
    await type(dialog(), 'input[aria-label="Quantity (kg)"]', '48.5');
    buttonByText(dialog(), 'Repackage').click();
    await settle();
    expect(calls.repackage).toEqual([
      { productId: '1', quantityMilli: 1_000, targets: [{ productId: '2', quantityMilli: 48_500, expiresAt: null }], note: null },
    ]);
  });

  it('asks for a quantity and a target before repackaging', async () => {
    await open([], [product('1', 'Rice sack'), product('2', 'Rice', { unit: 'kg' })]);
    buttonByText(el, 'Repackage').click();
    await settle();
    TestBed.inject(ScannerService).receive('5901');
    await settle();
    buttonByText(dialog(), 'Repackage').click();
    await settle();
    expect(dialog().textContent).toContain('Enter a valid quantity');
    await type(dialog(), '#rp-qty', '1');
    buttonByText(dialog(), 'Repackage').click();
    await settle();
    expect(dialog().textContent).toContain('Choose the product to repackage into');
    expect(calls.repackage).toHaveLength(0);
  });
  it('saves the Repackage form as a draft, restores it, and drops it once saved', async () => {
    await open([], [product('1', 'Rice sack'), product('2', 'Rice', { unit: 'kg' })]);
    buttonByText(el, 'Repackage').click();
    await settle();
    TestBed.inject(ScannerService).receive('5901');
    await type(dialog(), '#rp-qty', '2');
    await new Promise((resolve) => setTimeout(resolve, 400)); // the save is debounced
    await settle();
    expect(drafts.saved).toMatchObject({ productId: '1', quantity: '2' });
    buttonByText(dialog(), 'Close').click(); // closing keeps the draft
    await settle();
    expect(drafts.saved).toMatchObject({ quantity: '2' });
    buttonByText(el, 'Repackage').click();
    await settle();
    expect((dialog().querySelector('#rp-qty') as HTMLInputElement).value).toBe('2');
    buttonByText(dialog(), 'Reset').click(); // reset drops it
    await settle();
    expect((dialog().querySelector('#rp-qty') as HTMLInputElement).value).toBe('');
    expect(drafts.saved).toBeNull();
  });
});
