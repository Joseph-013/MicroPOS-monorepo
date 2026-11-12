import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type CategoryInput,
  type CategoryRecord,
  DESKTOP_API_VERSION,
  type DesktopApi,
  type SaveCategoryResult,
} from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { CategoriesPage } from './categories';

// jsdom has no ResizeObserver or scrollIntoView (overlay and select code use them).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
Element.prototype.scrollIntoView ??= () => undefined;

const record = (id: string, name: string, over: Partial<CategoryRecord> = {}): CategoryRecord => ({
  id,
  name,
  sortOrder: 0,
  productCount: 0,
  createdAt: Date.UTC(2026, 0, 15, 8),
  deletedAt: null,
  ...over,
});

/** In-memory stand-in for the categories bridge; rejects a duplicate name the way the real one does. */
function fakeApi(initial: CategoryRecord[]) {
  const rows = [...initial];
  const calls = { create: [] as CategoryInput[], update: [] as [string, CategoryInput][], remove: [] as string[], restore: [] as string[] };
  const save = (id: string | null, input: CategoryInput): SaveCategoryResult => {
    if (rows.some((r) => !r.deletedAt && r.id !== id && r.name.toLowerCase() === input.name.trim().toLowerCase())) {
      return { ok: false, field: 'name', error: 'Name is already used' };
    }
    const at = rows.findIndex((r) => r.id === id);
    const category = record(id ?? `new-${rows.length}`, input.name.trim(), { sortOrder: input.sortOrder, createdAt: at >= 0 ? rows[at]!.createdAt : Date.now() });
    if (at >= 0) rows[at] = category;
    else rows.push(category);
    return { ok: true, category };
  };
  const api = {
    platform: 'linux',
    version: () => Promise.resolve(DESKTOP_API_VERSION),
    scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
    catalog: { listProducts: () => Promise.resolve([]), listCategories: () => Promise.resolve([]) },
    categories: {
      list: (options?: { includeDeleted?: boolean }) => Promise.resolve(rows.filter((r) => options?.includeDeleted || !r.deletedAt)),
      create: (input: CategoryInput) => (calls.create.push(input), Promise.resolve(save(null, input))),
      update: (id: string, input: CategoryInput) => (calls.update.push([id, input]), Promise.resolve(save(id, input))),
      remove: (ids: string[]) => {
        calls.remove.push(...ids);
        for (const row of rows) if (ids.includes(row.id)) row.deletedAt = Date.now();
        return Promise.resolve();
      },
      restore: (ids: string[]) => {
        calls.restore.push(...ids);
        for (const row of rows) if (ids.includes(row.id)) row.deletedAt = null;
        return Promise.resolve({ restored: ids.length, conflicts: [] });
      },
    },
  } as unknown as DesktopApi;
  return { api, calls };
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('CategoriesPage', () => {
  let fixture: ComponentFixture<CategoriesPage>;
  let el: HTMLElement;
  let calls: ReturnType<typeof fakeApi>['calls'];

  async function open(rows: CategoryRecord[]): Promise<void> {
    const fake = fakeApi(rows);
    calls = fake.calls;
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DESKTOP_API, useValue: fake.api }] });
    fixture = TestBed.createComponent(CategoriesPage);
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
  const names = (): string[] => bodyRows().map((r) => r.querySelectorAll('[role="cell"]')[1]!.textContent!.trim());
  const type = async (root: ParentNode, selector: string, value: string): Promise<void> => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const dialog = (): HTMLElement => document.querySelector('hlm-dialog-content') as HTMLElement;
  const tick = (label: string): HTMLElement => el.querySelector(`[aria-label="${label}"]`) as HTMLElement;
  const confirmDialog = (): HTMLElement | null => document.querySelector('hlm-alert-dialog-content');
  const confirmClick = async (): Promise<void> => {
    expect(confirmDialog()).not.toBeNull(); // always asks first
    ([...document.querySelectorAll('[hlmAlertDialogAction]')].pop() as HTMLButtonElement).click();
    await settle();
    expect(confirmDialog()).toBeNull();
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  it('lists categories newest first with their product counts, and filters by name', async () => {
    await open([
      record('1', 'Dairy', { productCount: 4, createdAt: Date.UTC(2026, 0, 1) }),
      record('2', 'Bakery', { productCount: 0, createdAt: Date.UTC(2026, 0, 5) }),
    ]);
    expect(names()).toEqual(['Bakery', 'Dairy']); // newest first
    expect(el.textContent).toContain('4');
    await type(el, 'input[aria-label="Filter name"]', 'dai');
    expect(names()).toEqual(['Dairy']);
    await type(el, 'input[aria-label="Filter name"]', 'zzz');
    expect(el.textContent).toContain('No categories found');
    expect(el.querySelector('input[aria-label="Filter name"]')).not.toBeNull(); // the filters stay
  });

  it('links a product count to the products in that category', async () => {
    await open([record('1', 'Dairy', { productCount: 4 })]);
    const link = el.querySelector('a[href*="/items/products"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/items/products?category=Dairy');
  });

  it('sorts by a column and reverses on a second click', async () => {
    await open([record('1', 'Dairy', { sortOrder: 2 }), record('2', 'Bakery', { sortOrder: 1 })]);
    const header = (label: string): HTMLButtonElement => [...el.querySelectorAll('[role="columnheader"] button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    header('Order').click();
    await fixture.whenStable();
    expect(names()).toEqual(['Bakery', 'Dairy']);
    header('Order').click();
    await fixture.whenStable();
    expect(names()).toEqual(['Dairy', 'Bakery']);
  });

  it('adds a category through the form and shows an error for a duplicate name', async () => {
    await open([record('1', 'Dairy')]);
    buttonByText(el, 'Add category').click();
    await settle();
    expect(dialog().textContent).toContain('Add category');
    await type(dialog(), '#c-name', 'dairy');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(dialog().textContent).toContain('Name is already used');
    await type(dialog(), '#c-name', 'Frozen');
    await type(dialog(), '#c-order', '3');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.create.at(-1)).toEqual({ name: 'Frozen', sortOrder: 3 });
    expect(document.querySelector('hlm-dialog-content')).toBeNull();
    expect(names()).toContain('Frozen');
  });

  it('edits a category, prefilled from its row', async () => {
    await open([record('1', 'Dairy', { sortOrder: 2 })]);
    bodyRows()[0]!.click();
    await settle();
    expect((dialog().querySelector('#c-name') as HTMLInputElement).value).toBe('Dairy');
    expect((dialog().querySelector('#c-order') as HTMLInputElement).value).toBe('2');
    await type(dialog(), '#c-name', 'Milk');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(calls.update[0]).toEqual(['1', { name: 'Milk', sortOrder: 2 }]);
    expect(names()).toEqual(['Milk']);
  });

  it('rejects an empty name and a bad order before saving', async () => {
    await open([]);
    buttonByText(el, 'Add category').click();
    await settle();
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(dialog().textContent).toContain('Enter a name');
    await type(dialog(), '#c-name', 'X');
    await type(dialog(), '#c-order', '1.5');
    buttonByText(dialog(), 'Save').click();
    await settle();
    expect(dialog().textContent).toContain('Enter a whole number');
    expect(calls.create).toHaveLength(0);
  });

  it('deletes after a confirmation: bulk, context menu and the form', async () => {
    await open([record('1', 'Dairy'), record('2', 'Bakery'), record('3', 'Frozen'), record('4', 'Snacks')]);
    tick('Select Dairy').click();
    tick('Select Bakery').click();
    await settle();
    expect(el.textContent).toContain('2 selected');
    buttonByText(el, 'Delete 2').click();
    await settle();
    expect(calls.remove).toHaveLength(0);
    expect(confirmDialog()?.textContent).toContain('Delete 2 categories?');
    await confirmClick();
    expect(calls.remove.sort()).toEqual(['1', '2']);
    expect(names().sort()).toEqual(['Frozen', 'Snacks']);

    bodyRows()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    await settle();
    ([...document.querySelectorAll('[hlmDropdownMenuItem]')].find((i) => i.textContent?.trim() === 'Delete') as HTMLElement).click();
    await settle();
    await confirmClick();
    expect(calls.remove).toHaveLength(3);

    bodyRows()[0]!.click();
    await settle();
    buttonByText(dialog(), 'Delete').click();
    await settle();
    await confirmClick();
    expect(calls.remove).toHaveLength(4);
    expect(names()).toEqual([]);
  });

  it('Deleted only lists just the deleted ones, read-only, and restores them after a confirmation', async () => {
    await open([record('1', 'Dairy'), record('2', 'Old', { deletedAt: 1 })]);
    expect(names()).toEqual(['Dairy']);
    (el.querySelector('hlm-switch button') as HTMLElement).click();
    await settle();
    expect(names()).toEqual(['Old']);
    bodyRows()[0]!.click();
    await settle();
    expect(document.querySelector('hlm-dialog-content')).toBeNull(); // cannot edit a deleted category
    tick('Select Old').click();
    await settle();
    expect(buttonByText(el, 'Delete 1')).toBeUndefined();
    buttonByText(el, 'Restore 1').click();
    await settle();
    expect(calls.restore).toHaveLength(0);
    await confirmClick();
    expect(calls.restore).toEqual(['2']);
    expect(names()).toEqual([]);
  });
});
