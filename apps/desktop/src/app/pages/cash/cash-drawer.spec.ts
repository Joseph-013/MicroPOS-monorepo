import { TestBed } from '@angular/core/testing';
import type { CashDrawerState, CashMovementInput, CashResult, CashSessionRecord, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { CashDrawerPage } from './cash-drawer';

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const CLOSED: CashDrawerState = { session: null, movements: [], lastClosed: null };
const OPEN: CashDrawerState = { session: { id: 's1', openedAt: Date.UTC(2026, 5, 15, 0, 0), openedBy: 'Casey', openingFloat: 10_000, note: null }, movements: [], lastClosed: null };

function setup(initial: CashDrawerState, over: Partial<DesktopApi['cash']> = {}) {
  let state = initial;
  const calls = { open: [] as unknown[], movements: [] as CashMovementInput[], close: [] as unknown[] };
  const api = {
    cash: {
      state: () => Promise.resolve(state),
      open: (input: { openingFloat: number }) => {
        calls.open.push(input);
        state = { ...OPEN, session: { ...OPEN.session!, openingFloat: input.openingFloat } };
        return Promise.resolve({ ok: true, value: state } as CashResult<CashDrawerState>);
      },
      addMovement: (input: CashMovementInput) => {
        if (!input.reason.trim()) return Promise.resolve({ ok: false, field: 'reason', error: 'Say what it is for' } as CashResult<CashDrawerState>);
        calls.movements.push(input);
        state = { ...state, movements: [...state.movements, { id: `m${calls.movements.length}`, type: input.type, amount: input.amount, reason: input.reason, employeeName: 'Casey', at: 1 }] };
        return Promise.resolve({ ok: true, value: state } as CashResult<CashDrawerState>);
      },
      close: (input: { countedCash: number; note: string | null }) => {
        calls.close.push(input);
        const closed: CashSessionRecord = { id: 's1', openedAt: 1, openedBy: 'Casey', openingFloat: 10_000, closedAt: 2, closedBy: 'Casey', countedCash: input.countedCash, expectedCash: 17_000, variance: input.countedCash - 17_000, note: input.note };
        state = { session: null, movements: [], lastClosed: closed };
        return Promise.resolve({ ok: true, value: closed } as CashResult<CashSessionRecord>);
      },
      ...over,
    },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return calls;
}

async function render() {
  localStorage.clear();
  const fixture = TestBed.createComponent(CashDrawerPage);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const type = async (selector: string, value: string): Promise<void> => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const button = (label: string): HTMLButtonElement | undefined => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const submit = async (): Promise<void> => {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
  };
  return { fixture, el, type, button, submit };
}

describe('CashDrawerPage', () => {
  it('opens the drawer with the counted float', async () => {
    const calls = setup(CLOSED);
    const { el, type, submit } = await render();
    expect(el.textContent).toContain('Closed');
    await type('#cd-float', '100');
    await submit();
    expect(calls.open).toEqual([{ openingFloat: 10_000 }]);
    expect(el.textContent).toContain('Open');
    expect(el.textContent).toContain('Opening float');
    expect(TestBed.inject(BannerService).current()?.text).toBe('Drawer opened');
  });

  it('asks for a count that is money, and shows what the main process refuses', async () => {
    const calls = setup(CLOSED, { open: () => Promise.resolve({ ok: false, field: null, error: 'The drawer is already open' }) });
    const { el, type, submit } = await render();
    await type('#cd-float', 'abc');
    await submit();
    expect(el.textContent).toContain('Enter the cash counted');
    expect(calls.open).toEqual([]);
    await type('#cd-float', '50');
    await submit();
    expect(el.textContent).toContain('The drawer is already open');
  });

  it('records cash in and out with a reason, listing them with their sign', async () => {
    const calls = setup(OPEN);
    const { el, type, button, submit } = await render();
    button('Cash in')!.click();
    await wait();
    await type('#cd-amount', '10');
    await type('#cd-reason', 'Float top-up');
    await submit();
    button('Cash out')!.click();
    await wait();
    await type('#cd-amount', '5');
    await submit();
    expect(el.textContent).toContain('Say what it is for');
    await type('#cd-reason', 'Safe drop');
    await submit();
    expect(calls.movements).toEqual([{ type: 'in', amount: 1000, reason: 'Float top-up' }, { type: 'out', amount: 500, reason: 'Safe drop' }]);
    const list = el.querySelector('[aria-label="Cash in and out"]')!.textContent!.replace(/\s+/g, ' ');
    expect(list).toContain('Float top-up');
    expect(list).toContain('+₱10.00');
    expect(list).toContain('-₱5.00');
  });

  it('counts blind: nothing says what the drawer should hold until it is closed, and then it says how the count compared', async () => {
    const calls = setup(OPEN);
    const { el, type, button, submit } = await render();
    expect(el.textContent).not.toMatch(/expected/i);
    button('Close drawer')!.click();
    await wait();
    expect(el.textContent).not.toMatch(/expected/i);
    await type('#cd-count', '169');
    await type('#cd-note', 'A coin went missing');
    await submit();
    expect(calls.close).toEqual([{ countedCash: 16_900, note: 'A coin went missing' }]);
    const last = el.querySelector('[data-last-count]')!.textContent!.replace(/\s+/g, ' ');
    expect(last).toContain('Counted₱169.00');
    expect(last).toContain('Expected₱170.00');
    expect(last).toContain('Short₱1.00');
    expect(last).toContain('A coin went missing');
    expect(el.textContent).toContain('Closed');
  });

  it('says Matches for a count that is right', async () => {
    setup(OPEN);
    const { el, type, button, submit } = await render();
    button('Close drawer')!.click();
    await wait();
    await type('#cd-count', '170');
    await submit();
    expect(el.querySelector('[data-last-count]')!.textContent).toContain('Matches');
  });

  it('can be cancelled without saving anything', async () => {
    const calls = setup(OPEN);
    const { el, button } = await render();
    button('Close drawer')!.click();
    await wait();
    button('Cancel')!.click();
    await wait();
    expect(el.querySelector('#cd-count')).toBeNull();
    expect(calls.close).toEqual([]);
  });
});
