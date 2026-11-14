import { TestBed } from '@angular/core/testing';
import { dayOf, type DailyReport, type DesktopApi, type PrintResult } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { ReportsPage } from './reports';

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const flow = { sales: 6000, customerPayments: 2000, supplierPayments: 1500, movementsIn: 1000, movementsOut: 500 };
const report = (day: string, over: Partial<DailyReport> = {}): DailyReport => ({
  day,
  sales: { count: 4, gross: 18_000, discounts: 500, net: 17_500 },
  voids: { count: 1, total: 2000 },
  refunds: { count: 1, total: -4000 },
  netAfterRefunds: 13_500,
  byMethod: [{ method: 'cash', amount: 6000 }, { method: 'card', amount: 3000 }],
  credit: { given: 5000, interest: 0, paymentsReceived: [{ method: 'cash', amount: 2000 }] },
  cash: flow,
  items: [{ name: 'Feast', unit: 'each', quantityMilli: 1000, total: 6000 }, { name: 'Cheese', unit: 'kg', quantityMilli: 1500, total: 1500 }],
  sessions: [{ id: 's1', openedAt: Date.UTC(2026, 5, 15, 0), openedBy: 'Casey', openingFloat: 10_000, closedAt: Date.UTC(2026, 5, 15, 10), closedBy: 'Casey', countedCash: 16_900, expectedCash: 17_000, variance: -100, note: 'A coin went missing' }],
  ...over,
});

function setup(printResult: PrintResult = { ok: true }) {
  const asked: string[] = [];
  const printed: string[] = [];
  const api = {
    reports: { daily: (day: string) => (asked.push(day), Promise.resolve(day === '2026-01-01' ? null : report(day))) },
    printer: { printDailyReport: (day: string) => (printed.push(day), Promise.resolve(printResult)) },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return { asked, printed };
}
async function render() {
  const fixture = TestBed.createComponent(ReportsPage);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
const text = (el: HTMLElement): string => el.textContent!.replace(/\s+/g, ' ');

describe('ReportsPage', () => {
  it('shows today\'s report to begin with: sales, what was taken by each method, cash, drawer counts and items', async () => {
    const { asked } = setup();
    const { el } = await render();
    expect(asked).toEqual([dayOf(Date.now())]);
    const t = text(el);
    expect(t).toContain('4 sales');
    expect(t).toContain('1 refund');
    expect(t).toContain('1 voided');
    expect(el.querySelector('[data-net]')!.textContent!.trim()).toBe('₱135.00');
    expect(el.textContent).toContain('Taken byCash₱60.00Card₱30.00');
    expect(el.textContent).toContain('Put on account₱50.00');
    expect(el.textContent).toContain('Paid to suppliers-₱15.00');
    expect(t).toContain('Float ₱100.00 · expected ₱170.00 · counted ₱169.00 · A coin went missing');
    expect(el.querySelector('[data-variance]')!.textContent!.trim()).toBe('Short ₱1.00');
    const items = [...el.querySelectorAll('[aria-label="Items sold"] li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(items).toEqual(['Feast1₱60.00', 'Cheese1.5 kg₱15.00']);
  });

  it('shows another day when the date is changed, and keeps the day shown when it is cleared', async () => {
    const { asked } = setup();
    const { fixture, el } = await render();
    const input = el.querySelector('#rp-day') as HTMLInputElement;
    input.value = '2026-06-14';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    await wait();
    expect(asked.at(-1)).toBe('2026-06-14');
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    expect(asked).toHaveLength(2); // nothing asked for an empty day
  });

  it('says so when the report cannot be loaded', async () => {
    setup();
    const { fixture, el } = await render();
    const input = el.querySelector('#rp-day') as HTMLInputElement;
    input.value = '2026-01-01';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
    expect(text(el)).toContain('The report could not be loaded');
  });

  it('prints the day shown, and says how it went', async () => {
    const ok = setup();
    const { fixture, el } = await render();
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Print') as HTMLButtonElement).click();
    await fixture.whenStable();
    await wait();
    expect(ok.printed).toEqual([dayOf(Date.now())]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Report sent to the printer');
    const bad = setup({ ok: false, code: 'not-configured', error: 'No printer is set up' });
    const second = await render();
    ([...second.el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Print') as HTMLButtonElement).click();
    await second.fixture.whenStable();
    await wait();
    expect(bad.printed).toHaveLength(1);
    expect(TestBed.inject(BannerService).current()).toMatchObject({ severity: 'error', text: 'No printer is set up' });
    void fixture;
  });
});
