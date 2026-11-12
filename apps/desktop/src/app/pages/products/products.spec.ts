import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DESKTOP_API_VERSION,
  type DesktopApi,
  type ProductInput,
  type ProductRecord,
  type SaveProductResult,
} from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { ScannerService } from '../../core/scanner';
import { ProductsPage } from './products';

// jsdom has no ResizeObserver (overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const DAIRY = { id: 'c1', name: 'Dairy' };
const record = (id: string, name: string, over: Partial<ProductRecord> = {}): ProductRecord => ({
  id,
  name,
  sku: `SKU-${id}`,
  barcode: `590${id}`,
  price: 429,
  cost: 300,
  unit: 'each',
  active: true,
  createdAt: Date.UTC(2026, 0, 15, 8, 30),
  deletedAt: null,
  categories: [],
  ...over,
});

/** In-memory stand-in for the products bridge; duplicates SKUs the way the real one does. */
function fakeApi(initial: ProductRecord[]) {
  const rows = [...initial];
  const calls = { create: [] as ProductInput[], update: [] as [string, ProductInput][], remove: [] as string[], restore: [] as string[], setActive: [] as [string[], boolean][] };
  const save = (id: string | null, input: ProductInput): SaveProductResult => {
    if (input.sku && rows.some((r) => r.sku === input.sku && r.id !== id)) return { ok: false, field: 'sku', error: 'SKU is already used' };
    const product: ProductRecord = {
      ...input,
      id: id ?? `new-${rows.length}`,
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
    scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
    catalog: { listProducts: () => Promise.resolve([]), listCategories: () => Promise.resolve([DAIRY]) },
    products: {
      list: (options) => Promise.resolve(rows.filter((r) => options?.includeDeleted || !r.deletedAt)),
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
    checkout: { loadDraft: () => Promise.resolve(null), saveDraft: () => Promise.resolve(), clearDraft: () => Promise.resolve() },
  };
  return { api, calls };
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('ProductsPage', () => {
  let fixture: ComponentFixture<ProductsPage>;
  let el: HTMLElement;
  let calls: ReturnType<typeof fakeApi>['calls'];

  async function open(rows: ProductRecord[]): Promise<void> {
    const fake = fakeApi(rows);
    calls = fake.calls;
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: fake.api }] });
    TestBed.inject(ScannerService); // started at launch by the app root; its keydown listener must exist first
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
  const dialog = (): HTMLElement => document.querySelector('hlm-dialog-content') as HTMLElement;

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
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
    await type(el, 'input[aria-label="Created from"]', '2026-01-15');
    expect(rowNames()).toEqual(['Late', 'Mid']); // newest first
    await type(el, 'input[aria-label="Created to"]', '2026-01-15');
    expect(rowNames()).toEqual(['Mid']); // the whole last day counts
    await type(el, 'input[aria-label="Created from"]', '');
    expect(rowNames()).toEqual(['Mid', 'Early']); // newest first
  });

  it('resets every filter at once from the button in the select column', async () => {
    await open([record('1', 'Milk', { barcode: '4011' }), record('2', 'Eggs', { active: false })]);
    const reset = (): HTMLButtonElement => el.querySelector('button[aria-label="Reset filters"]') as HTMLButtonElement;
    expect(reset().disabled).toBe(true); // nothing to reset
    await type(el, 'input[aria-label="Filter name"]', 'eg');
    await type(el, 'input[aria-label="Created from"]', '2020-01-01');
    expect(reset().disabled).toBe(false);
    expect(rowNames()).toEqual(['Eggs']);
    reset().click();
    await fixture.whenStable();
    expect(rowNames()).toHaveLength(2);
    expect((el.querySelector('input[aria-label="Filter name"]') as HTMLInputElement).value).toBe('');
    expect(reset().disabled).toBe(true);
  });

  it('clears a filter with its x button, which only shows while the field has text', async () => {
    await open([record('1', 'Milk'), record('2', 'Eggs')]);
    const clear = (): HTMLButtonElement | null => el.querySelector('button[aria-label="Clear filter name"]');
    expect(clear()).toBeNull();
    await type(el, 'input[aria-label="Filter name"]', 'eggs');
    expect(rowNames()).toEqual(['Eggs']);
    clear()!.click();
    await fixture.whenStable();
    expect((el.querySelector('input[aria-label="Filter name"]') as HTMLInputElement).value).toBe('');
    expect(rowNames()).toHaveLength(2);
    expect(clear()).toBeNull();
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
      buttonByText(dialog(), 'Cancel').click();
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

  it('shows weighed products per unit and asks for a code before saving one', async () => {
    await open([record('1', 'Beef', { unit: 'kg', barcode: '4011', price: 89900, cost: 60000 })]);
    expect(el.textContent).toContain('₱899.00');
    expect(el.textContent).toContain('/ kg');

    bodyRows()[0]!.click();
    await settle();
    expect(dialog().textContent).toContain('Price per kg');
    expect(dialog().textContent).toContain('Barcode / PLU (required)');
    await type(dialog(), '#p-barcode', '');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(dialog().textContent).toContain('A weighed product needs a barcode or PLU');
    expect(calls.update).toHaveLength(0);

    await type(dialog(), '#p-barcode', '4012');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.update[0]?.[1]).toMatchObject({ unit: 'kg', barcode: '4012', price: 89900 });
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
