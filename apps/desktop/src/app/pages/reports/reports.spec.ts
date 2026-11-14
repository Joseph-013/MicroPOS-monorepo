import { TestBed } from '@angular/core/testing';
import { dayOf, type DesktopApi, type ExportResult, type SalesReport } from '@micropos/core';
import { BannerService } from '../../core/banner';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { ReportsPage } from './reports';

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const report = (from: string, to: string): SalesReport => ({
  from,
  to,
  sales: { count: 4, gross: 18_000, discounts: 500, net: 17_500 },
  voids: { count: 1, total: 2000 },
  refunds: { count: 1, total: -4000 },
  netAfterRefunds: 13_500,
  byMethod: [{ method: 'cash', amount: 6000 }, { method: 'card', amount: 3000 }],
  credit: { given: 5000, interest: 0, paymentsReceived: [{ method: 'cash', amount: 2000 }] },
  items: [{ name: 'Feast', unit: 'each', quantityMilli: 1000, total: 6000 }, { name: 'Cheese', unit: 'kg', quantityMilli: 1500, total: 1500 }],
});

function setup(fail = false, exported: ExportResult = { ok: true, savedTo: '/home/u/Downloads/summary.csv' }) {
  const asked: string[][] = [];
  const exports: string[][] = [];
  const api = {
    reports: {
      sales: (from: string, to: string) => (asked.push([from, to]), Promise.resolve(fail ? null : report(from, to))),
      export: (kind: string, from: string, to: string, format: string) => (exports.push([kind, from, to, format]), Promise.resolve(exported)),
    },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return { asked, exports };
}
async function render() {
  const fixture = TestBed.createComponent(ReportsPage);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
const text = (el: HTMLElement): string => el.textContent!.replace(/\s+/g, ' ').trim();
async function change(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, id: string, value: string): Promise<void> {
  const input = el.querySelector(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
}

describe('ReportsPage', () => {
  it("shows today's summary to begin with", async () => {
    const { asked } = setup();
    const { el } = await render();
    const today = dayOf(Date.now());
    expect(asked).toEqual([[today, today]]);
    const t = text(el);
    expect(t).toContain('4 sales');
    expect(t).toContain('1 refund');
    expect(t).toContain('1 voided');
    expect(t).toContain('Net sales₱135.00');
    expect(t).toContain('Taken byCash₱60.00Card₱30.00');
    expect(t).toContain('Put on account₱50.00');
    expect(t).toContain('ItemQuantityTotalFeast1₱60.00Cheese1.5 kg₱15.00');
  });

  it('asks for the range when a date changes, never lets it end before it starts, and keeps the day when cleared', async () => {
    const { asked } = setup();
    const { fixture, el } = await render();
    await change(fixture, el, '#rp-from', '2026-06-01');
    expect(asked.at(-1)).toEqual(['2026-06-01', dayOf(Date.now())]);
    await change(fixture, el, '#rp-to', '2026-05-20');
    expect(asked.at(-1)).toEqual(['2026-05-20', '2026-05-20']);
    const n = asked.length;
    await change(fixture, el, '#rp-to', '');
    expect(asked.length).toBe(n);
  });

  it('says when the report cannot be loaded', async () => {
    setup(true);
    const { el } = await render();
    expect(text(el)).toContain('The report could not be loaded');
  });

  it('saves or prints the report that is shown, and tells the person where it went', async () => {
    const { exports } = setup();
    const { fixture, el } = await render();
    const today = dayOf(Date.now());
    const buttons = [...el.querySelectorAll('[aria-label="Export"] button')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['CSV', 'PDF', 'Print']);
    buttons[0]!.click();
    await fixture.whenStable();
    await wait();
    expect(exports).toEqual([['summary', today, today, 'csv']]);
    expect(TestBed.inject(BannerService).current()?.text).toContain('/home/u/Downloads/summary.csv');
  });

  it('stays quiet when the save or print dialog is closed, and says when it fails', async () => {
    setup(false, { ok: false, canceled: true, error: 'Canceled' });
    let { fixture, el } = await render();
    (el.querySelector('[aria-label="Export"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await wait();
    expect(TestBed.inject(BannerService).current()).toBeNull();
    setup(false, { ok: false, error: 'Disk full' });
    ({ fixture, el } = await render());
    (el.querySelectorAll('[aria-label="Export"] button')[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    await wait();
    expect(TestBed.inject(BannerService).current()?.text).toBe('Disk full');
  });
});
