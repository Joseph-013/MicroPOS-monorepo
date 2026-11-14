import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DesktopApi, Permission, TableColumnOrders } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { AuthService } from '../auth/auth.service';
import { fakeAuthApi, sessionUser } from '../auth/testing';
import { ColumnConfig } from './column-config';
import { tableLayout } from './table-columns';

const DEFS = [
  { key: 'name', label: 'Name', width: '10rem' },
  { key: 'sku', label: 'SKU', width: '6rem' },
  { key: 'price', label: 'Price', width: '5rem' },
];

@Component({ imports: [ColumnConfig], template: `<app-column-config [layout]="layout" />` })
class Host {
  readonly layout = tableLayout('things', DEFS, '3rem', '2rem');
}

async function setup(permissions: Permission[], saved: TableColumnOrders = {}) {
  const writes: [string, string[]][] = [];
  const api = {
    ...fakeAuthApi({ status: sessionUser(permissions) }).api,
    tables: {
      columnOrders: () => Promise.resolve(saved),
      saveColumnOrder: (id: string, keys: string[]) => (writes.push([id, keys]), Promise.resolve(true)),
    },
  } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  await TestBed.inject(AuthService).whenReady();
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 20));
  await fixture.whenStable();
  return { fixture, writes, layout: fixture.componentInstance.layout };
}

describe('table cells on a phone', () => {
  it('gives each cell its order, its label and whether it is the card title (the first column)', async () => {
    const { layout } = await setup(['settings.manage'], { things: ['price', 'name'] });
    expect(layout.col('price')).toEqual({ order: 1, label: 'Price', primary: true });
    expect(layout.col('name')).toEqual({ order: 2, label: 'Name', primary: false });
    expect(layout.col('nope').label).toBe('');
  });

  it('has a Sort and filter button, for anyone, that opens the title and filter rows', async () => {
    const { fixture, layout } = await setup(['checkout.sell']);
    const button = (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Sort and filter"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(layout.filtersOpen()).toBe(false);
    button.click();
    expect(layout.filtersOpen()).toBe(true);
    expect(button.classList.contains('md:hidden')).toBe(true); // phone-sized screens only
  });
});

describe('table column order', () => {
  it('lists the columns in the saved order, with the selection and actions columns fixed at the ends', async () => {
    const { layout } = await setup(['settings.manage'], { things: ['price', 'name'] });
    expect(layout.keys()).toEqual(['price', 'name', 'sku']); // a column the saved list does not know goes last
    expect(layout.template()).toBe('3rem 5rem 10rem 6rem 2rem');
    expect(layout.order('price')).toBe(1);
    expect(layout.order('sku')).toBe(3);
  });

  it('moves a column, saves the whole order, and ignores moves off the ends', async () => {
    const { layout, writes } = await setup(['settings.manage']);
    layout.move('sku', 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toEqual([['things', ['sku', 'name', 'price']]]);
    expect(layout.template()).toBe('3rem 6rem 10rem 5rem 2rem');
    layout.move('sku', -1);
    layout.move('price', 3);
    expect(writes.length).toBe(1);
  });

  it('shows the Columns button, and a handle for each column, to an admin only', async () => {
    const admin = await setup(['settings.manage']);
    const button = (admin.fixture.nativeElement as HTMLElement).querySelector('[aria-label="Columns"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    admin.fixture.detectChanges();
    await admin.fixture.whenStable();
    const handles = [...document.querySelectorAll('[aria-label^="Move "]')].map((b) => b.getAttribute('aria-label')!.split(' (')[0]);
    expect(handles).toEqual(['Move Name', 'Move SKU', 'Move Price']);
    TestBed.resetTestingModule();
    const cashier = await setup(['checkout.sell']);
    expect((cashier.fixture.nativeElement as HTMLElement).querySelector('[aria-label="Columns"]')).toBeNull();
  });
});
