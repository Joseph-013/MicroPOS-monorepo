import { ComponentFixture, TestBed } from '@angular/core/testing';
import { type CatalogProduct, type CheckoutDraft, type CompleteOrderInput, type CompleteOrderResult, DESKTOP_API_VERSION, type DesktopApi } from '@micropos/core';
import { Router } from '@angular/router';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { CheckoutDraftService } from '../../core/data/checkout-draft.service';
import { ScannerService } from '../../core/scanner';
import { CheckoutPage } from './checkout';

// jsdom has no ResizeObserver (some overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const p = (id: string, name: string, price: number, categoryNames: string[], n: number): CatalogProduct => ({
  id,
  name,
  price,
  categories: categoryNames.map((name) => ({ id: name, name })),
  unit: 'each',
  tracking: 'none',
  sku: `PRD-0000${n}`,
  barcode: `59000000000${n}${n}`,
});
const PRODUCTS = [
  p('1', 'Bananas (bunch)', 179, ['Produce', 'Snacks', 'Fruit', 'Organic'], 1),
  p('2', 'Whole Milk (1 gal)', 429, ['Dairy', 'Beverages'], 2),
  p('3', 'Large Eggs (dozen)', 349, ['Dairy'], 3),
  { ...p('4', 'Ground Beef', 899, [], 4), unit: 'kg' as const },
];
/** A fake bridge whose draft storage is an in-memory slot we can inspect. */
function fakeApi(initialDraft: CheckoutDraft | null = null) {
  const store = {
    draft: initialDraft,
    saves: 0,
    clears: 0,
    orders: [] as CompleteOrderInput[],
    /** What the fake main process answers when an order is completed. */
    result: null as CompleteOrderResult | null,
  };
  const api: DesktopApi = {
    platform: 'linux',
    version: () => Promise.resolve(DESKTOP_API_VERSION),
    categories: {
      list: () => Promise.resolve([]),
      create: () => Promise.reject(new Error('unused')),
      update: () => Promise.reject(new Error('unused')),
      remove: () => Promise.resolve(),
      restore: () => Promise.resolve({ restored: 0, conflicts: [] }),
    },
    inventory: {
      listBatches: () => Promise.resolve([]),
      overview: () => Promise.reject(new Error('unused')),
      receive: () => Promise.reject(new Error('unused')),
      adjust: () => Promise.reject(new Error('unused')),
      repackage: () => Promise.reject(new Error('unused')),
      loadRepackageDraft: () => Promise.resolve(null),
      saveRepackageDraft: () => Promise.resolve(),
      clearRepackageDraft: () => Promise.resolve(),
    },
    scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
    catalog: {
      listProducts: () => Promise.resolve(PRODUCTS),
      listCategories: () => Promise.resolve([{ id: 'Dairy', name: 'Dairy' }, { id: 'Produce', name: 'Produce' }]),
    },
    products: {
      list: () => Promise.resolve([]),
      create: () => Promise.reject(new Error('unused')),
      update: () => Promise.reject(new Error('unused')),
      remove: () => Promise.resolve(),
      restore: () => Promise.resolve({ restored: 0, conflicts: [] }),
      setActive: () => Promise.resolve(),
      loadDraft: () => Promise.resolve(null),
      saveDraft: () => Promise.resolve(),
      clearDraft: () => Promise.resolve(),
    },
    orders: { list: () => Promise.resolve([]), get: () => Promise.resolve(null), void: () => Promise.reject(new Error('unused')), refund: () => Promise.reject(new Error('unused')) },
    checkout: {
      loadDraft: () => Promise.resolve(store.draft),
      saveDraft: (draft) => {
        store.saves++;
        store.draft = draft.lines.length ? draft : null;
        return Promise.resolve();
      },
      clearDraft: () => {
        store.clears++;
        store.draft = null;
        return Promise.resolve();
      },
      nextOrderNumber: () => Promise.resolve(`SO-${1001 + store.orders.length}`),
      completeOrder: (input) => {
        store.orders.push(input);
        const result = store.result ?? { ok: true as const, orderId: 'o', orderNumber: `SO-${1000 + store.orders.length}`, total: 0, change: 0 };
        if (result.ok) store.draft = null;
        return Promise.resolve(result);
      },
    },
  };
  return { api, store };
}

