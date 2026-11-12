import { TestBed } from '@angular/core/testing';
import { type CatalogProduct, DESKTOP_API_VERSION, type DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { CatalogService } from './catalog.service';

const noDraft = { loadDraft: () => Promise.resolve(null), saveDraft: () => Promise.resolve(), clearDraft: () => Promise.resolve() };

const product = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: 'x',
  name: 'Item',
  sku: null,
  barcode: null,
  plu: null,
  categories: [],
  price: 100,
  ...over,
});

function setup(api: DesktopApi | undefined): CatalogService {
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return TestBed.inject(CatalogService);
}

describe('CatalogService', () => {
  it('loads products and categories through the bridge', async () => {
    const service = setup({
      platform: 'linux',
      version: () => Promise.resolve(DESKTOP_API_VERSION),
      checkout: noDraft,
      catalog: {
        listProducts: () => Promise.resolve([product({ id: 'a', name: 'Milk', barcode: '111', sku: 'S-1', plu: '4' })]),
        listCategories: () => Promise.resolve([{ id: 'c', name: 'Dairy' }]),
      },
    });
    expect(service.status()).toBe('idle');
    await service.load();
    expect(service.status()).toBe('ready');
    expect(service.products().length).toBe(1);
    expect(service.categories()[0].name).toBe('Dairy');
    expect(service.findByCode('111')?.name).toBe('Milk');
    expect(service.findByCode('S-1')?.name).toBe('Milk');
    expect(service.findByCode('4')?.name).toBe('Milk');
    expect(service.findByCode('nope')).toBeUndefined();
  });

  it('reports an error when the bridge fails or is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = setup({
      platform: 'linux',
      version: () => Promise.resolve(DESKTOP_API_VERSION),
      checkout: noDraft,
      catalog: { listProducts: () => Promise.reject(new Error('boom')), listCategories: () => Promise.resolve([]) },
    });
    await failing.load();
    expect(failing.status()).toBe('error');

    TestBed.resetTestingModule();
    const missing = setup(undefined);
    await missing.load();
    expect(missing.status()).toBe('error');
  });
});
