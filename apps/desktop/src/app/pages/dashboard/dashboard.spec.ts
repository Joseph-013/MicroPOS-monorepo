import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ChartBar, DashboardData, DashboardQuery, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { DashboardPage } from './dashboard';

// jsdom has no ResizeObserver (the select's overlay watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const day = (n: number): ChartBar => ({ from: `2026-06-${String(n).padStart(2, '0')}`, to: `2026-06-${String(n).padStart(2, '0')}`, net: n === 15 ? 12_000 : n === 14 ? 10_000 : 0, count: 1 });
const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  generatedAt: Date.UTC(2026, 5, 15),
  query: { from: '2026-06-09', to: '2026-06-15', compare: true },
  current: { count: 10, net: 50_000, discounts: 700, refunded: 4000, voided: 1 },
  previous: { from: '2026-06-02', to: '2026-06-08', count: 8, net: 40_000, discounts: 0, refunded: 0, voided: 0 },
  granularity: 'day',
  chart: [9, 10, 11, 12, 13, 14, 15].map(day),
  byMethod: [{ method: 'cash', amount: 30_000 }, { method: 'ewallet', amount: 20_000 }],
  topItems: [{ name: 'Feast', unit: 'each', quantityMilli: 4000, total: 24_000 }, { name: 'Cheese', unit: 'kg', quantityMilli: 1500, total: 1500 }],
  customersOwing: { total: 12_000, count: 2, top: [{ id: 'c1', name: 'Bo', balance: 8000 }, { id: 'c2', name: 'Ana', balance: 4000 }] },
  suppliersOwed: { total: 30_000, orders: 2, overdueOrders: 1, overdue: 10_000 },
  inventory: { trackedProducts: 5, outOfStockCount: 1, outOfStockProducts: [{ id: 'p1', name: 'Bread' }], stockValueCost: 100_000, stockValueRetail: 150_000, expired: { batches: 1, valueCost: 500 }, expiringSoon: { batches: 2, valueCost: 900 }, wasteLast30Days: { entries: 3, valueCost: 700 }, attention: [], recentMovements: [] },
  ...over,
});

async function render(result: DashboardData | Error | ((q: DashboardQuery) => DashboardData)) {
  const asked: DashboardQuery[] = [];
  const api = {
    dashboard: {
      get: (q: DashboardQuery) => (asked.push(q), result instanceof Error ? Promise.reject(result) : Promise.resolve(typeof result === 'function' ? result(q) : result)),
    },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DESKTOP_API, useValue: api }] });
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, asked };
}
const text = (el: HTMLElement): string => el.textContent!.replace(/\s+/g, ' ');

describe('DashboardPage', () => {
  it('shows the period, its figures against the period before, the chart, payment methods, best sellers, what is owed and the stock', async () => {
    const { el, asked } = await render(data());
    const t = text(el);
    expect(asked[0]!.compare).toBe(true); // comparing is on to begin with
    expect(el.querySelector('[data-net]')!.textContent!.trim()).toBe('₱500.00');
    expect(t).toContain('Net sales · Last 7 days'.replace('Net sales · ', 'Sales · '));
    expect(t).toContain('+25% on Jun 2, 2026 to Jun 8, 2026'); // 40,000 to 50,000
    expect(el.querySelector('[data-count]')!.textContent!.trim()).toBe('10');
    expect(t).toContain('+25% on Jun 2, 2026 to Jun 8, 2026');
    expect(el.querySelector('[data-average]')!.textContent!.trim()).toBe('₱50.00');
    expect(el.querySelector('[data-refunded]')!.textContent!.trim()).toBe('₱40.00');
    expect(t).toContain('1 voided · ₱7.00 discounts');
    const bars = [...el.querySelectorAll<HTMLElement>('[data-bar]')];
    expect(bars).toHaveLength(7);
    expect(bars.at(-1)!.style.height).toBe('100%');
    expect([...el.querySelectorAll('[data-bar-label]')].map((l) => l.textContent!.trim())).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']);
    expect([...el.querySelectorAll('[data-bar-value]')].map((v) => v.textContent!.trim()).slice(-2)).toEqual(['₱100', '₱120']);
    expect(t).toContain('Cash₱300.00');
    expect(t).toContain('Feast4₱240.00');
    expect(el.querySelector('[data-owed]')!.textContent!.trim()).toBe('₱120.00');
    expect(t).toContain('₱100.00 overdue on 1 order');
    expect(t).toContain('Stock value₱1,000.00');
  });

  it('each bar links to the sales orders of its day, or of its week or month', async () => {
    const { el } = await render(data());
    const links = [...el.querySelectorAll<HTMLAnchorElement>('a[role="listitem"]')];
    expect(links).toHaveLength(7);
    expect(links.at(-1)!.getAttribute('href')).toContain('date=2026-06-15');
    const weeks = data({ granularity: 'week', chart: [{ from: '2026-06-01', to: '2026-06-07', net: 5000, count: 2 }, { from: '2026-06-08', to: '2026-06-14', net: 9000, count: 3 }] });
    const w = await render(weeks);
    const hrefs = [...w.el.querySelectorAll<HTMLAnchorElement>('a[role="listitem"]')].map((a) => a.getAttribute('href')!);
    expect(hrefs[0]).toContain('from=2026-06-01');
    expect(hrefs[0]).toContain('to=2026-06-07');
    expect([...w.el.querySelectorAll('[data-bar-label]')].map((l) => l.textContent!.trim())).toEqual(['Jun 1', 'Jun 8']); // the start of each week
  });

  it('shows no amounts above many bars, and the day of the month under them', async () => {
    const days = Array.from({ length: 20 }, (_, i) => day(i + 1));
    const { el } = await render(data({ chart: days }));
    expect(el.querySelectorAll('[data-bar-value]')).toHaveLength(0);
    expect([...el.querySelectorAll('[data-bar-label]')].slice(0, 3).map((l) => l.textContent!.trim())).toEqual(['1', '2', '3']);
  });

  it('leaves the comparison out when it is off or the period before had no sales, and never divides by zero', async () => {
    const off = await render(data({ previous: null }));
    expect(text(off.el)).toContain('after refunds');
    expect(text(off.el)).not.toContain('+25%');
    const none = await render(data({ previous: { from: '2026-06-02', to: '2026-06-08', count: 0, net: 0, discounts: 0, refunded: 0, voided: 0 } }));
    expect(text(none.el)).toContain('No sales on Jun 2, 2026 to Jun 8, 2026');
    const empty = await render(data({ current: { count: 0, net: 0, discounts: 0, refunded: 0, voided: 0 }, chart: [day(1)] }));
    expect(empty.el.querySelector('[data-average]')!.textContent!.trim()).toBe('₱0.00');
  });

  it('asks for another period when one is chosen, and remembers the choice', async () => {
    const { fixture, el, asked } = await render((q) => data({ query: q }));
    const instance = fixture.componentInstance as unknown as { choosePeriod(p: string): void };
    instance.choosePeriod('lastMonth');
    await fixture.whenStable();
    await wait();
    expect(asked.at(-1)).toMatchObject({ compare: true });
    expect(asked.at(-1)!.from.endsWith('-01')).toBe(true);
    expect(JSON.parse(localStorage.getItem('micropos.dashboard')!).period).toBe('lastMonth');
    instance.choosePeriod('custom');
    await fixture.whenStable();
    await wait();
    expect(el.querySelector('#dash-from')).not.toBeNull(); // a custom period shows its two dates
  });

  it('says when it cannot be loaded', async () => {
    const { el } = await render(new Error('boom'));
    expect(text(el)).toContain('The dashboard could not be loaded');
  });
});
