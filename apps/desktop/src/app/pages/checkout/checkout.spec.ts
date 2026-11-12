import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CatalogProduct, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { ScannerService } from '../../core/scanner';
import { CheckoutPage } from './checkout';

const p = (id: string, name: string, price: number, categoryNames: string[], n: number): CatalogProduct => ({
  id,
  name,
  price,
  categories: categoryNames.map((name) => ({ id: name, name })),
  sku: `PRD-0000${n}`,
  plu: `100${n}`,
  barcode: `59000000000${n}${n}`,
});
const PRODUCTS = [
  p('1', 'Bananas (bunch)', 179, ['Produce', 'Snacks', 'Fruit', 'Organic'], 1),
  p('2', 'Whole Milk (1 gal)', 429, ['Dairy', 'Beverages'], 2),
  p('3', 'Large Eggs (dozen)', 349, ['Dairy'], 3),
];
const API: DesktopApi = {
  platform: 'linux',
  catalog: {
    listProducts: () => Promise.resolve(PRODUCTS),
    listCategories: () => Promise.resolve([{ id: 'Dairy', name: 'Dairy' }, { id: 'Produce', name: 'Produce' }]),
  },
};

/** Simulates a scanner: every character then Enter, effectively instantly. */
function scan(code: string): void {
  for (const ch of [...code, 'Enter']) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
  }
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('CheckoutPage', () => {
  let fixture: ComponentFixture<CheckoutPage>;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: API }] });
    TestBed.inject(ScannerService);
    fixture = TestBed.createComponent(CheckoutPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => fixture.destroy());

  const articles = (): number => document.querySelectorAll('article').length;
  const search = async (text: string): Promise<void> => {
    const input = document.querySelector('input[aria-label^="Search"]') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };

  it('starts with an empty order, payment controls on the right and no item grid on the page', () => {
    expect(el.textContent).toContain('No items yet');
    expect(el.textContent).toContain('Complete sale');
    expect(el.textContent).toContain('$0.00');
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
    expect(el.textContent).toContain('$8.58'); // 2 x 4.29

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

  it('searches name, barcode, SKU and PLU in one box', async () => {
    buttonByText(el, 'Add items').click();
    await fixture.whenStable();
    const milk = PRODUCTS[1];
    for (const term of [milk.name, milk.name.toUpperCase(), milk.barcode!, milk.sku!, milk.plu!, milk.barcode!.slice(-5)]) {
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
    expect(el.textContent).toContain('$1.79');

    scan(PRODUCTS[0].barcode!);
    await fixture.whenStable();
    expect(el.textContent).toContain('$3.58');

    scan('9999999999994');
    await fixture.whenStable();
    expect(el.textContent).toContain('Unknown barcode 9999999999994');
    expect(el.textContent).toContain('$3.58');
  });

  it('steps quantities and removes a line at zero', async () => {
    scan(PRODUCTS[2].barcode!);
    await fixture.whenStable();
    (el.querySelector('button[aria-label="Increase quantity"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.textContent).toContain('$6.98');
    const dec = el.querySelector('button[aria-label="Decrease quantity"]') as HTMLButtonElement;
    dec.click();
    dec.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('No items yet');
  });
});
