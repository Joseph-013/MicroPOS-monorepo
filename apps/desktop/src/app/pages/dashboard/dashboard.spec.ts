import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DashboardData, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { DashboardPage } from './dashboard';

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  generatedAt: Date.UTC(2026, 5, 15),
  today: { count: 3, net: 12_000 },
  yesterday: { count: 2, net: 10_000 },
  last7: { count: 10, net: 50_000 },
  last30: { count: 40, net: 200_000 },
  daily: Array.from({ length: 14 }, (_, i) => ({ day: `2026-06-${String(2 + i).padStart(2, '0')}`, net: i === 13 ? 12_000 : i === 12 ? 10_000 : 0, count: 1 })),
  byMethod: [{ method: 'cash', amount: 30_000 }, { method: 'ewallet', amount: 20_000 }],
  topItems: [{ name: 'Feast', unit: 'each', quantityMilli: 4000, total: 24_000 }, { name: 'Cheese', unit: 'kg', quantityMilli: 1500, total: 1500 }],
  customersOwing: { total: 12_000, count: 2, top: [{ id: 'c1', name: 'Bo', balance: 8000 }, { id: 'c2', name: 'Ana', balance: 4000 }] },
  suppliersOwed: { total: 30_000, orders: 2, overdueOrders: 1, overdue: 10_000 },
  inventory: { trackedProducts: 5, outOfStockCount: 1, outOfStockProducts: [{ id: 'p1', name: 'Bread' }], stockValueCost: 100_000, stockValueRetail: 150_000, expired: { batches: 1, valueCost: 500 }, expiringSoon: { batches: 2, valueCost: 900 }, wasteLast30Days: { entries: 3, valueCost: 700 }, attention: [], recentMovements: [] },
  ...over,
});

async function render(result: DashboardData | Error) {
  const api = { dashboard: { get: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)) } } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DESKTOP_API, useValue: api }] });
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
const text = (el: HTMLElement): string => el.textContent!.replace(/\s+/g, ' ');

describe('DashboardPage', () => {
  it('shows sales against yesterday, the chart, payment methods, best sellers, what is owed and the stock figures', async () => {
    const el = await render(data());
    const t = text(el);
    expect(el.querySelector('[data-today]')!.textContent!.trim()).toBe('₱120.00');
    expect(t).toContain('3 sales · +20% on yesterday');
    expect(t).toContain('Last 7 days₱500.0010 sales · ₱50.00 each');
    const bars = [...el.querySelectorAll<HTMLElement>('[data-bar]')];
    expect(bars).toHaveLength(14);
    expect(bars.at(-1)!.style.height).toBe('100%');
    expect(bars[0]!.style.height).toBe('0%');
    expect(t).toContain('Cash₱300.00');
    expect(t).toContain('E-wallet₱200.00');
    expect(t).toContain('Feast4₱240.00');
    expect(t).toContain('Cheese1.5 kg');
    expect(el.querySelector('[data-owed]')!.textContent!.trim()).toBe('₱120.00');
    expect(t).toContain('from 2 customers');
    expect(t).toContain('₱100.00 overdue on 1 order');
    expect(t).toContain('Stock value₱1,000.00');
    expect(t).toContain('Bread');
  });

  it('leaves out the comparison when yesterday had no sales, and does not divide by zero', async () => {
    const el = await render(data({ yesterday: { count: 0, net: 0 }, last7: { count: 0, net: 0 }, last30: { count: 0, net: 0 }, daily: data().daily.map((d) => ({ ...d, net: 0 })) }));
    const t = text(el);
    expect(t).toContain('3 sales');
    expect(t).not.toContain('on yesterday');
    expect(t).not.toContain('each');
    expect([...el.querySelectorAll<HTMLElement>('[data-bar]')].every((b) => b.style.height === '0%')).toBe(true);
  });

  it('says when it cannot be loaded', async () => {
    const el = await render(new Error('boom'));
    expect(text(el)).toContain('The dashboard could not be loaded');
  });
});
