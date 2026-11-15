import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { DesktopApi, SalesOrderDetail } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { CheckoutCopy } from './checkout-copy';

// jsdom has no ResizeObserver (some overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const order = {
  orderNumber: 'SO-1001',
  refundOf: null,
  lines: [
    { id: 'l1', productId: 'p1', name: 'Milk', unitPrice: 429, quantityMilli: 2000, lineTotal: 858, discount: 0, unit: 'each' },
    { id: 'l2', productId: null, name: 'Removed', unitPrice: 100, quantityMilli: 1000, lineTotal: 100, discount: 0, unit: 'each' },
  ],
} as unknown as SalesOrderDetail;

const setup = (draftLines: number): CheckoutCopy => {
  const api = {
    checkout: { loadDraft: () => Promise.resolve({ lines: Array.from({ length: draftLines }, (_, i) => ({ productId: `d${i}`, name: 'X', quantityMilli: 1000, unitPrice: 100, unit: 'each' })) }), saveDraft: () => Promise.resolve() },
  } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }, provideRouter([])] });
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return TestBed.inject(CheckoutCopy);
};
const press = async (text: string): Promise<void> => {
  await new Promise((r) => setTimeout(r, 20));
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!.click();
};

describe('CheckoutCopy', () => {
  it('goes straight to Checkout when nothing is in progress, leaving out products that are gone', async () => {
    const copy = setup(0);
    expect(await copy.copy(order)).toBe(true);
    expect(copy.pending()).toEqual({ orderNumber: 'SO-1001', mode: 'add', lines: [{ productId: 'p1', name: 'Milk', quantityMilli: 2000, unitPrice: 429 }] });
  });

  it('asks when an order is in progress: copy on top, overwrite, or cancel', async () => {
    let copy = setup(2);
    let done = copy.copy(order);
    await press('Copy on top');
    expect(await done).toBe(true);
    expect(copy.pending()?.mode).toBe('add');

    TestBed.resetTestingModule();
    copy = setup(2);
    done = copy.copy(order);
    await press('Overwrite');
    expect(await done).toBe(true);
    expect(copy.pending()?.mode).toBe('replace');

    TestBed.resetTestingModule();
    copy = setup(2);
    done = copy.copy(order);
    await press('Cancel');
    expect(await done).toBe(false);
    expect(copy.pending()).toBeNull();
  });
});