/** Simulates a scan: the Electron main process detects it and sends the code to the page. */
function scan(code: string): void {
  TestBed.inject(ScannerService).receive(code);
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('CheckoutPage', () => {
  let fixture: ComponentFixture<CheckoutPage>;
  let el: HTMLElement;

  let store: ReturnType<typeof fakeApi>['store'];

  async function open(initialDraft: CheckoutDraft | null = null): Promise<void> {
    TestBed.resetTestingModule();
    const fake = fakeApi(initialDraft);
    store = fake.store;
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: fake.api }] });
    TestBed.inject(ScannerService);
    fixture = TestBed.createComponent(CheckoutPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear(); // settings (on-screen keyboard) start from their defaults
    return open();
  });
  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  const articles = (): number => document.querySelectorAll('article').length;
  const search = async (text: string): Promise<void> => {
    const input = document.querySelector('input[aria-label^="Search"]') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };

  it('starts with an empty order, payment controls on the right and no item grid on the page', () => {
    expect(el.textContent).toContain('No items yet');
    expect(el.textContent).toContain('Complete Order');
    expect(el.textContent).toContain('₱0.00');
    expect(el.querySelectorAll('article').length).toBe(0);
  });

  it('shows products from the database in the dialog and adds them to the order', async () => {
    buttonByText(el, 'Add items').click();
    await fixture.whenStable();
    expect(articles()).toBe(PRODUCTS.length);

    await search('whole milk');
    expect(articles()).toBe(1);
    const add = document.querySelector('article button') as HTMLButtonElement;
    add.click();
    add.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Whole Milk (1 gal)');
    expect(el.textContent).toContain('₱8.58'); // 2 x 4.29

    buttonByText(document.body, 'Done').click();
    await fixture.whenStable();
  });

  it('shows every category of a product as a tag, collapsing extras into +N', async () => {
    buttonByText(el, 'Add items').click();
    await fixture.whenStable();
    const card = (name: string) => [...document.querySelectorAll('article')].find((a) => a.textContent?.includes(name))!;
    const tags = (name: string) => [...card(name).querySelectorAll('[hlmBadge]')].map((t) => t.textContent?.trim());

    expect(tags('Whole Milk')).toEqual(['Dairy', 'Beverages']);
    expect(tags('Large Eggs')).toEqual(['Dairy']);
    expect(tags('Bananas')).toEqual(['Produce', 'Snacks', '+2']); // 4 categories: two shown, two folded
    buttonByText(document.body, 'Done').click();
    await fixture.whenStable();
  });

  it('confirms an item added from the browser in a success banner', async () => {
    const banner = TestBed.inject(BannerService);
    buttonByText(el, 'Add items').click();
    await fixture.whenStable();
    await search('bananas');
    const add = document.querySelector('article button') as HTMLButtonElement;
    add.click();
    await fixture.whenStable();
    expect(banner.current()).toMatchObject({ text: 'Bananas (bunch) added', severity: 'success', durationMs: 1500 });
    buttonByText(document.body, 'Done').click();
    await fixture.whenStable();
  });

  it('clears the search with its x button and resets all filters with the reset button', async () => {
    buttonByText(el, 'Add items').click();
    await fixture.whenStable();
    const reset = document.querySelector('button[aria-label="Reset filters"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(true); // nothing filtered yet
    await search('bananas');
    expect(document.querySelectorAll('article')).toHaveLength(1);
    expect(reset.disabled).toBe(false);
    (document.querySelector('button[aria-label="Clear search"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect((document.querySelector('input[aria-label^="Search"]') as HTMLInputElement).value).toBe('');
    expect(document.querySelectorAll('article').length).toBeGreaterThan(1);
    await search('bananas');
    reset.click();
    await fixture.whenStable();
    expect(document.querySelectorAll('article').length).toBeGreaterThan(1);
    expect(reset.disabled).toBe(true);
    buttonByText(document.body, 'Done').click();
    await fixture.whenStable();
  });

  it('searches name, barcode and SKU in one box', async () => {
    buttonByText(el, 'Add items').click();
    await fixture.whenStable();
    const milk = PRODUCTS[1];
    for (const term of [milk.name, milk.name.toUpperCase(), milk.barcode!, milk.sku!, milk.barcode!.slice(-5)]) {
      await search(term);
      expect(articles(), term).toBe(1);
      expect(document.querySelector('article')?.textContent).toContain('Whole Milk');
    }
    await search('no such item');
    expect(articles()).toBe(0);
    expect(document.body.textContent).toContain('No items found');
    buttonByText(document.body, 'Done').click();
    await fixture.whenStable();
  });

  it('claims the scanner: a scanned barcode adds that item, an unknown one is reported', async () => {
    scan(PRODUCTS[0].barcode!);
    await fixture.whenStable();
    expect(el.textContent).toContain('Bananas (bunch)');
    expect(el.textContent).toContain('₱1.79');

    scan(PRODUCTS[0].barcode!);
    await fixture.whenStable();
    expect(el.textContent).toContain('₱3.58');

    scan('9999999999994');
    await fixture.whenStable();
    const banner = TestBed.inject(BannerService).current();
    expect(banner).toMatchObject({ text: 'Unknown barcode 9999999999994', severity: 'warning', durationMs: 4000 });
    expect(el.textContent).toContain('₱3.58'); // the order is unchanged
  });

  it('steps quantities and removes a line at zero', async () => {
    scan(PRODUCTS[2].barcode!);
    await fixture.whenStable();
    (el.querySelector('button[aria-label="Increase quantity"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.textContent).toContain('₱6.98');
    const dec = el.querySelector('button[aria-label="Decrease quantity"]') as HTMLButtonElement;
    dec.click();
    dec.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('No items yet');
  });

  /** Waits (up to 1 s) for the confirmation dialog to finish closing and leave the page. */
  const dialogGone = async (): Promise<void> => {
    for (let i = 0; i < 20 && document.querySelector('hlm-alert-dialog-content'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fixture.whenStable();
    }
    expect(document.querySelector('hlm-alert-dialog-content')).toBeNull();
  };

  describe('draft', () => {
    const flush = async (): Promise<void> => {
      TestBed.inject(CheckoutDraftService).flush();
      await fixture.whenStable();
    };

    it('saves the order automatically as items are added and changed', async () => {
      scan(PRODUCTS[0].barcode!);
      scan(PRODUCTS[0].barcode!);
      await fixture.whenStable();
      await flush();
      expect(store.draft?.lines).toEqual([{ productId: '1', name: 'Bananas (bunch)', quantityMilli: 2000, unitPrice: 179, unit: 'each' }]);

      (el.querySelector('button[aria-label="Decrease quantity"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      await flush();
      expect(store.draft?.lines[0].quantityMilli).toBe(1000);
    });

    it('turns quick successive changes into one write', async () => {
      const before = store.saves;
      for (let i = 0; i < 5; i++) scan(PRODUCTS[0].barcode!);
      await fixture.whenStable();
      await flush();
      expect(store.saves - before).toBe(1);
      expect(store.draft?.lines[0].quantityMilli).toBe(5000);
    });

    it('restores a saved draft when the page opens', async () => {
      fixture.destroy();
      await open({ lines: [{ productId: '2', name: 'Whole Milk (1 gal)', quantityMilli: 3000, unitPrice: 429, unit: 'each' as const }] });
      expect(el.textContent).toContain('Whole Milk (1 gal)');
      expect(el.textContent).toContain('₱12.87'); // 3 x 4.29
    });

    it('restores a draft saved in the older whole-unit shape without NaN, and drops lines it cannot read', async () => {
      fixture.destroy();
      const legacy = {
        lines: [
          { productId: '2', name: 'Whole Milk (1 gal)', quantity: 3, unitPrice: 429 },
          { productId: '9', name: 'Broken', unitPrice: 100 },
          { productId: '8', name: 'Bad price', quantityMilli: 1000, unitPrice: 'x' },
        ],
      } as unknown as CheckoutDraft;
      await open(legacy);
      expect(el.textContent).not.toContain('NaN');
      expect(el.textContent).toContain('₱12.87'); // 3 x 4.29
      expect(el.textContent).not.toContain('Broken');
      expect(el.querySelectorAll('li')).toHaveLength(1);
    });

    it('does not wipe a saved draft just because the page opened empty', async () => {
      fixture.destroy();
      await open({ lines: [{ productId: '2', name: 'Whole Milk (1 gal)', quantityMilli: 1000, unitPrice: 429, unit: 'each' as const }] });
      await flush();
      expect(store.draft?.lines).toHaveLength(1);
    });

    it('saves the last change when the page is left before the delay ends', async () => {
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      expect(store.draft).toBeNull(); // still waiting
      fixture.destroy();
      expect(store.draft?.lines[0].productId).toBe('2');
    });

    it('clears the order and the saved draft after confirmation, and only then', async () => {
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      await flush();
      expect(store.draft).not.toBeNull();

      buttonByText(el, 'Clear').click();
      await fixture.whenStable();
      expect(document.body.textContent).toContain('Clear this order?');
      expect(el.textContent).toContain('Whole Milk'); // nothing happens until confirmed

      buttonByText(document.body, 'Cancel').click();
      await fixture.whenStable();
      expect(el.textContent).toContain('Whole Milk');
      await dialogGone();

      buttonByText(el, 'Clear').click();
      await fixture.whenStable();
      const confirm = [...document.querySelectorAll('[hlmAlertDialogAction]')].pop() as HTMLButtonElement;
      confirm.click();
      await fixture.whenStable();
      expect(el.textContent).toContain('No items yet');
      expect(store.draft).toBeNull();
      expect(store.clears).toBe(1);
      await dialogGone(); // and the confirmation closes by itself
    });

    it('disables Clear while the order is empty', () => {
      expect(buttonByText(el, 'Clear').disabled).toBe(true);
    });
  });

  describe('completing an order', () => {
    const type = async (selector: string, text: string): Promise<void> => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
    };
    const complete = (): HTMLButtonElement => buttonByText(el, 'Complete Order');
    const flushSaves = async (): Promise<void> => {
      TestBed.inject(CheckoutDraftService).flush();
      await fixture.whenStable();
    };

    it('shows the number the order will get', () => {
      expect(el.textContent).toContain('SO-1001');
    });

    it('cannot be completed while empty, or until the cash handed over covers the total', async () => {
      expect(complete().disabled).toBe(true);
      scan(PRODUCTS[1].barcode!); // 4.29
      await fixture.whenStable();
      expect(complete().disabled).toBe(true); // no cash yet
      await type('#tendered', '4.00');
      expect(complete().disabled).toBe(true);
      await type('#tendered', '5');
      expect(complete().disabled).toBe(false);
      expect(el.textContent).toContain('₱0.71'); // change due
    });

    it('Exact fills the total', async () => {
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      buttonByText(el, 'Exact').click();
      await fixture.whenStable();
      expect((el.querySelector('#tendered') as HTMLInputElement).value).toBe('4.29');
      expect(complete().disabled).toBe(false);
    });

    it('sends the lines, discount and payment, then starts a fresh order with the next number', async () => {
      scan(PRODUCTS[1].barcode!);
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      await type('#tendered', '10');
      store.result = { ok: true, orderId: 'o1', orderNumber: 'SO-1001', total: 858, change: 142 };
      complete().click();
      await fixture.whenStable();

      expect(store.orders).toEqual([
        { lines: [{ productId: '2', quantityMilli: 2000, unitPrice: 429 }], discount: 0, payment: { method: 'cash', tendered: 1000, reference: undefined } },
      ]);
      expect(el.textContent).toContain('No items yet');
      expect(el.textContent).toContain('SO-1002');
      expect(TestBed.inject(BannerService).current()?.text).toBe('Order SO-1001 completed, change ₱1.42');
      const action = TestBed.inject(BannerService).current()?.action;
      expect(action?.label).toBe('View'); // opens the order over this page (?view-sales-order=o1)
      action!.run();
      await fixture.whenStable();
      expect(TestBed.inject(Router).url).toContain('view-sales-order=o1');
      // The order is gone for good: the debounced draft save must not write it back.
      await flushSaves();
      expect(store.draft).toBeNull();
    });

    it('takes a card payment without cash handed over', async () => {
      scan(PRODUCTS[0].barcode!);
      await fixture.whenStable();
      // switch to card through the select's own state: the field names the reference
      (fixture.componentInstance as unknown as { paymentMethod: { set(v: string): void } }).paymentMethod.set('card');
      await fixture.whenStable();
      await type('#reference', 'SLIP-9');
      expect(complete().disabled).toBe(false);
      complete().click();
      await fixture.whenStable();
      expect(store.orders[0].payment).toEqual({ method: 'card', tendered: undefined, reference: 'SLIP-9' });
    });

    it.each([
      ['ewallet', 'E-wallet'],
      ['bank_transfer', 'Bank transfer'],
    ])('takes %s as a payment with a reference number and no cash handed over', async (method, label) => {
      scan(PRODUCTS[0].barcode!);
      await fixture.whenStable();
      (fixture.componentInstance as unknown as { paymentMethod: { set(v: string): void } }).paymentMethod.set(method);
      await fixture.whenStable();
      expect(el.querySelector('label[for="reference"]')?.textContent?.trim()).toBe('Reference number');
      expect(el.textContent).toContain(label);
      await type('#reference', 'GCASH-123');
      expect(complete().disabled).toBe(false);
      complete().click();
      await fixture.whenStable();
      expect(store.orders[0].payment).toEqual({ method, tendered: undefined, reference: 'GCASH-123' });
    });

    it('keeps the order when it is refused, brings a changed price in and drops an unavailable item', async () => {
      scan(PRODUCTS[0].barcode!);
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      await type('#tendered', '50');
      store.result = {
        ok: false,
        error: 'Some items on the order have changed',
        lines: [
          { productId: '1', kind: 'price', error: 'The price of Bananas (bunch) has changed', current: { name: 'Bananas (bunch)', unitPrice: 199, unit: 'each' } },
          { productId: '2', kind: 'unavailable', error: 'Whole Milk (1 gal) is no longer available' },
        ],
      };
      complete().click();
      await fixture.whenStable();

      expect(el.querySelectorAll('li')).toHaveLength(1);
      expect(el.textContent).toContain('₱1.99');
      expect(el.textContent).not.toContain('Whole Milk (1 gal)');
      expect(TestBed.inject(BannerService).current()?.text).toContain('The price of Bananas (bunch) has changed');
      expect(store.orders).toHaveLength(1);
    });

    it('keeps the order and says so when stock is short', async () => {
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      await type('#tendered', '5');
      store.result = { ok: false, error: 'Not enough stock for some items', lines: [{ productId: '2', kind: 'stock', error: 'Only 0 of Whole Milk (1 gal) in stock' }] };
      complete().click();
      await fixture.whenStable();
      expect(el.querySelectorAll('li')).toHaveLength(1);
      expect(TestBed.inject(BannerService).current()?.text).toContain('Only 0 of Whole Milk (1 gal) in stock');
    });
  });

  describe('scale labels', () => {
    // 2 + PLU 04011 + 0 + weight 00405 g (+ check digit); PLU "4011" is the product's code.
    const BEEF_LABEL = '2040110004053';
    beforeEach(async () => {
      PRODUCTS[3] = { ...PRODUCTS[3], barcode: '4011' };
      await open();
    });
    afterEach(() => {
      PRODUCTS[3] = { ...PRODUCTS[3], barcode: '59000000000' + '44' };
    });

    it('adds the weighed product with the weight on the label, priced per kg', async () => {
      scan(BEEF_LABEL);
      await fixture.whenStable();
      expect(el.querySelectorAll('li')).toHaveLength(1);
      expect(el.textContent?.replace(/\s+/g, ' ')).toContain('Ground Beef');
      expect(el.textContent?.replace(/\s+/g, ' ')).toContain('0.405 kg'); // 405 g
      expect(el.textContent).toContain('₱3.64'); // 8.99 x 0.405 = 3.640
    });

    it('adds the weight of a second label to the same line', async () => {
      scan(BEEF_LABEL);
      scan(BEEF_LABEL);
      await fixture.whenStable();
      expect(el.querySelectorAll('li')).toHaveLength(1);
      expect(el.textContent?.replace(/\s+/g, ' ')).toContain('0.81 kg');
    });

    it('reports a label whose PLU matches no weighed product, and ignores one with a bad check digit as an unknown code', async () => {
      scan('2999990004052'); // valid check digit, unknown PLU 99999
      await fixture.whenStable();
      expect(el.querySelectorAll('li')).toHaveLength(0);
      expect(TestBed.inject(BannerService).current()?.text).toBe('Unknown PLU 99999');
      scan('2040110004050'); // wrong check digit
      await fixture.whenStable();
      expect(el.querySelectorAll('li')).toHaveLength(0);
      expect(TestBed.inject(BannerService).current()?.text).toBe('Unknown barcode 2040110004050');
    });
  });

  describe('weighed products', () => {
    it('adding one opens the weight field; the line shows the price and weight per unit', async () => {
      scan(PRODUCTS[3].barcode!);
      await fixture.whenStable();
      const field = el.querySelector('input[aria-label="Quantity"]') as HTMLInputElement;
      expect(field).not.toBeNull(); // asks for the weight right away
      field.value = '0.35';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await fixture.whenStable();
      expect(el.textContent?.replace(/\s+/g, ' ')).toContain('₱8.99 / kg');
      expect(el.textContent?.replace(/\s+/g, ' ')).toContain('0.35 kg');
      expect(el.textContent).toContain('₱3.15'); // 899 x 0.35 = 314.65 -> 315 cents
      TestBed.inject(CheckoutDraftService).flush();
      expect(store.draft?.lines[0]).toMatchObject({ unit: 'kg', quantityMilli: 350 });
    });

    it('scanning it again edits the weight instead of adding another unit', async () => {
      scan(PRODUCTS[3].barcode!);
      await fixture.whenStable();
      (el.querySelector('input[aria-label="Quantity"]') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      scan(PRODUCTS[3].barcode!);
      await fixture.whenStable();
      expect(el.querySelectorAll('li').length).toBe(1);
      TestBed.inject(CheckoutDraftService).flush();
      expect(store.draft?.lines).toHaveLength(1);
      expect(store.draft?.lines[0]?.quantityMilli).toBe(1000); // still one unit, not two
    });
  });

  describe('line items', () => {
    const qtyButton = () => el.querySelector('button[aria-label="Edit quantity"]') as HTMLButtonElement;
    const quantityField = () => el.querySelector('input[aria-label="Quantity"]') as HTMLInputElement;

    /** Turns the on-screen keyboard setting on, then taps the quantity of a scanned item. */
    const openEditor = async (): Promise<void> => {
      fixture.destroy();
      localStorage.setItem('micropos.onScreenKeyboard', 'true');
      await open();
      scan(PRODUCTS[0].barcode!); // Bananas, 1.79 each
      await fixture.whenStable();
      qtyButton().click();
      await fixture.whenStable();
    };
    const keypadKey = (label: string) => document.querySelector(`app-on-screen-keypad button[aria-label="${label}"]`) as HTMLButtonElement;
    const press = async (...labels: string[]): Promise<void> => {
      for (const label of labels) {
        keypadKey(label).click();
        await fixture.whenStable();
      }
    };

    it('with the on-screen keyboard on, a tap makes the quantity a text field and floats a keypad next to it', async () => {
      await openEditor();
      const input = quantityField();
      expect(input.type).toBe('text'); // a number field cannot hold a half-typed "2."
      expect(input.getAttribute('inputmode')).toBe('none'); // the OS keyboard stays out of the way
      expect(input.value).toBe('1');
      expect(document.querySelector('app-on-screen-keypad')).not.toBeNull();
      expect(document.querySelector('hlm-dialog-content')).toBeNull(); // no dialog
    });

    it('sets an exact decimal quantity from the floating keypad and commits with Done', async () => {
      await openEditor();
      await press('2', '.', '5');
      expect(quantityField().value).toBe('2.5'); // the first key replaced the old value
      await press('Done');
      expect(quantityField()).toBeNull(); // plain text again
      expect(document.querySelector('app-on-screen-keypad')).toBeNull();
      expect(qtyButton().textContent?.trim()).toBe('2.5');
      expect(el.textContent).toContain('₱4.48'); // 2.5 x 1.79 = 4.475, rounded to the cent
    });

    it('lets the keypad delete, and refuses a second dot or more than 3 decimals', async () => {
      await openEditor();
      await press('3', '.', '1', '.', '2', '3', '4', '5');
      expect(quantityField().value).toBe('3.123');
      await press('Delete', 'Delete');
      expect(quantityField().value).toBe('3.1');
    });

    it('keeps the old quantity when the keypad leaves an invalid amount', async () => {
      await openEditor();
      await press('0', '.', 'Done');
      expect(qtyButton().textContent?.trim()).toBe('1');
    });

    it('also accepts a real keyboard, and Enter commits', async () => {
      await openEditor();
      const input = quantityField();
      input.value = '7';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await fixture.whenStable();
      expect(qtyButton().textContent?.trim()).toBe('7');
    });

    it('shows the same floating keypad for the cash tendered field', async () => {
      fixture.destroy();
      localStorage.setItem('micropos.onScreenKeyboard', 'true');
      await open();
      const cash = el.querySelector('#tendered') as HTMLInputElement;
      expect(document.querySelector('app-on-screen-keypad')).toBeNull();
      cash.focus();
      await fixture.whenStable();
      expect(document.querySelector('app-on-screen-keypad')).not.toBeNull();
      await press('2', '5', '0', '.', '5', '0', '9'); // two decimals at most
      expect(cash.value).toBe('250.50');
      await press('Done');
      expect(document.querySelector('app-on-screen-keypad')).toBeNull();
    });

    it('with the on-screen keyboard off the cash field has no keypad', async () => {
      const cash = el.querySelector('#tendered') as HTMLInputElement;
      cash.focus();
      await fixture.whenStable();
      expect(document.querySelector('app-on-screen-keypad')).toBeNull();
    });

    describe('with the on-screen keyboard off (default)', () => {
      const field = () => el.querySelector('input[aria-label="Quantity"]') as HTMLInputElement | null;
      const startInline = async (): Promise<HTMLInputElement> => {
        scan(PRODUCTS[0].barcode!);
        await fixture.whenStable();
        qtyButton().click();
        await fixture.whenStable();
        return field()!;
      };
      const type = async (input: HTMLInputElement, value: string): Promise<void> => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await fixture.whenStable();
      };

      it('turns the quantity into a focused number field, with no keypad', async () => {
        const select = vi.spyOn(HTMLInputElement.prototype, 'select');
        const input = await startInline();
        expect(input).toBeTruthy();
        expect(input.type).toBe('number');
        expect(input.value).toBe('1');
        expect(document.activeElement).toBe(input);
        expect(select).toHaveBeenCalled(); // contents selected, so typing replaces them
        select.mockRestore();
        expect(document.querySelector('app-on-screen-keypad')).toBeNull();
        expect(qtyButton()).toBeNull(); // the plain text is replaced while editing
      });

      it('commits on Enter and goes back to plain text', async () => {
        const input = await startInline();
        await type(input, '3.5');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await fixture.whenStable();
        expect(field()).toBeNull();
        expect(qtyButton().textContent?.trim()).toBe('3.5');
        expect(el.textContent).toContain('₱6.27'); // 3.5 x 1.79 = 6.265
      });

      it('commits when the field loses focus, and turns back into plain text', async () => {
        const input = await startInline();
        await type(input, '4');
        input.dispatchEvent(new FocusEvent('blur'));
        await fixture.whenStable();
        expect(field()).toBeNull();
        expect(qtyButton().textContent?.trim()).toBe('4');
      });

      it('Escape and invalid amounts keep the old quantity', async () => {
        let input = await startInline();
        await type(input, '9');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await fixture.whenStable();
        expect(qtyButton().textContent?.trim()).toBe('1');

        qtyButton().click();
        await fixture.whenStable();
        input = field()!;
        await type(input, '0'); // zero is not a quantity
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await fixture.whenStable();
        expect(qtyButton().textContent?.trim()).toBe('1');

        qtyButton().click();
        await fixture.whenStable();
        input = field()!;
        await type(input, '1.2345'); // too many decimals
        input.dispatchEvent(new FocusEvent('blur'));
        await fixture.whenStable();
        expect(qtyButton().textContent?.trim()).toBe('1');
      });

      it('applies an amount once even though Enter is followed by a blur', async () => {
        const input = await startInline();
        await type(input, '2');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new FocusEvent('blur'));
        await fixture.whenStable();
        expect(qtyButton().textContent?.trim()).toBe('2');
      });
    });

    it('steps by one with + and -, removes the line when a tap on - reaches zero', async () => {
      scan(PRODUCTS[0].barcode!);
      await fixture.whenStable();
      (el.querySelector('button[aria-label="Increase quantity"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(qtyButton().textContent?.trim()).toBe('2');
      const dec = el.querySelector('button[aria-label="Decrease quantity"]') as HTMLButtonElement;
      dec.click();
      dec.click();
      await fixture.whenStable();
      expect(el.textContent).toContain('No items yet');
    });

    it('offers "Remove item" in a context menu on the line and removes only that line', async () => {
      scan(PRODUCTS[0].barcode!);
      scan(PRODUCTS[1].barcode!);
      await fixture.whenStable();
      const rows = el.querySelectorAll('li');
      expect(rows).toHaveLength(2);

      rows[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await fixture.whenStable();
      const item = [...document.querySelectorAll('[hlmDropdownMenuItem]')].find((b) => b.textContent?.trim() === 'Remove item') as HTMLButtonElement;
      expect(item).toBeTruthy();
      item.click();
      await fixture.whenStable();

      expect(el.querySelectorAll('li')).toHaveLength(1);
      expect(el.textContent).not.toContain('Bananas (bunch)');
      expect(el.textContent).toContain('Whole Milk (1 gal)');
    });

    it('removes a line that is swiped away', async () => {
      scan(PRODUCTS[0].barcode!);
      await fixture.whenStable();
      const row = el.querySelector('app-swipe-actions > div:last-child') as HTMLElement;
      const pe = (type: string, x: number): Event =>
        Object.assign(new MouseEvent(type, { clientX: x, clientY: 0, button: 0, bubbles: true }), { pointerId: 3, pointerType: 'touch' });
      row.dispatchEvent(pe('pointerdown', 500));
      row.dispatchEvent(pe('pointermove', 400)); // 100 px: past the first distance, so "Remove" is highlighted
      row.dispatchEvent(pe('pointerup', 400));
      await new Promise((resolve) => setTimeout(resolve, 250)); // the row slides out, then the action runs
      await fixture.whenStable();
      expect(el.textContent).toContain('No items yet');
    });
  });
});
