import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DESKTOP_API_VERSION,
  type ProductDraft,
  type DesktopApi,
  type ProductInput,
  type ProductRecord,
  type SaveProductResult,
} from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { provideRouter, Router } from '@angular/router';
import { ScannerService } from '../../core/scanner';
import { ProductsPage } from './products';

// jsdom has no ResizeObserver (overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom has no scrollIntoView (the select scrolls its highlighted option into view).
Element.prototype.scrollIntoView ??= () => undefined;

const DAIRY = { id: 'c1', name: 'Dairy' };
const record = (id: string, name: string, over: Partial<ProductRecord> = {}): ProductRecord => ({
  id,
  name,
  sku: `SKU-${id}`,
  barcode: `590${id}`,
  price: 429,
  cost: 300,
  unit: 'each',
  tracking: 'none',
  shelfLifeDays: null,
  criticalLevelMilli: null,
  onHandMilli: null,
  nextExpiry: null,
  active: true,
  createdAt: Date.UTC(2026, 0, 15, 8, 30),
  deletedAt: null,
  categories: [],
  ...over,
});

/** In-memory stand-in for the products bridge; duplicates SKUs the way the real one does. */
function fakeApi(initial: ProductRecord[]) {
  const rows = [...initial];
  const drafts = new Map<string, ProductDraft>();
  const calls = { create: [] as ProductInput[], update: [] as [string, ProductInput][], remove: [] as string[], restore: [] as string[], setActive: [] as [string[], boolean][] };
  const save = (id: string | null, input: ProductInput): SaveProductResult => {
    if (input.sku && rows.some((r) => r.sku === input.sku && r.id !== id)) return { ok: false, field: 'sku', error: 'SKU is already used' };
    const product: ProductRecord = {
      ...input,
      id: id ?? `new-${rows.length}`,
      shelfLifeDays: input.shelfLifeDays,
      onHandMilli: null,
      nextExpiry: null,
      createdAt: Date.now(),
      deletedAt: null,
      categories: input.categoryIds.map((c) => ({ id: c, name: c === DAIRY.id ? DAIRY.name : c })),
    };
    const at = rows.findIndex((r) => r.id === id);
    if (at >= 0) rows[at] = product;
    else rows.push(product);
    return { ok: true, product };
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
      returnToSupplier: () => Promise.reject(new Error('unused')),
      listBatches: () => Promise.resolve([]),
      concerns: () => Promise.resolve([]),
      overview: () => Promise.reject(new Error('unused')),
      receive: () => Promise.reject(new Error('unused')),
      adjust: () => Promise.reject(new Error('unused')),
      repackage: () => Promise.reject(new Error('unused')),
      loadRepackageDraft: () => Promise.resolve(null),
      saveRepackageDraft: () => Promise.resolve(),
      clearRepackageDraft: () => Promise.resolve(),
    },
    data: { onChanged: () => () => undefined },
      shell: { getCloseToTray: () => Promise.resolve(false), setCloseToTray: () => Promise.resolve(true), getLogsFolder: () => Promise.resolve(null), openLogsFolder: () => Promise.resolve(false) },
      reports: { sales: () => Promise.resolve(null) },
      debug: { get: () => Promise.resolve({ saveImages: false, folder: '/downloads/MicroPOS receipts' }), setSaveImages: () => Promise.resolve(true), openReceiptsFolder: () => Promise.resolve(true) },
      log: { write: () => Promise.resolve() },
      printer: { getLogo: () => Promise.resolve(null), saveLogo: () => Promise.reject(new Error('unused')), removeLogo: () => Promise.resolve(), settings: () => Promise.reject(new Error('unused')), save: () => Promise.reject(new Error('unused')), listUsb: () => Promise.resolve([]), testPrint: () => Promise.reject(new Error('unused')), printOrder: () => Promise.reject(new Error('unused')) },
    scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
    catalog: { listProducts: () => Promise.resolve([]), listCategories: () => Promise.resolve([DAIRY]) },
    products: {
      list: (options) => {
        const answer = rows.filter((r) => options?.includeDeleted || !r.deletedAt);
        return listDelay ? new Promise((resolve) => setTimeout(() => resolve(answer), listDelay)) : Promise.resolve(answer);
      },
      create: (input) => (calls.create.push(input), Promise.resolve(save(null, input))),
      update: (id, input) => (calls.update.push([id, input]), Promise.resolve(save(id, input))),
      remove: (ids) => {
        calls.remove.push(...ids);
        for (const id of ids) {
          const row = rows.find((r) => r.id === id);
          if (row) row.deletedAt = Date.now();
        }
        return Promise.resolve();
      },
      loadDraft: (form) => Promise.resolve(drafts.get(form) ?? null),
      saveDraft: (form, draft) => (drafts.set(form, draft), Promise.resolve()),
      clearDraft: (form) => (drafts.delete(form), Promise.resolve()),
      setActive: (ids, active) => {
        calls.setActive.push([ids, active]);
        for (const row of rows) if (ids.includes(row.id)) row.active = active;
        return Promise.resolve();
      },
      restore: (ids) => {
        calls.restore.push(...ids);
        for (const id of ids) {
          const row = rows.find((r) => r.id === id);
          if (row) row.deletedAt = null;
        }
        return Promise.resolve({ restored: ids.length, conflicts: [] });
      },
    },
    customers: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve({ removed: 0, blocked: [] }), restore: () => Promise.resolve(), account: () => Promise.resolve(null), receivePayment: () => Promise.reject(new Error('unused')), interestDefaults: () => Promise.resolve({ orderRateBp: 300, totalRateBp: 300 }), saveInterestDefaults: () => Promise.resolve(true), alertCount: () => Promise.resolve(0), alertSettings: () => Promise.resolve({ amount: null, days: null }), saveAlertSettings: () => Promise.resolve(true) },
    display: { show: () => Promise.resolve(), hide: () => Promise.resolve(), isOpen: () => Promise.resolve(false), onVisibility: () => () => undefined, publish: () => Promise.resolve(), getState: () => Promise.resolve({ phase: 'idle', lines: [], total: 0, highlight: null, receipt: null }), onState: () => () => undefined },
    auth: { status: () => Promise.resolve(null), choices: () => Promise.resolve([]), signIn: () => Promise.reject(new Error('unused')), signOut: () => Promise.resolve(), changePin: () => Promise.reject(new Error('unused')) },
    users: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), resetPin: () => Promise.reject(new Error('unused')), signInLog: () => Promise.resolve([]) },
    suppliers: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve({ removed: 0, blocked: [] }), restore: () => Promise.resolve() },
    purchases: { concerns: () => Promise.resolve([]), list: () => Promise.resolve([]), get: () => Promise.resolve(null), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), receive: () => Promise.reject(new Error('unused')), pay: () => Promise.reject(new Error('unused')), cancel: () => Promise.reject(new Error('unused')) },
    orders: { list: () => Promise.resolve([]), get: () => Promise.resolve(null), idByNumber: () => Promise.resolve(null), void: () => Promise.reject(new Error('unused')), refund: () => Promise.reject(new Error('unused')) },
    checkout: { nextOrderNumber: () => Promise.resolve('SO-1001'), completeOrder: () => Promise.reject(new Error('unused')), loadDraft: () => Promise.resolve(null), saveDraft: () => Promise.resolve(), clearDraft: () => Promise.resolve() },
  };
  return { api, calls, drafts };
}

