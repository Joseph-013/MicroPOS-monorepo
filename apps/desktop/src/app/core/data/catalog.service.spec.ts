import { TestBed } from '@angular/core/testing';
import { type CatalogProduct, DESKTOP_API_VERSION, type DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { CatalogService } from './catalog.service';

const noDraft = { nextOrderNumber: () => Promise.resolve('SO-1001'), completeOrder: () => Promise.reject(new Error('unused')), loadDraft: () => Promise.resolve(null), saveDraft: () => Promise.resolve(), clearDraft: () => Promise.resolve() };

const noProducts = {
  list: () => Promise.resolve([]),
  create: () => Promise.reject(new Error('unused')),
  update: () => Promise.reject(new Error('unused')),
  remove: () => Promise.resolve(),
  restore: () => Promise.resolve({ restored: 0, conflicts: [] }),
  setActive: () => Promise.resolve(),
  loadDraft: () => Promise.resolve(null),
  saveDraft: () => Promise.resolve(),
  clearDraft: () => Promise.resolve(),
};

const product = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: 'x',
  name: 'Item',
  sku: null,
  barcode: null,
  categories: [],
  price: 100,
  unit: 'each',
  tracking: 'none',
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
      categories: {
        list: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('unused')),
        update: () => Promise.reject(new Error('unused')),
        remove: () => Promise.resolve(),
        restore: () => Promise.resolve({ restored: 0, conflicts: [] }),
      },
      inventory: { returnToSupplier: () => Promise.reject(new Error('unused')), listBatches: () => Promise.resolve([]),
      concerns: () => Promise.resolve([]),
      receive: () => Promise.reject(new Error('unused')), adjust: () => Promise.reject(new Error('unused')), repackage: () => Promise.reject(new Error('unused')), loadRepackageDraft: () => Promise.resolve(null), saveRepackageDraft: () => Promise.resolve(), clearRepackageDraft: () => Promise.resolve() },
      data: { onChanged: () => () => undefined },
      shell: { getWindowMode: () => Promise.resolve('windowed' as const), setWindowMode: () => Promise.resolve(true), getCloseToTray: () => Promise.resolve(false), setCloseToTray: () => Promise.resolve(true), getLogsFolder: () => Promise.resolve(null), openLogsFolder: () => Promise.resolve(false) },
      backup: { list: () => Promise.resolve({ backups: [], folder: '' }), create: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve(false), exportTo: () => Promise.reject(new Error('unused')), exportCsv: () => Promise.reject(new Error('unused')), importFrom: () => Promise.reject(new Error('unused')), restore: () => Promise.reject(new Error('unused')), openFolder: () => Promise.resolve(false) },
      lan: { state: () => Promise.reject(new Error('unused')), setEnabled: () => Promise.reject(new Error('unused')), devices: () => Promise.resolve([]), newPairing: () => Promise.resolve(null), revokeDevice: () => Promise.resolve(false) },
      dashboard: { get: () => Promise.reject(new Error('unused')) },
      tables: { columnOrders: () => Promise.resolve({}), saveColumnOrder: () => Promise.resolve(true) },
      reports: { sales: () => Promise.resolve(null), export: () => Promise.reject(new Error('unused')) },
      debug: { get: () => Promise.resolve({ saveImages: false, folder: '/downloads/MicroPOS receipts' }), setSaveImages: () => Promise.resolve(true), openReceiptsFolder: () => Promise.resolve(true) },
      log: { write: () => Promise.resolve() },
      printer: { getLogo: () => Promise.resolve(null), saveLogo: () => Promise.reject(new Error('unused')), removeLogo: () => Promise.resolve(), settings: () => Promise.reject(new Error('unused')), save: () => Promise.reject(new Error('unused')), listUsb: () => Promise.resolve([]), testPrint: () => Promise.reject(new Error('unused')), printOrder: () => Promise.reject(new Error('unused')) },
      scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
      customers: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve({ removed: 0, blocked: [] }), restore: () => Promise.resolve(), account: () => Promise.resolve(null), receivePayment: () => Promise.reject(new Error('unused')), interestDefaults: () => Promise.resolve({ orderRateBp: 300, totalRateBp: 300 }), saveInterestDefaults: () => Promise.resolve(true), alertCount: () => Promise.resolve(0), alertSettings: () => Promise.resolve({ amount: null, days: null }), saveAlertSettings: () => Promise.resolve(true) },
      display: { show: () => Promise.resolve(), hide: () => Promise.resolve(), isOpen: () => Promise.resolve(false), onVisibility: () => () => undefined, publish: () => Promise.resolve(), getState: () => Promise.resolve({ phase: 'idle', lines: [], total: 0, highlight: null, receipt: null }), onState: () => () => undefined },
      auth: { status: () => Promise.resolve(null), choices: () => Promise.resolve([]), signIn: () => Promise.reject(new Error('unused')), signOut: () => Promise.resolve(), changePin: () => Promise.reject(new Error('unused')), activity: () => Promise.resolve({ user: null, timeoutMinutes: null }), setSessionTimeout: () => Promise.resolve(true) },
      users: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), resetPin: () => Promise.reject(new Error('unused')), signInLog: () => Promise.resolve([]) },
      suppliers: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve({ removed: 0, blocked: [] }), restore: () => Promise.resolve() },
      purchases: { concerns: () => Promise.resolve([]), list: () => Promise.resolve([]), get: () => Promise.resolve(null), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), receive: () => Promise.reject(new Error('unused')), pay: () => Promise.reject(new Error('unused')), cancel: () => Promise.reject(new Error('unused')) },
      orders: { list: () => Promise.resolve([]), get: () => Promise.resolve(null), idByNumber: () => Promise.resolve(null), void: () => Promise.reject(new Error('unused')), refund: () => Promise.reject(new Error('unused')) },
      checkout: noDraft,
      products: noProducts,
      catalog: {
        listProducts: () => Promise.resolve([product({ id: 'a', name: 'Milk', barcode: '111', sku: 'S-1' })]),
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
    expect(service.findByCode('nope')).toBeUndefined();
  });

  it('reports an error when the bridge fails or is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = setup({
      platform: 'linux',
      version: () => Promise.resolve(DESKTOP_API_VERSION),
      categories: {
        list: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('unused')),
        update: () => Promise.reject(new Error('unused')),
        remove: () => Promise.resolve(),
        restore: () => Promise.resolve({ restored: 0, conflicts: [] }),
      },
      inventory: { returnToSupplier: () => Promise.reject(new Error('unused')), concerns: () => Promise.resolve([]), listBatches: () => Promise.resolve([]), receive: () => Promise.reject(new Error('unused')), adjust: () => Promise.reject(new Error('unused')), repackage: () => Promise.reject(new Error('unused')), loadRepackageDraft: () => Promise.resolve(null), saveRepackageDraft: () => Promise.resolve(), clearRepackageDraft: () => Promise.resolve() },
      data: { onChanged: () => () => undefined },
      shell: { getWindowMode: () => Promise.resolve('windowed' as const), setWindowMode: () => Promise.resolve(true), getCloseToTray: () => Promise.resolve(false), setCloseToTray: () => Promise.resolve(true), getLogsFolder: () => Promise.resolve(null), openLogsFolder: () => Promise.resolve(false) },
      backup: { list: () => Promise.resolve({ backups: [], folder: '' }), create: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve(false), exportTo: () => Promise.reject(new Error('unused')), exportCsv: () => Promise.reject(new Error('unused')), importFrom: () => Promise.reject(new Error('unused')), restore: () => Promise.reject(new Error('unused')), openFolder: () => Promise.resolve(false) },
      lan: { state: () => Promise.reject(new Error('unused')), setEnabled: () => Promise.reject(new Error('unused')), devices: () => Promise.resolve([]), newPairing: () => Promise.resolve(null), revokeDevice: () => Promise.resolve(false) },
      dashboard: { get: () => Promise.reject(new Error('unused')) },
      tables: { columnOrders: () => Promise.resolve({}), saveColumnOrder: () => Promise.resolve(true) },
      reports: { sales: () => Promise.resolve(null), export: () => Promise.reject(new Error('unused')) },
      debug: { get: () => Promise.resolve({ saveImages: false, folder: '/downloads/MicroPOS receipts' }), setSaveImages: () => Promise.resolve(true), openReceiptsFolder: () => Promise.resolve(true) },
      log: { write: () => Promise.resolve() },
      printer: { getLogo: () => Promise.resolve(null), saveLogo: () => Promise.reject(new Error('unused')), removeLogo: () => Promise.resolve(), settings: () => Promise.reject(new Error('unused')), save: () => Promise.reject(new Error('unused')), listUsb: () => Promise.resolve([]), testPrint: () => Promise.reject(new Error('unused')), printOrder: () => Promise.reject(new Error('unused')) },
      scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
      customers: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve({ removed: 0, blocked: [] }), restore: () => Promise.resolve(), account: () => Promise.resolve(null), receivePayment: () => Promise.reject(new Error('unused')), interestDefaults: () => Promise.resolve({ orderRateBp: 300, totalRateBp: 300 }), saveInterestDefaults: () => Promise.resolve(true), alertCount: () => Promise.resolve(0), alertSettings: () => Promise.resolve({ amount: null, days: null }), saveAlertSettings: () => Promise.resolve(true) },
      display: { show: () => Promise.resolve(), hide: () => Promise.resolve(), isOpen: () => Promise.resolve(false), onVisibility: () => () => undefined, publish: () => Promise.resolve(), getState: () => Promise.resolve({ phase: 'idle', lines: [], total: 0, highlight: null, receipt: null }), onState: () => () => undefined },
      auth: { status: () => Promise.resolve(null), choices: () => Promise.resolve([]), signIn: () => Promise.reject(new Error('unused')), signOut: () => Promise.resolve(), changePin: () => Promise.reject(new Error('unused')), activity: () => Promise.resolve({ user: null, timeoutMinutes: null }), setSessionTimeout: () => Promise.resolve(true) },
      users: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), resetPin: () => Promise.reject(new Error('unused')), signInLog: () => Promise.resolve([]) },
      suppliers: { list: () => Promise.resolve([]), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve({ removed: 0, blocked: [] }), restore: () => Promise.resolve() },
      purchases: { concerns: () => Promise.resolve([]), list: () => Promise.resolve([]), get: () => Promise.resolve(null), create: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')), receive: () => Promise.reject(new Error('unused')), pay: () => Promise.reject(new Error('unused')), cancel: () => Promise.reject(new Error('unused')) },
      orders: { list: () => Promise.resolve([]), get: () => Promise.resolve(null), idByNumber: () => Promise.resolve(null), void: () => Promise.reject(new Error('unused')), refund: () => Promise.reject(new Error('unused')) },
      checkout: noDraft,
      products: noProducts,
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
