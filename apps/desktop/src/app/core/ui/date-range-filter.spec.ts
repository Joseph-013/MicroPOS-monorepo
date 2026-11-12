import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateRangeFilter } from './date-range-filter';

@Component({
  imports: [DateRangeFilter],
  template: `<app-date-range-filter label="Created" [future]="future" [(from)]="from" [(to)]="to" />`,
})
class Host {
  future = false;
  readonly from = signal('');
  readonly to = signal('');
}

describe('DateRangeFilter', () => {
  const setup = async (future = false) => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.future = future;
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = (): HTMLElement => el.querySelector('button[aria-label="Created date range"]')!;
    const open = async (): Promise<void> => {
      trigger().click();
      await fixture.whenStable();
    };
    const panel = (): HTMLElement | null => document.querySelector('[role="dialog"][aria-label="Created dates"]');
    return { fixture, host: fixture.componentInstance, el, trigger, open, panel };
  };
  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = '')));

  it('is one compact button until it is opened', async () => {
    const { trigger, panel } = await setup();
    expect(trigger().textContent).toContain('Any date');
    expect(panel()).toBeNull();
  });

  it('opens a panel with From, To and presets, and closes with Done', async () => {
    const { open, panel, fixture } = await setup();
    await open();
    expect(panel()!.querySelector('input[aria-label="Created from"]')).not.toBeNull();
    expect(panel()!.textContent).toContain('Last 7 days');
    ([...panel()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Done') as HTMLElement).click();
    await fixture.whenStable();
    expect(panel()).toBeNull();
  });

  it('a first date is a single day, and the summary says so', async () => {
    const { open, panel, host, trigger, fixture } = await setup();
    await open();
    const from = panel()!.querySelector('input[aria-label="Created from"]') as HTMLInputElement;
    from.value = '2026-03-09';
    from.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(host.from()).toBe('2026-03-09');
    expect(host.to()).toBe('2026-03-09');
    expect(trigger().textContent).toContain('Mar 9, 2026');
  });

  it('summarises a range, an open start and an open end', async () => {
    const { host, trigger, fixture } = await setup();
    host.from.set('2026-03-03');
    host.to.set('2026-03-09');
    await fixture.whenStable();
    expect(trigger().textContent).toMatch(/Mar 3 – Mar 9, 2026/);
    host.to.set('');
    await fixture.whenStable();
    expect(trigger().textContent).toContain('From Mar 3, 2026');
    host.from.set('');
    host.to.set('2026-03-09');
    await fixture.whenStable();
    expect(trigger().textContent).toContain('Until Mar 9, 2026');
  });

  it('presets look back by default and ahead for expiry dates', async () => {
    const back = await setup(false);
    await back.open();
    ([...back.panel()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Last 7 days') as HTMLElement).click();
    await back.fixture.whenStable();
    expect(new Date(`${back.host.to()}T12:00:00`).getTime()).toBeGreaterThan(new Date(`${back.host.from()}T12:00:00`).getTime());
    const today = new Date();
    expect(back.host.to()).toBe(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  });

  it('the circled x clears both dates', async () => {
    const { host, el, fixture } = await setup();
    host.from.set('2026-03-03');
    host.to.set('2026-03-09');
    await fixture.whenStable();
    (el.querySelector('button[aria-label="Clear created dates"]') as HTMLElement).click();
    await fixture.whenStable();
    expect([host.from(), host.to()]).toEqual(['', '']);
  });
});