/** How long the fake products list takes to answer (a real database is not instant). */
let listDelay = 0;

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('ProductsPage', () => {
  let fixture: ComponentFixture<ProductsPage>;
  let el: HTMLElement;
  let calls: ReturnType<typeof fakeApi>['calls'];
  let drafts: ReturnType<typeof fakeApi>['drafts'];

  async function open(rows: ProductRecord[], url?: string): Promise<void> {
    const fake = fakeApi(rows);
    calls = fake.calls;
    drafts = fake.drafts;
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }]), { provide: DESKTOP_API, useValue: fake.api }] });
    TestBed.inject(ScannerService); // started at launch by the app root; its keydown listener must exist first
    if (url) await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(ProductsPage);
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
  const rowNames = (): string[] => bodyRows().map((r) => r.querySelectorAll('[role="cell"]')[1]!.textContent!.trim());
  const type = async (root: ParentNode, selector: string, value: string): Promise<void> => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  /** The date range filter is a button that opens a panel; open it so its date fields can be used. */
  const openDates = async (): Promise<void> => {
    (el.querySelector('button[aria-label="Created date range"]') as HTMLElement).click();
    await fixture.whenStable();
  };
  const dialog = (): HTMLElement => document.querySelector('hlm-dialog-content') as HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    listDelay = 0;
  });
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  describe('?edit-product=<id>', () => {
    it('opens that product in the edit dialog over the table and takes the parameter out of the address', async () => {
      await open([record('1', 'Milk', { categories: [DAIRY] }), record('2', 'Eggs')], '/items/products?edit-product=2');
      await settle();
      expect(dialog()?.textContent).toContain('Edit product');
      expect((dialog().querySelector('input') as HTMLInputElement).value).toBe('Eggs');
      expect(TestBed.inject(Router).url).toBe('/items/products');
      // The row being edited is highlighted, not selected.
      // The highlight sits on the row inside the swipe component: that has an opaque background that would hide a tint on the wrapper.
      const target = el.querySelector('app-swipe-actions .row-target') as HTMLElement;
      expect((target.closest('[data-row-id]') as HTMLElement).dataset['rowId']).toBe('2');
      expect(target.getAttribute('aria-selected')).toBe('false');
    });

    it('shows the page that holds the product and scrolls to its row, even when the list loads slowly', async () => {
      listDelay = 80;
      const scrolled = vi.fn();
      Element.prototype.scrollIntoView = scrolled;
      const many = Array.from({ length: 120 }, (_, i) => record(`p${i + 1}`, `Item ${String(i + 1).padStart(3, '0')}`));
      await open(many, '/items/products?edit-product=p110');
      await settle();
      expect(el.querySelector('app-pager')?.textContent?.replace(/\s+/g, ' ')).toContain('Page 3 of 3');
      expect((el.querySelector('.row-target')!.closest('[data-row-id]') as HTMLElement).dataset['rowId']).toBe('p110');
      expect(dialog()?.textContent).toContain('Edit product');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(scrolled).toHaveBeenCalled();
      expect(scrolled.mock.contexts[0]).toBe(el.querySelector('[data-row-id="p110"]'));
    });

    it('opens a product the table filters would hide', async () => {
      await open([record('1', 'Milk'), record('2', 'Old Tea', { active: false })], '/items/products?edit-product=2&category=Nothing');
      await settle();
      expect(rowNames()).toEqual([]); // the category filter hides every row
      expect(dialog()?.textContent).toContain('Edit product');
    });

    it('says so for an unknown product and for a deleted one, without opening a dialog', async () => {
      await open([record('1', 'Milk', { deletedAt: 1 })], '/items/products?edit-product=nope');
      await settle();
      expect(TestBed.inject(BannerService).current()?.text).toBe('Product not found');
      expect(dialog()).toBeNull();
      TestBed.inject(BannerService).clear();
    });
  });

  describe('?highlight=<id>', () => {
    it('shows the page that holds the product, highlights its row without opening anything, and uses the parameter up', async () => {
      const many = Array.from({ length: 120 }, (_, i) => record(`p${i + 1}`, `Item ${String(i + 1).padStart(3, '0')}`));
      await open(many, '/items/products?highlight=p110');
      await settle();
      expect(el.querySelector('app-pager')?.textContent?.replace(/\s+/g, ' ')).toContain('Page 3 of 3');
      expect((el.querySelector('.row-target')!.closest('[data-row-id]') as HTMLElement).dataset['rowId']).toBe('p110');
      expect(dialog()).toBeNull(); // highlighted, not opened
      expect(TestBed.inject(Router).url).toBe('/items/products');
    });

    it('clears filters that hide the product, and switches to Deleted only for a deleted one', async () => {
      await open([record('1', 'Milk'), record('2', 'Old Tea', { deletedAt: 5 })], '/items/products?highlight=1&category=Nothing');
      await settle();
      expect(rowNames()).toEqual(['Milk']); // the category filter was cleared
      expect(el.querySelector('.row-target')).not.toBeNull();

      await TestBed.inject(Router).navigateByUrl('/items/products?highlight=2');
      await settle();
      expect(rowNames()).toEqual(['Old Tea']);
      expect(el.querySelector('.row-target')!.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe('2');
    });
  });

  describe('selecting like a file explorer', () => {
    const rowEl = (name: string): HTMLElement => bodyRows().find((r) => r.textContent?.includes(name))!;
    const click = (target: HTMLElement, init: MouseEventInit = {}): void => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
    };
    const selectedNames = (): string[] => bodyRows().filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.querySelectorAll('[role="cell"]')[1]!.textContent!.trim());
    const items = ['Apple', 'Bread', 'Cheese', 'Dates', 'Eggs'].map((name, i) => record(`p${i}`, name, { createdAt: 1000 - i }));

    it('Ctrl + left click toggles a row and Shift + left click selects a range, without opening the product', async () => {
      await open(items); // newest first: Apple, Bread, Cheese, Dates, Eggs
      expect(rowNames()).toEqual(['Apple', 'Bread', 'Cheese', 'Dates', 'Eggs']);
      click(rowEl('Bread'), { ctrlKey: true });
      click(rowEl('Dates'), { ctrlKey: true });
      await fixture.whenStable();
      expect(selectedNames()).toEqual(['Bread', 'Dates']);
      expect(dialog()).toBeNull();

      click(rowEl('Eggs'), { shiftKey: true }); // from the last clicked row (Dates) to Eggs
      await fixture.whenStable();
      expect(selectedNames()).toEqual(['Dates', 'Eggs']);
      expect(el.textContent).toContain('2 selected');
      expect(dialog()).toBeNull();
    });

    it('Shift + clicking a checkbox ticks everything between it and the last one clicked', async () => {
      await open(items);
      const box = (name: string): HTMLElement => rowEl(name).querySelector('hlm-checkbox button, hlm-checkbox [role="checkbox"], hlm-checkbox input')!;
      const cell = (name: string): HTMLElement => rowEl(name).querySelector('[role="cell"]')!;
      box('Apple').click();
      await fixture.whenStable();
      cell('Cheese').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, shiftKey: true }));
      box('Cheese').click();
      await fixture.whenStable();
      expect(selectedNames()).toEqual(['Apple', 'Bread', 'Cheese']);
    });

    it('a plain click still opens the product', async () => {
      await open(items);
      click(rowEl('Cheese'));
      await settle();
      expect(dialog()?.textContent).toContain('Edit product');
      expect(selectedNames()).toEqual([]);
    });
  });

  it('pages the table: 50 rows at a time', async () => {
    await open(Array.from({ length: 70 }, (_, i) => record(`p${i + 1}`, `Item ${i + 1}`)));
    expect(bodyRows()).toHaveLength(50);
    expect(el.querySelector('app-pager')?.textContent).toContain('1–50 of 70');
    (el.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(bodyRows()).toHaveLength(20);
  });

  it('lists every product including inactive ones, with prices', async () => {
    await open([record('1', 'Milk', { categories: [DAIRY] }), record('2', 'Old Tea', { active: false })]);
    expect(rowNames()).toEqual(['Milk', 'Old Tea']);
    expect(el.textContent).toContain('₱4.29');
    expect(el.textContent).toContain('Inactive');
    expect(el.textContent).toContain('Dairy');
  });

  it('sorts by a column, reversing on a second click, with empty values last', async () => {
    await open([
      record('1', 'Milk', { price: 500, sku: null }),
      record('2', 'Eggs', { price: 300, sku: 'B-2' }),
      record('3', 'Tea', { price: 400, sku: 'A-1' }),
    ]);
    const header = (label: string): HTMLButtonElement =>
      [...el.querySelectorAll('[role="columnheader"] button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    const click = async (label: string): Promise<void> => {
      header(label).click();
      await fixture.whenStable();
    };
    expect(el.querySelector('[role="columnheader"][aria-sort="descending"]')?.textContent).toContain('Created'); // newest first to start with
    await click('Name');
    expect(rowNames()).toEqual(['Eggs', 'Milk', 'Tea']);
    await click('Price');
    expect(rowNames()).toEqual(['Eggs', 'Tea', 'Milk']);
    await click('Price');
    expect(rowNames()).toEqual(['Milk', 'Tea', 'Eggs']);
    await click('SKU');
    expect(rowNames()).toEqual(['Tea', 'Eggs', 'Milk']); // no SKU last
    await click('SKU');
    expect(rowNames()).toEqual(['Eggs', 'Tea', 'Milk']); // descending: B-2, A-1, then the empty one still last
    expect(el.querySelector('[role="columnheader"][aria-sort="descending"]')?.textContent).toContain('SKU');
  });

  it('filters by a created date range, both ends inclusive', async () => {
    const day = (d: number, h = 12) => new Date(2026, 0, d, h).getTime();
    await open([
      record('1', 'Early', { createdAt: day(10) }),
      record('2', 'Mid', { createdAt: day(15, 23) }),
      record('3', 'Late', { createdAt: day(20, 0) }),
    ]);
    expect(el.querySelector('button[aria-label="Created date range"]')!.textContent).toContain('Any date');
    await openDates();
    await type(document, 'input[aria-label="Created from"]', '2026-01-15');
    expect(rowNames()).toEqual(['Mid']); // a first date is a single day: the end date follows it
    expect(el.querySelector('button[aria-label="Created date range"]')!.textContent).toContain('Jan 15, 2026');
    await type(document, 'input[aria-label="Created to"]', '2026-01-20');
    expect(rowNames()).toEqual(['Late', 'Mid']); // the whole last day counts, newest first
    await type(document, 'input[aria-label="Created to"]', '');
    expect(rowNames()).toEqual(['Late', 'Mid']); // no end date: from the 15th on
    expect(el.querySelector('button[aria-label="Created date range"]')!.textContent).toContain('From Jan 15, 2026');
    el.querySelector<HTMLElement>('button[aria-label="Clear created dates"]')!.click();
    await fixture.whenStable();
    expect(rowNames()).toEqual(['Late', 'Mid', 'Early']);
  });

  it('resets every filter at once from the button in the select column', async () => {
    await open([record('1', 'Milk', { barcode: '4011' }), record('2', 'Eggs', { active: false })]);
    const reset = (): HTMLButtonElement => el.querySelector('button[aria-label="Reset filters"]') as HTMLButtonElement;
    expect(reset().disabled).toBe(true); // nothing to reset
    await type(el, 'input[aria-label="Filter name"]', 'eg');
    await openDates();
    await type(document, 'input[aria-label="Created from"]', '2020-01-01');
    await type(document, 'input[aria-label="Created to"]', '2099-01-01');
    expect(reset().disabled).toBe(false);
    expect(rowNames()).toEqual(['Eggs']);
    reset().click();
    await fixture.whenStable();
    expect(rowNames()).toHaveLength(2);
    expect((el.querySelector('input[aria-label="Filter name"]') as HTMLInputElement).value).toBe('');
    expect(reset().disabled).toBe(true);
  });

  it('clears a filter with its x button, which is enabled only while the field has text', async () => {
    await open([record('1', 'Milk'), record('2', 'Eggs')]);
    const clear = (): HTMLButtonElement => el.querySelector('button[aria-label="Clear filter name"]')!;
    expect(clear().disabled).toBe(true);
    await type(el, 'input[aria-label="Filter name"]', 'eggs');
    expect(rowNames()).toEqual(['Eggs']);
    clear().click();
    await fixture.whenStable();
    expect((el.querySelector('input[aria-label="Filter name"]') as HTMLInputElement).value).toBe('');
    expect(rowNames()).toHaveLength(2);
    expect(clear().disabled).toBe(true);
  });

  it('offers a category clear button only when a category is chosen', async () => {
    await open([record('1', 'Milk', { categories: [DAIRY] })]);
    expect(el.querySelector('[data-slot="combobox-clear"]')).toBeNull(); // All categories: nothing to clear
  });

  describe('scanner', () => {
    /** The Electron main process detects a scan and sends the code to the page. */
    const scan = async (code: string): Promise<void> => {
      TestBed.inject(ScannerService).receive(code);
      await fixture.whenStable();
    };

    it('a scan sets the barcode / PLU filter, and says when nothing matches', async () => {
      await open([record('1', 'Milk', { barcode: '5900000000107' }), record('2', 'Eggs', { barcode: '5900000000015' })]);
      await scan('5900000000015');
      expect(rowNames()).toEqual(['Eggs']);
      expect((el.querySelector('input[aria-label="Filter barcode or PLU"]') as HTMLInputElement).value).toBe('5900000000015');

      await scan('1111111111116');
      expect(rowNames()).toEqual([]);
      expect(TestBed.inject(BannerService).current()?.text).toBe('No product with barcode 1111111111116');
    });

    it('a scale label (2 + PLU + weight) looks up the PLU inside it', async () => {
      await open([record('1', 'Milk', { barcode: '5900000000107' }), record('2', 'Cheddar', { barcode: '71072', unit: 'kg' })]);
      await scan('2710720033506'); // PLU 71072, 3.35 kg
      expect(rowNames()).toEqual(['Cheddar']);
      expect((el.querySelector('input[aria-label="Filter barcode or PLU"]') as HTMLInputElement).value).toBe('71072');
      await scan('2999990033502'); // a label for a PLU nobody has
      expect(rowNames()).toEqual([]);
      expect(TestBed.inject(BannerService).current()?.text).toBe('No product with PLU 99999');
    });

    it('with the form open, a scan fills its barcode field and leaves the table alone', async () => {
      await open([record('1', 'Milk', { barcode: '5900000000107' }), record('2', 'Eggs', { barcode: '5900000000015' })]);
      bodyRows()[0]!.click();
      await settle();
      await scan('4006381333931');
      await settle();
      expect((dialog().querySelector('#p-barcode') as HTMLInputElement).value).toBe('4006381333931');
      expect(rowNames()).toEqual(['Milk', 'Eggs']); // table unfiltered
    });

    it('a scan types into the focused barcode / PLU field, and into it from any other field of the form too', async () => {
      await open([record('1', 'Milk', { barcode: '5900000000107' })]);
      bodyRows()[0]!.click();
      await settle();
      const barcode = dialog().querySelector('#p-barcode') as HTMLInputElement;
      barcode.focus();
      TestBed.inject(ScannerService).receive('4011');
      await fixture.whenStable();
      expect(barcode.value).toBe('4011'); // focused field receives it directly

      (dialog().querySelector('#p-name') as HTMLInputElement).focus();
      const name = (dialog().querySelector('#p-name') as HTMLInputElement).value;
      TestBed.inject(ScannerService).receive('4006381333931');
      await fixture.whenStable();
      expect(barcode.value).toBe('4006381333931'); // focus elsewhere: still the barcode field, never the name
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe(name);
      buttonByText(dialog(), 'Save').click();
      await settle();
      expect(calls.update[0]?.[1]).toMatchObject({ barcode: '4006381333931' });
    });

    it('closing the form hands the scanner back to the page', async () => {
      await open([record('1', 'Milk', { barcode: '5900000000107' }), record('2', 'Eggs', { barcode: '5900000000015' })]);
      bodyRows()[0]!.click();
      await settle();
      buttonByText(dialog(), 'Close').click();
      await settle();
      await scan('5900000000015');
      expect(rowNames()).toEqual(['Eggs']);
      expect(document.querySelector('hlm-dialog-content')).toBeNull(); // the scan's Enter did not reopen the row
    });
  });

  it('Enter on a focused row opens it, but the Enter that ends a scan does not', async () => {
    await open([record('1', 'Milk')]);
    const row = bodyRows()[0]!;
    // The scanner service calls preventDefault on the keys of a confirmed scan.
    const block = (e: Event): void => e.preventDefault();
    document.addEventListener('keydown', block, { capture: true });
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', block, { capture: true });
    await settle();
    expect(document.querySelector('hlm-dialog-content')).toBeNull();

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(dialog()).not.toBeNull();
  });

  describe('stock', () => {
    const stockCell = (row: number): string => bodyRows()[row]!.querySelectorAll('[role="cell"]')[7]!.textContent!.replace(/\s+/g, ' ').trim();

    it('shows how much is in stock, flagging products that are out or expiring, and "-" when not tracked', async () => {
      await open([
        record('1', 'Beef', { tracking: 'expiry', unit: 'kg', barcode: '4011', onHandMilli: 12_500 }),
        record('2', 'Eggs', { tracking: 'quantity', onHandMilli: 0 }),
        record('3', 'Milk', { tracking: 'expiry', onHandMilli: 6_000, nextExpiry: Date.now() + 86_400_000 }),
        record('4', 'Bags'),
      ]);
      expect(rowNames()).toEqual(['Beef', 'Eggs', 'Milk', 'Bags']);
      expect(stockCell(0)).toBe('12.5 kg');
      expect(stockCell(1)).toBe('Out');
      expect(stockCell(2)).toBe('Expiring6');
      expect(stockCell(3)).toBe('-');
    });

    it('filters by stock level', async () => {
      await open([
        record('1', 'Beef', { tracking: 'expiry', onHandMilli: 3_000 }),
        record('2', 'Eggs', { tracking: 'quantity', onHandMilli: 0 }),
        record('3', 'Milk', { tracking: 'expiry', onHandMilli: 6_000, nextExpiry: Date.now() - 86_400_000 }),
        record('4', 'Bags'),
      ]);
      const pick = async (label: string): Promise<void> => {
        (el.querySelector('hlm-select-trigger[aria-label="Filter stock"] button') as HTMLElement).click();
        await settle();
        ([...document.querySelectorAll('hlm-select-item')].find((i) => i.textContent?.trim() === label) as HTMLElement).click();
        await settle();
      };
      await pick('In stock');
      expect(rowNames().sort()).toEqual(['Beef', 'Milk']);
      await pick('Out of stock');
      expect(rowNames()).toEqual(['Eggs']);
      await pick('Expiring');
      expect(rowNames()).toEqual(['Milk']); // past expiry counts
      await pick('Not tracked');
      expect(rowNames()).toEqual(['Bags']);
    });

    it('offers Receive stock in the row menu for tracked products only', async () => {
      await open([record('1', 'Milk', { tracking: 'expiry', onHandMilli: 0 }), record('2', 'Bags')]);
      const menu = async (row: number): Promise<string[]> => {
        bodyRows()[row]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
        await settle();
        const items = [...document.querySelectorAll('[hlmDropdownMenuItem]')].map((i) => i.textContent!.trim());
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        return items;
      };
      expect(await menu(0)).toContain('Receive stock');
      expect(await menu(1)).not.toContain('Receive stock');
    });

    it('the form tracks stock levels, and asks for a shelf life only when stock expires', async () => {
      await open([record('1', 'Milk')]);
      buttonByText(el, 'Add product').click();
      await settle();
      expect(dialog().querySelector('#p-shelf')).toBeNull();
      (dialog().querySelector('hlm-select-trigger[aria-label="Track stock"] button') as HTMLElement).click();
      await settle();
      ([...document.querySelectorAll('hlm-select-item')].find((i) => i.textContent?.trim() === 'By batch with expiry') as HTMLElement).click();
      await settle();
      await type(dialog(), '#p-name', 'Yogurt');
      await type(dialog(), '#p-price', '5');
      await type(dialog(), '#p-shelf', '14');
      buttonByText(dialog(), 'Save').click();
      await settle();
      expect(calls.create[0]).toMatchObject({ tracking: 'expiry', shelfLifeDays: 14 });
    });

    it('asks for a critical level only when stock is tracked, and saves it as a quantity', async () => {
      await open([record('1', 'Milk')]);
      buttonByText(el, 'Add product').click();
      await settle();
      expect(dialog().querySelector('#p-critical')).toBeNull(); // stock is not tracked
      (dialog().querySelector('hlm-select-trigger[aria-label="Track stock"] button') as HTMLElement).click();
      await settle();
      ([...document.querySelectorAll('hlm-select-item')].find((i) => i.textContent?.trim() === 'By batch with expiry') as HTMLElement).click();
      await settle();
      await type(dialog(), '#p-name', 'Yogurt');
      await type(dialog(), '#p-price', '5');
      await type(dialog(), '#p-critical', 'abc');
      buttonByText(dialog(), 'Save').click();
      await settle();
      expect(dialog().textContent).toContain('Enter a quantity');
      expect(calls.create).toEqual([]);
      await type(dialog(), '#p-critical', '12');
      buttonByText(dialog(), 'Save').click();
      await settle();
      expect(calls.create[0]).toMatchObject({ tracking: 'expiry', criticalLevelMilli: 12_000 });
    });
  });

  it('italicizes a PLU and leaves a barcode regular', async () => {
    await open([record('1', 'Beef', { barcode: '4011' }), record('2', 'Milk', { barcode: '5900000000107' })]);
    const codeCell = (row: number): HTMLElement => bodyRows()[row]!.querySelectorAll<HTMLElement>('[role="cell"]')[3]!;
    expect(rowNames()).toEqual(['Beef', 'Milk']);
    expect(codeCell(0).classList.contains('italic')).toBe(true);
    expect(codeCell(1).classList.contains('italic')).toBe(false);
  });

  it('shows when each product was created', async () => {
    await open([record('1', 'Milk')]);
    expect(el.textContent).toContain('Created');
    expect(el.textContent).toContain('Jan 15, 2026');
  });

  it('Deleted only swaps the list to just the deleted products, which are read-only', async () => {
    await open([record('1', 'Milk'), record('2', 'Old Tea', { deletedAt: 1 })]);
    expect(rowNames()).toEqual(['Milk']);
    (el.querySelector('hlm-switch button') as HTMLElement).click();
    await settle();
    expect(rowNames()).toEqual(['Old Tea']); // exclusively the deleted ones
    expect(el.textContent).toContain('Deleted');
    bodyRows()[0]!.click();
    await settle();
    expect(document.querySelector('hlm-dialog-content')).toBeNull(); // cannot edit a deleted product
    (el.querySelector('hlm-switch button') as HTMLElement).click();
    await settle();
    expect(rowNames()).toEqual(['Milk']);
  });

  it('has a filter under each column title, and filters combine', async () => {
    await open([
      record('1', 'Milk', { barcode: '4011', sku: 'M-1', categories: [DAIRY] }),
      record('2', 'Eggs', { barcode: '590222', sku: 'E-2' }),
      record('3', 'Old Tea', { barcode: '590333', active: false }),
    ]);
    const headRows = [...el.querySelectorAll('[role="row"]')].filter((r) => r.querySelector('[role="columnheader"]'));
    expect(headRows).toHaveLength(2); // titles, then filters
    expect(headRows[0]!.textContent).toContain('Categories');
    expect(headRows[1]!.querySelector('hlm-combobox')).not.toBeNull(); // categories filter sits under its title

    await type(el, 'input[aria-label="Filter name"]', 'eggs');
    expect(rowNames()).toEqual(['Eggs']);
    await type(el, 'input[aria-label="Filter name"]', '');
    await type(el, 'input[aria-label="Filter barcode or PLU"]', '4011');
    expect(rowNames()).toEqual(['Milk']);
    await type(el, 'input[aria-label="Filter barcode or PLU"]', '590');
    expect(rowNames()).toEqual(['Eggs', 'Old Tea']);
    await type(el, 'input[aria-label="Filter SKU"]', 'e-2');
    expect(rowNames()).toEqual(['Eggs']);
    await type(el, 'input[aria-label="Filter name"]', 'zzz');
    expect(el.textContent).toContain('No products found');
    expect(el.querySelector('input[aria-label="Filter name"]')).not.toBeNull(); // filters stay when nothing matches
  });

  it('adds a product through the form', async () => {
    await open([record('1', 'Milk')]);
    buttonByText(el, 'Add product').click();
    await settle();
    expect(dialog().textContent).toContain('Add product');

    await type(dialog(), '#p-name', 'Cheese');
    await type(dialog(), '#p-price', '12.5');
    buttonByText(dialog(), 'Save').click();
    await settle();

    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]).toMatchObject({ name: 'Cheese', price: 1250, cost: null, sku: null, active: true });
    expect(document.querySelector('hlm-dialog-content')).toBeNull();
    expect(rowNames()).toEqual(['Cheese', 'Milk']); // newest first
  });

  it('keeps the form open and names the field when the price is wrong or a code is taken', async () => {
    await open([record('1', 'Milk', { sku: 'DUP' })]);
    buttonByText(el, 'Add product').click();
    await settle();
    await type(dialog(), '#p-name', 'Cheese');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(dialog().textContent).toContain('Enter a valid price');
    expect(calls.create).toHaveLength(0);

    await type(dialog(), '#p-price', '3');
    await type(dialog(), '#p-sku', 'DUP');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(dialog().textContent).toContain('SKU is already used');
    expect(dialog()).not.toBeNull();
  });

  it('edits a product, prefilled from its row', async () => {
    await open([record('1', 'Milk', { price: 429, cost: 300, categories: [DAIRY] })]);
    bodyRows()[0]!.click();
    await settle();
    expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('Milk');
    expect((dialog().querySelector('#p-price') as HTMLInputElement).value).toBe('4.29');
    expect((dialog().querySelector('#p-cost') as HTMLInputElement).value).toBe('3.00');

    await type(dialog(), '#p-price', '5');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.update[0]?.[0]).toBe('1');
    expect(calls.update[0]?.[1]).toMatchObject({ price: 500, categoryIds: ['c1'] });
    expect(el.textContent).toContain('₱5.00');
  });

  it('shows weighed products per unit and saves one with or without a code', async () => {
    await open([record('1', 'Beef', { unit: 'kg', barcode: '4011', price: 89900, cost: 60000 })]);
    expect(el.textContent).toContain('₱899.00');
    expect(el.textContent).toContain('/ kg');

    bodyRows()[0]!.click();
    await settle();
    expect(dialog().textContent).toContain('Price per kg');
    expect(dialog().textContent).not.toContain('(required)');
    expect(dialog().querySelector('label[for="p-barcode"]')!.textContent).toBe('PLU'); // sold by weight
    await type(dialog(), '#p-barcode', '');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.update[0]?.[1]).toMatchObject({ unit: 'kg', barcode: null });
    expect(dialog()).toBeNull(); // saved and closed

  });

  describe('delete and restore', () => {
    const tick = (name: string): HTMLElement => el.querySelector(`[aria-label="${name}"]`) as HTMLElement;
    const confirmDialog = (): HTMLElement | null => document.querySelector('hlm-alert-dialog-content');
    const confirmClick = async (): Promise<void> => {
      expect(confirmDialog()).not.toBeNull(); // always asks first
      ([...document.querySelectorAll('[hlmAlertDialogAction]')].pop() as HTMLButtonElement).click();
      await settle();
      expect(confirmDialog()).toBeNull();
    };

    it('has a select column; ticking rows offers bulk Delete after a confirmation', async () => {
      await open([record('1', 'Milk'), record('2', 'Eggs'), record('3', 'Tea')]);
      expect(buttonByText(el, 'Delete 2')).toBeUndefined();
      tick('Select Milk').click();
      tick('Select Tea').click();
      await settle();
      expect(el.textContent).toContain('2 selected');
      buttonByText(el, 'Delete 2').click();
      await settle();
      expect(calls.remove).toHaveLength(0);
      expect(confirmDialog()?.textContent).toContain('Delete 2 products?');
      await confirmClick();
      expect(calls.remove.sort()).toEqual(['1', '3']);
      expect(rowNames()).toEqual(['Eggs']);
      expect(el.textContent).not.toContain('selected'); // selection is cleared
    });

    it('the confirmation lists exactly what it is about to act on, for one row and for a selection', async () => {
      await open([record('1', 'Milk', { sku: 'MLK-1' }), record('2', 'Eggs'), record('3', 'Tea')]);
      tick('Select Milk').click();
      tick('Select Tea').click();
      await settle();
      buttonByText(el, 'Delete 2').click();
      await settle();
      const items = (): string[] => Array.from(confirmDialog()!.querySelectorAll('app-confirm-items li span:first-child')).map((label) => label.textContent!.trim());
      expect(items().sort()).toEqual(['Milk', 'Tea']);
      expect(confirmDialog()!.textContent).toContain('MLK-1'); // the SKU as secondary text
      (document.querySelector('[hlmAlertDialogCancel]') as HTMLElement).click();
      await settle();

      // A single row (context-menu route) lists just that row.
      el.querySelector('[data-row-id="2"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
      await settle();
      (Array.from(document.querySelectorAll('[hlmDropdownMenuItem]')).find((b) => b.textContent?.trim() === 'Delete') as HTMLElement).click();
      await settle();
      expect(items()).toEqual(['Eggs']);
    });

    it('the header checkbox selects the rows of the current page only, and reflects only this page', async () => {
      await open(Array.from({ length: 70 }, (_, i) => record(`p${i + 1}`, `Item ${String(i + 1).padStart(2, '0')}`, { createdAt: 1000 - i })));
      const header = (): HTMLElement => tick('Select all');
      header().click();
      await settle();
      expect(el.textContent).toContain('50 selected'); // not 70
      (el.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click();
      await settle();
      expect(rowNames()).toHaveLength(20);
      expect(el.textContent).toContain('50 selected'); // page 1's rows stay selected
      expect(header().getAttribute('aria-checked')).toBe('false'); // nothing on this page is ticked

      header().click();
      await settle();
      expect(el.textContent).toContain('70 selected');
    });

    it('a selection survives changing pages, so the bulk buttons stay', async () => {
      await open(Array.from({ length: 70 }, (_, i) => record(`p${i + 1}`, `Item ${String(i + 1).padStart(2, '0')}`, { createdAt: 1000 - i })));
      tick('Select Item 01').click();
      await settle();
      expect(el.textContent).toContain('1 selected');
      (el.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click();
      await settle();
      expect(rowNames()[0]).toBe('Item 51');
      expect(el.textContent).toContain('1 selected');
      expect(buttonByText(el, 'Delete 1')).toBeDefined();

      // A Shift + click range can span pages' worth of rows too.
      const row = bodyRows().find((r) => r.textContent?.includes('Item 53'))!;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
      await settle();
      expect(el.textContent).toContain('53 selected'); // Item 01 .. Item 53
    });

    it('Select all ticks every visible row only', async () => {
      await open([record('1', 'Milk'), record('2', 'Eggs')]);
      await type(el, 'input[aria-label="Filter name"]', 'eg');
      tick('Select all').click();
      await settle();
      expect(el.textContent).toContain('1 selected');
      await type(el, 'input[aria-label="Filter name"]', '');
      expect(el.textContent).toContain('1 selected'); // Milk was never ticked
    });

    it('the select-all checkbox shows a dash while only some rows are ticked', async () => {
      await open([record('1', 'Milk'), record('2', 'Eggs')]);
      const all = (): HTMLElement => tick('Select all');
      expect(all().getAttribute('aria-checked')).toBe('false');
      tick('Select Milk').click();
      await settle();
      expect(all().getAttribute('aria-checked')).toBe('mixed');
      tick('Select Eggs').click();
      await settle();
      expect(all().getAttribute('aria-checked')).toBe('true');
    });

    it('restores deleted products in bulk, after a confirmation', async () => {
      await open([record('1', 'Milk'), record('2', 'Old Tea', { deletedAt: 1 })]);
      (el.querySelector('hlm-switch button') as HTMLElement).click();
      await settle();
      tick('Select Old Tea').click();
      await settle();
      expect(buttonByText(el, 'Delete 1')).toBeUndefined(); // only Restore applies to deleted rows
      buttonByText(el, 'Restore 1').click();
      await settle();
      expect(calls.restore).toHaveLength(0);
      await confirmClick();
      expect(calls.restore).toEqual(['2']);
      expect(rowNames()).toEqual([]); // restored, so no longer in the deleted-only list
    });

    it('the row context menu deletes or restores, always confirming', async () => {
      await open([record('1', 'Milk')]);
      bodyRows()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await settle();
      const item = [...document.querySelectorAll('[hlmDropdownMenuItem]')].find((i) => i.textContent?.trim() === 'Delete') as HTMLElement;
      item.click();
      await settle();
      expect(calls.remove).toHaveLength(0);
      await confirmClick();
      expect(calls.remove).toEqual(['1']);
    });

    it('the context menu sets one product active or inactive, offering only a change that does something', async () => {
      await open([record('1', 'Milk'), record('2', 'Eggs', { active: false })]);
      const openMenu = async (row: number): Promise<string[]> => {
        bodyRows()[row]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
        await settle();
        return [...document.querySelectorAll('[hlmDropdownMenuItem]')].map((i) => i.textContent!.trim());
      };
      const choose = async (label: string): Promise<void> => {
        ([...document.querySelectorAll('[hlmDropdownMenuItem]')].find((i) => i.textContent?.trim() === label) as HTMLElement).click();
        await settle();
      };
      expect(await openMenu(1)).toEqual(['Edit', 'Set Active', 'Delete']); // Eggs is inactive
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(await openMenu(0)).toEqual(['Edit', 'Set Inactive', 'Delete']); // Milk is active
      await choose('Set Inactive');
      expect(calls.setActive).toEqual([[['1'], false]]);
      expect(calls.remove).toHaveLength(0); // no confirmation needed
      // The same row's menu must now offer the opposite change (the CDK keeps the data of its first opening).
      expect(await openMenu(0)).toEqual(['Edit', 'Set Active', 'Delete']);
    });

    it('sets a whole selection active from the context menu, skipping rows already in that state', async () => {
      await open([record('1', 'Milk', { active: false }), record('2', 'Eggs', { active: false }), record('3', 'Tea')]);
      tick('Select Milk').click();
      tick('Select Eggs').click();
      tick('Select Tea').click();
      await settle();
      bodyRows()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await settle();
      const items = [...document.querySelectorAll('[hlmDropdownMenuItem]')].map((i) => i.textContent!.trim());
      expect(items).toContain('Set Active'); // mixed selection offers both
      expect(items).toContain('Set Inactive');
      ([...document.querySelectorAll('[hlmDropdownMenuItem]')].find((i) => i.textContent?.trim() === 'Set Active') as HTMLElement).click();
      await settle();
      expect(calls.setActive[0]?.[0].sort()).toEqual(['1', '2']); // Tea was already active
      expect(calls.setActive[0]?.[1]).toBe(true);
    });

    it('acts on the whole selection when the right-clicked row is part of it', async () => {
      await open([record('1', 'Milk'), record('2', 'Eggs'), record('3', 'Tea')]);
      tick('Select Milk').click();
      tick('Select Eggs').click();
      await settle();
      bodyRows()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await settle();
      ([...document.querySelectorAll('[hlmDropdownMenuItem]')].find((i) => i.textContent?.trim() === 'Delete') as HTMLElement).click();
      await settle();
      expect(confirmDialog()?.textContent).toContain('Delete 2 products?');
      await confirmClick();
      expect(calls.remove.sort()).toEqual(['1', '2']);
    });
  });

  it('searches the category list in the form without losing ticked categories', async () => {
    await open([record('1', 'Milk', { categories: [DAIRY] })]);
    bodyRows()[0]!.click();
    await settle();
    expect(dialog().textContent).toContain('1 selected');
    await type(dialog(), 'input[aria-label="Search categories"]', 'zzz');
    expect(dialog().textContent).toContain('No match');
    await type(dialog(), 'input[aria-label="Search categories"]', '');
    expect(dialog().textContent).toContain('Dairy');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.update[0]?.[1]).toMatchObject({ categoryIds: ['c1'] });
  });

  describe('form drafts', () => {
    const openForm = async (row?: number): Promise<void> => {
      if (row === undefined) buttonByText(el, 'Add product').click();
      else bodyRows()[row]!.click();
      await settle();
    };
    const closeForm = async (): Promise<void> => {
      buttonByText(dialog(), 'Close').click();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 400)); // the draft save is debounced
    };

    it('a half-filled new product is saved when the form is closed and comes back when it is reopened', async () => {
      await open([record('1', 'Milk')]);
      await openForm();
      await type(dialog(), '#p-name', 'Cheese');
      await type(dialog(), '#p-price', '12.5');
      await closeForm();
      expect(document.querySelector('hlm-dialog-content')).toBeNull();
      expect(drafts.get('new')).toMatchObject({ name: 'Cheese', price: '12.5' });

      await openForm();
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('Cheese');
      expect((dialog().querySelector('#p-price') as HTMLInputElement).value).toBe('12.5');
      expect(calls.create).toHaveLength(0); // nothing was saved to the catalog
    });

    it('keeps a ticked category in the draft', async () => {
      await open([record('1', 'Milk')]);
      await openForm();
      await type(dialog(), '#p-name', 'Cheese');
      const dairy = [...dialog().querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Dairy')!;
      (dairy.querySelector('brn-checkbox') as HTMLElement).click();
      await settle();
      await closeForm();
      expect(drafts.get('new')?.categoryIds).toEqual(['c1']);
    });

    it('saving clears the draft, so the next new product starts empty', async () => {
      await open([record('1', 'Milk')]);
      await openForm();
      await type(dialog(), '#p-name', 'Cheese');
      await type(dialog(), '#p-price', '3');
      buttonByText(dialog(), 'Save').click();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(drafts.has('new')).toBe(false);
      await openForm();
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('');
    });

    it('Reset puts the form back to its starting values and drops the draft', async () => {
      await open([record('1', 'Milk')]);
      await openForm(0);
      expect(buttonByText(dialog(), 'Reset')).toBeUndefined(); // nothing changed yet
      await type(dialog(), '#p-name', 'Milkshake');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(drafts.get('1')?.name).toBe('Milkshake');
      buttonByText(dialog(), 'Reset').click();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('Milk');
      expect(drafts.has('1')).toBe(false);
    });

    it('an edit draft is kept per product and restored with a notice', async () => {
      await open([record('1', 'Milk'), record('2', 'Eggs')]);
      await openForm(0);
      await type(dialog(), '#p-name', 'Oat Milk');
      await closeForm();
      await openForm(1);
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('Eggs'); // other product unaffected
      await closeForm();
      await openForm(0);
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('Oat Milk');
      expect(TestBed.inject(BannerService).current()?.text).toBe('Draft restored');
    });

    it('drops a draft category that was deleted in the meantime', async () => {
      await open([record('1', 'Milk')]);
      drafts.set('new', { name: 'Cheese', unit: 'each', tracking: 'none', shelfLifeDays: '', criticalLevel: '', sku: '', barcode: '', price: '1', cost: '', active: true, categoryIds: ['c1', 'gone'] });
      await openForm();
      expect((dialog().querySelector('#p-name') as HTMLInputElement).value).toBe('Cheese');
      buttonByText(dialog(), 'Save').click();
      await settle();
      expect(calls.create[0]?.categoryIds).toEqual(['c1']);
    });
  });

  it('deletes a product after confirming', async () => {
    await open([record('1', 'Milk'), record('2', 'Eggs')]);
    bodyRows()[0]!.click();
    await settle();
    buttonByText(dialog(), 'Delete').click();
    await settle();
    expect(calls.remove).toHaveLength(0); // asks first
    const confirm = [...document.querySelectorAll('[hlmAlertDialogAction]')].pop() as HTMLButtonElement;
    confirm.click();
    await settle();
    expect(calls.remove).toEqual(['1']);
    expect(rowNames()).toEqual(['Eggs']);
    expect(document.querySelector('hlm-dialog-content')).toBeNull();
  });
});
