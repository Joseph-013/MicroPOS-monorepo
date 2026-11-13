import { TestBed } from '@angular/core/testing';
import { type CustomerDisplayState, type DesktopApi, IDLE_DISPLAY_STATE } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { AppSettings } from '../../core/settings/app-settings.service';
import { CustomerDisplayPage, HIGHLIGHT_MS, PAID_SCREEN_MS } from './customer-display';

const line = (name: string, quantityMilli: number, unitPrice: number, unit = 'each') => ({ name, unit, quantityMilli, unitPrice, total: Math.round((quantityMilli * unitPrice) / 1000) });
const shopping = (lines: ReturnType<typeof line>[]): CustomerDisplayState => ({ phase: 'shopping', lines, total: lines.reduce((s, l) => s + l.total, 0), receipt: null });

/** A fake main process: holds the latest state and lets the test push new ones to the page. */
function setup(initial: CustomerDisplayState = IDLE_DISPLAY_STATE) {
  let push: (state: CustomerDisplayState) => void = () => undefined;
  const api = {
    display: {
      getState: () => Promise.resolve(initial),
      onState: (listener: (state: CustomerDisplayState) => void) => {
        push = listener;
        return () => undefined;
      },
    },
  } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  const fixture = TestBed.createComponent(CustomerDisplayPage);
  const el = fixture.nativeElement as HTMLElement;
  const send = async (state: CustomerDisplayState): Promise<void> => {
    push(state);
    await fixture.whenStable();
  };
  return { fixture, el, send };
}

describe('CustomerDisplayPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  it('welcomes the customer while nothing has been scanned', async () => {
    const { fixture, el } = setup();
    await fixture.whenStable();
    expect(el.textContent).toContain('Welcome');
    expect(el.querySelector('ul')).toBeNull();
  });

  it('shows the items as they are scanned with quantity, price, line total and the running total', async () => {
    const { fixture, el, send } = setup();
    await fixture.whenStable();
    await send(shopping([line('Whole Milk (1 gal)', 2_000, 429), line('Bananas', 1_250, 6_000, 'kg')]));
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Whole Milk (1 gal)');
    expect(text).toContain('2 × ₱4.29');
    expect(text).toContain('₱8.58');
    expect(text).toContain('1.25 kg × ₱60.00');
    expect(text).toContain('Total₱83.58');
    expect(text).toContain('2 items');
    expect(el.querySelectorAll('li')).toHaveLength(2);
  });

  it('shows what is on screen when it opens in the middle of a sale', async () => {
    const { fixture, el } = setup(shopping([line('Eggs', 1_000, 1_500)]));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.textContent).toContain('Eggs');
    expect(el.textContent).toContain('1 item');
  });

  it('highlights the line that was just added or changed, for a moment', async () => {
    const { fixture, el, send } = setup();
    await fixture.whenStable();
    await send(shopping([line('Eggs', 1_000, 1_500)]));
    await send(shopping([line('Eggs', 1_000, 1_500), line('Milk', 1_000, 4_000)]));
    const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('li')];
    expect(rows().map((r) => r.classList.contains('row-target'))).toEqual([false, true]);

    await send(shopping([line('Eggs', 2_000, 1_500), line('Milk', 1_000, 4_000)])); // the first one changed
    expect(rows().map((r) => r.classList.contains('row-target'))).toEqual([true, false]);

    vi.advanceTimersByTime(HIGHLIGHT_MS + 10);
    await fixture.whenStable();
    expect(rows().some((r) => r.classList.contains('row-target'))).toBe(false);
  });

  it('thanks the customer after the sale, with change and what went on account, then welcomes the next', async () => {
    const { fixture, el, send } = setup();
    await fixture.whenStable();
    await send({ phase: 'paid', lines: [line('Eggs', 1_000, 1_500)], total: 1_500, receipt: { orderNumber: 'SO-1001', total: 1_500, change: 500, onAccount: 300 } });
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Thank you!');
    expect(text).toContain('₱15.00');
    expect(text).toContain('Change ₱5.00');
    expect(text).toContain('₱3.00 on your account');

    vi.advanceTimersByTime(PAID_SCREEN_MS + 10);
    await fixture.whenStable();
    expect(el.textContent).toContain('Welcome');
    expect(el.textContent).not.toContain('Thank you!');

    await send(shopping([line('Milk', 1_000, 4_000)])); // the next customer's first item
    expect(el.textContent).toContain('Milk');
  });

  it('leaves out change and account lines that do not apply', async () => {
    const { fixture, el, send } = setup();
    await fixture.whenStable();
    await send({ phase: 'paid', lines: [], total: 1_500, receipt: { orderNumber: 'SO-1', total: 1_500, change: 0, onAccount: 0 } });
    expect(el.textContent).not.toContain('Change');
    expect(el.textContent).not.toContain('account');
  });

  it('is drawn at the UI scale from Settings, and follows a change, by scaling the root size everything is sized from', async () => {
    const { fixture } = setup();
    await fixture.whenStable();
    expect(document.documentElement.style.fontSize).toBe('100%');
    TestBed.inject(AppSettings).customerDisplayScale.set(150);
    await fixture.whenStable();
    expect(document.documentElement.style.fontSize).toBe('150%');
    fixture.destroy();
    expect(document.documentElement.style.fontSize).toBe(''); // the page does not leave its scale behind
  });
});
