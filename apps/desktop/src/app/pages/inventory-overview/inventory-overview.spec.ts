import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type BatchRecord, DESKTOP_API_VERSION, type DesktopApi, type InventoryOverview } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { InventoryOverviewPage } from './inventory-overview';

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
  expiresAt: Date.now() + DAY,
  unitCost: 250,
  unitPrice: 429,
  receivedMilli: 10_000,
  onHandMilli: 6_000,
  ...over,
});

const OVERVIEW: InventoryOverview = {
  trackedProducts: 12,
  outOfStockCount: 3,
  outOfStockProducts: [{ id: 'a', name: 'Bagels' }, { id: 'b', name: 'Butter' }],
  stockValueCost: 123_450,
  stockValueRetail: 200_000,
  expired: { batches: 2, valueCost: 5_000 },
  expiringSoon: { batches: 4, valueCost: 9_000 },
  wasteLast30Days: { entries: 1, valueCost: 700 },
  attention: [batch('1', 'Milk', { expiresAt: Date.now() - DAY }), batch('2', 'Yogurt')],
  recentMovements: [
    { id: 'm1', at: Date.now(), type: 'receive', productName: 'Eggs', unit: 'each', batchNumber: 'L9', quantityMilli: 12_000, note: null },
    { id: 'm2', at: Date.now(), type: 'waste', productName: 'Beef', unit: 'kg', batchNumber: 'L3', quantityMilli: -500, note: null },
  ],
};

describe('InventoryOverviewPage', () => {
  let fixture: ComponentFixture<InventoryOverviewPage>;
  let el: HTMLElement;

  async function open(overview: Promise<InventoryOverview>): Promise<void> {
    const api = { platform: 'linux', version: () => Promise.resolve(DESKTOP_API_VERSION), inventory: { overview: () => overview } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DESKTOP_API, useValue: api }] });
    fixture = TestBed.createComponent(InventoryOverviewPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }

  it('shows the key numbers', async () => {
    await open(Promise.resolve(OVERVIEW));
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('₱1,234.50'); // stock value at cost
    expect(text).toContain('₱2,000.00 at retail');
    expect(text).toContain('₱50.00 at cost'); // expired
    expect(text).toContain('₱90.00 at cost'); // expiring soon
    expect(text).toContain('of 12 tracked products');
    expect(text).toContain('₱7.00'); // written off
  });

  it('lists what needs attention, what is out of stock and what moved', async () => {
    await open(Promise.resolve(OVERVIEW));
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Milk');
    expect(text).toContain('Expired');
    expect(text).toContain('Yogurt');
    expect(text).toContain('Expiring soon');
    expect(text).toContain('Bagels');
    expect(text).toContain('and 1 more'); // 3 out of stock, 2 listed
    expect(text).toContain('Received');
    expect(text).toContain('+12');
    expect(text).toContain('-0.5 kg');
  });

  it('links the alert tiles to the matching filtered list', async () => {
    await open(Promise.resolve(OVERVIEW));
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/items/inventory?status=expired');
    expect(hrefs).toContain('/items/inventory?status=soon');
    expect(hrefs).toContain('/items/products?stock=out');
  });

  it('says so when there is nothing to flag', async () => {
    await open(
      Promise.resolve({ ...OVERVIEW, outOfStockCount: 0, outOfStockProducts: [], attention: [], recentMovements: [], expired: { batches: 0, valueCost: 0 } }),
    );
    expect(el.textContent).toContain('Nothing is expired or about to expire');
    expect(el.textContent).toContain('Every tracked product has stock');
    expect(el.textContent).toContain('No stock has moved yet');
  });

  it('reports a failed load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await open(Promise.reject(new Error('boom')));
    expect(el.textContent).toContain('The overview could not be loaded');
  });
});
