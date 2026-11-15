import { TestBed } from '@angular/core/testing';
import type { CustomerDisplayMode, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../core/api/desktop-api';
import { AuthService } from '../core/auth/auth.service';
import { fakeAuthApi, sessionUser } from '../core/auth/testing';
import { AppSettings } from '../core/settings/app-settings.service';
import { SettingsPage } from './settings';

// jsdom has no ResizeObserver or scrollIntoView (the select's overlay uses both).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
Element.prototype.scrollIntoView ??= () => undefined;

/** The switch inside the labelled row. */
const switchFor = (root: HTMLElement, label: string): HTMLButtonElement =>
  [...root.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('hlm-switch button') as HTMLButtonElement;

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('shows the on-screen keyboard switch, off by default, and turning it on is remembered', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('On-screen keyboard');
    const toggle = el.querySelector('hlm-switch button, hlm-switch [role="switch"]') as HTMLElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    toggle.click();
    await fixture.whenStable();
    expect(TestBed.inject(AppSettings).onScreenKeyboard()).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('micropos.onScreenKeyboard')).toBe('true');
  });

  it('starts from the saved value on the next launch', () => {
    localStorage.setItem('micropos.onScreenKeyboard', 'true');
    localStorage.setItem('micropos.schemaVersion', '3');
    expect(TestBed.inject(AppSettings).onScreenKeyboard()).toBe(true);
  });

  it('has a numpad option that is only available while the on-screen keyboard is on', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Numpad beside keyboard');
    const [keyboard, numpad] = [...el.querySelectorAll('hlm-switch button')] as HTMLButtonElement[];
    expect(numpad.disabled).toBe(true);

    keyboard.click();
    await fixture.whenStable();
    expect(numpad.disabled).toBe(false);
    numpad.click();
    await fixture.whenStable();
    expect(TestBed.inject(AppSettings).showNumpad()).toBe(true);
    expect(localStorage.getItem('micropos.showNumpad')).toBe('true');
  });

  it('has a Customer display option to open it on start, off by default and remembered', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Customer Display');
    const toggle = switchFor(el, 'Open on start');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(TestBed.inject(AppSettings).customerDisplayOnStart()).toBe(true);
    expect(localStorage.getItem('micropos.customerDisplayOnStart')).toBe('true');
  });

  it('gives existing installs an explicit default through a storage migration', () => {
    localStorage.setItem('micropos.schemaVersion', '3');
    expect(TestBed.inject(AppSettings).customerDisplayOnStart()).toBe(false);
    expect(localStorage.getItem('micropos.customerDisplayOnStart')).toBe('false');
  });

  it('capitalizes its section titles', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const titles = [...(fixture.nativeElement as HTMLElement).querySelectorAll('hlm-accordion-trigger')].map((h) => h.textContent!.trim());
    expect(titles).toEqual(['Account', 'Input', 'Customer Display', 'Credit Interest', 'Credit Alerts', 'Receipt Printer', 'Auto sign-out', 'Window', 'Backup', 'Logs', 'Debug']);
  });

  describe('Credit Interest', () => {
    async function open(permissions: Parameters<typeof sessionUser>[0]) {
      const auth = fakeAuthApi({ status: sessionUser(permissions) });
      const saved: unknown[] = [];
      const api = {
        ...auth.api,
        display: { isOpen: () => Promise.resolve(false), onVisibility: () => () => undefined },
        customers: { interestDefaults: () => Promise.resolve({ orderRateBp: 500, totalRateBp: 250 }), saveInterestDefaults: (v: unknown) => (saved.push(v), Promise.resolve(true)) },
      } as unknown as DesktopApi;
      TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
      await TestBed.inject(AuthService).whenReady();
      const fixture = TestBed.createComponent(SettingsPage);
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 20));
      await fixture.whenStable();
      return { fixture, el: fixture.nativeElement as HTMLElement, saved };
    }

    it('shows the saved default rates and saves changed ones', async () => {
      const { fixture, el, saved } = await open(['customers.manage']);
      const order = el.querySelector('#interest-order') as HTMLInputElement;
      const total = el.querySelector('#interest-total') as HTMLInputElement;
      expect([order.value, total.value]).toEqual(['5', '2.5']);
      total.value = '1.5';
      total.dispatchEvent(new Event('input', { bubbles: true }));
      (el.querySelector('app-credit-interest-settings form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      expect(saved).toEqual([{ orderRateBp: 500, totalRateBp: 150 }]);
    });

    it('refuses a rate that is not between 0.01% and 100%', async () => {
      const { fixture, el, saved } = await open(['customers.manage']);
      const order = el.querySelector('#interest-order') as HTMLInputElement;
      order.value = '150';
      order.dispatchEvent(new Event('input', { bubbles: true }));
      (el.querySelector('app-credit-interest-settings form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      expect(saved).toEqual([]);
      expect(el.textContent).toContain('Enter a rate between 0.01% and 100%');
    });

    it('is only for people who may change customers', async () => {
      const { el } = await open(['checkout.sell', 'customers.view']);
      expect(el.querySelector('app-credit-interest-settings')).toBeNull();
    });
  });

  describe('Credit Alerts', () => {
    async function open(initial: { amount: number | null; days: number | null }) {
      const saved: unknown[] = [];
      const api = {
        ...fakeAuthApi({ status: sessionUser(['customers.manage']) }).api,
        display: { isOpen: () => Promise.resolve(false), onVisibility: () => () => undefined },
        customers: {
          interestDefaults: () => Promise.resolve({ orderRateBp: 300, totalRateBp: 300 }),
          alertSettings: () => Promise.resolve(initial),
          alertCount: () => Promise.resolve(0),
          saveAlertSettings: (v: unknown) => (saved.push(v), Promise.resolve(true)),
        },
      } as unknown as DesktopApi;
      TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
      await TestBed.inject(AuthService).whenReady();
      const fixture = TestBed.createComponent(SettingsPage);
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 20));
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      const set = (id: string, value: string): void => {
        const input = el.querySelector(id) as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const submit = async (): Promise<void> => {
        (el.querySelector('app-credit-alert-settings form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        await fixture.whenStable();
      };
      return { el, saved, set, submit };
    }

    it('shows the saved limits and saves changed ones', async () => {
      const { el, saved, set, submit } = await open({ amount: 500_000, days: 30 });
      expect([(el.querySelector('#alert-amount') as HTMLInputElement).value, (el.querySelector('#alert-days') as HTMLInputElement).value]).toEqual(['5000.00', '30']);
      set('#alert-amount', '2,500');
      set('#alert-days', '14');
      await submit();
      expect(saved).toEqual([{ amount: 250_000, days: 14 }]);
    });

    it('turns a limit off when left blank, and refuses what is not a limit', async () => {
      const { el, saved, set, submit } = await open({ amount: 500_000, days: 30 });
      set('#alert-amount', '');
      await submit();
      expect(saved).toEqual([{ amount: null, days: 30 }]);
      set('#alert-days', '0');
      await submit();
      expect(saved).toHaveLength(1);
      expect(el.textContent).toContain('Enter an amount and a number of days');
    });
  });

  describe('Window', () => {
    async function open(permissions: Parameters<typeof sessionUser>[0], initial = false) {
      const saved: boolean[] = [];
      const quits: number[] = [];
      const api = {
        ...fakeAuthApi({ status: sessionUser(permissions) }).api,
        display: { isOpen: () => Promise.resolve(false), onVisibility: () => () => undefined },
        shell: { getWindowMode: () => Promise.resolve('windowed' as const), setWindowMode: () => Promise.resolve(true), getCloseToTray: () => Promise.resolve(initial), setCloseToTray: (v: boolean) => (saved.push(v), Promise.resolve(true)), quit: () => (quits.push(1), Promise.resolve()), getLogsFolder: () => Promise.resolve('/logs'), openLogsFolder: () => Promise.resolve(true) },
        debug: { get: () => Promise.resolve({ saveImages: false, folder: '/downloads/MicroPOS receipts' }) },
        printer: { settings: () => Promise.resolve({ printer: { connection: null, paperWidthMm: 58 }, shop: { name: '', address: '', footer: '' } }), getLogo: () => Promise.resolve(null), listUsb: () => Promise.resolve([]) },
      } as unknown as DesktopApi;
      TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
      await TestBed.inject(AuthService).whenReady();
      const fixture = TestBed.createComponent(SettingsPage);
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 20));
      await fixture.whenStable();
      return { fixture, el: fixture.nativeElement as HTMLElement, saved, quits };
    }

    it('quits for real only after the admin confirms', async () => {
      const { fixture, el, quits } = await open(['settings.manage'], true);
      const quitButton = Array.from(el.querySelectorAll('app-window-settings button')).find((b) => b.textContent?.trim() === 'Quit') as HTMLButtonElement;
      quitButton.click();
      await fixture.whenStable();
      expect(quits).toEqual([]); // only asked so far
      const dialogButtons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll('hlm-alert-dialog-content button'));
      expect(document.body.textContent).toContain('Quit MicroPOS?');
      dialogButtons().find((b) => b.textContent?.trim() === 'Cancel')!.click();
      await fixture.whenStable();
      expect(quits).toEqual([]);

      quitButton.click();
      await fixture.whenStable();
      dialogButtons().find((b) => b.textContent?.trim() === 'Quit')!.click();
      await fixture.whenStable();
      expect(quits).toEqual([1]);
    });

    it('lets an admin keep the app running in the tray when the window is closed', async () => {
      const { fixture, el, saved } = await open(['settings.manage'], true);
      const toggle = el.querySelector('app-window-settings hlm-switch button') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-checked')).toBe('true'); // shows what is saved
      toggle.click();
      await fixture.whenStable();
      expect(saved).toEqual([false]);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('is only for people who may change shop settings', async () => {
      const { el } = await open(['customers.manage', 'users.manage']);
      expect(el.querySelector('app-window-settings')).toBeNull();
    });
  });

  describe('accordion and search', () => {
    const open = async () => {
      const fixture = TestBed.createComponent(SettingsPage);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      const type = async (text: string): Promise<void> => {
        const input = el.querySelector('input[aria-label="Search settings"]') as HTMLInputElement;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await fixture.whenStable();
      };
      const sections = (): string[] => [...el.querySelectorAll('hlm-accordion-trigger')].map((t) => t.textContent!.trim());
      const shownRows = (): string[] => [...el.querySelectorAll<HTMLElement>('[appsetting]')].filter((r) => !r.hidden && r.closest('hlm-accordion-item')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
      const stateOf = (title: string): string | null => [...el.querySelectorAll('hlm-accordion-item')].find((i) => i.querySelector('hlm-accordion-trigger')?.textContent?.trim() === title)?.getAttribute('data-state') ?? null;
      return { fixture, el, type, sections, shownRows, stateOf };
    };

    it('is a centred column, with the Account section open and the others closed', async () => {
      const { el, stateOf } = await open();
      expect((el.firstElementChild as HTMLElement).className).toContain('mx-auto');
      expect(stateOf('Account')).toBe('open');
      expect(stateOf('Input')).toBe('closed');
      expect(stateOf('Customer Display')).toBe('closed');
    });

    it('opens and closes a section on its title, and remembers that while the page lives', async () => {
      const { fixture, el, stateOf } = await open();
      const trigger = (title: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('hlm-accordion-trigger button')].find((b) => b.textContent?.includes(title))!;
      trigger('Input').click();
      await fixture.whenStable();
      expect(stateOf('Input')).toBe('open');
      expect(stateOf('Account')).toBe('open'); // several can be open
      trigger('Account').click();
      await fixture.whenStable();
      expect(stateOf('Account')).toBe('closed');
    });

    it('finds a setting by its name or by a word that describes it, showing only what matches, with its section open', async () => {
      const { type, sections, shownRows, stateOf } = await open();
      await type('keyboard');
      expect(sections()).toEqual(['Input']);
      expect(shownRows()).toEqual(['On-screen keyboard', 'Numpad beside keyboard']);
      expect(stateOf('Input')).toBe('open');
      await type('dark'); // a keyword of Theme, which is not in its label
      expect(sections()).toEqual(['Account']);
      expect(shownRows()).toEqual([expect.stringContaining('Theme')]);
      await type('tray');
      expect(sections()).toEqual(['Window']);
      await type('logo paper'); // every word has to match
      expect(sections()).toEqual([]);
      await type('logo');
      expect(sections()).toEqual(['Receipt Printer']);
      expect(shownRows()).toEqual([expect.stringContaining('Logo')]);
    });

    it('shows every setting of a section whose title matches', async () => {
      const { type, sections, shownRows } = await open();
      await type('customer display');
      expect(sections()).toEqual(['Customer Display']);
      expect(shownRows()).toHaveLength(5);
    });

    it('says when nothing matches, and puts everything back when the search is cleared', async () => {
      const { el, type, sections, stateOf } = await open();
      await type('zzzz');
      expect(el.textContent).toContain('No settings found');
      expect(sections()).toEqual([]);
      await type('');
      expect(el.textContent).not.toContain('No settings found');
      expect(sections()).toHaveLength(11);
      expect(stateOf('Account')).toBe('open'); // back to how it was
      expect(stateOf('Input')).toBe('closed');
    });

    it('ignores capitals and accents', async () => {
      const { type, sections } = await open();
      await type('ÉCRAN keyboard');
      expect(sections()).toEqual([]);
      await type('KEYBOARD');
      expect(sections()).toEqual(['Input']);
    });
  });

  it('has a UI scale for the customer display: 100% by default, chosen from a list and remembered', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('UI scale');
    const trigger = el.querySelector('hlm-select-trigger[aria-labelledby="display-scale-label"]') as HTMLElement;
    expect(trigger.textContent).toContain('100%');

    (trigger.querySelector('button') ?? trigger).click();
    await fixture.whenStable();
    const options = [...document.querySelectorAll('hlm-select-item')].map((i) => i.textContent!.trim());
    expect(options).toEqual(['75%', '100%', '125%', '150%', '175%', '200%', '250%', '300%']);
    ([...document.querySelectorAll('hlm-select-item')].find((i) => i.textContent?.trim() === '150%') as HTMLElement).click();
    await fixture.whenStable();
    expect(TestBed.inject(AppSettings).customerDisplayScale()).toBe(150);
    expect(localStorage.getItem('micropos.customerDisplayScale')).toBe('150');
    expect(trigger.textContent).toContain('150%');
  });

  it('ignores a saved scale that is not one of the choices', () => {
    localStorage.setItem('micropos.customerDisplayScale', '137');
    localStorage.setItem('micropos.schemaVersion', '5');
    expect(TestBed.inject(AppSettings).customerDisplayScale()).toBe(100);
  });

  it('follows a change made in another window (the till changes it, the display window follows)', () => {
    const settings = TestBed.inject(AppSettings);
    expect(settings.customerDisplayScale()).toBe(100);
    localStorage.setItem('micropos.customerDisplayScale', '200');
    window.dispatchEvent(new StorageEvent('storage', { key: 'micropos.customerDisplayScale', newValue: '200' }));
    expect(settings.customerDisplayScale()).toBe(200);
  });

  it('has a Window mode for the customer display: Windowed by default, with Maximized and Full screen, remembered', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Window mode');
    const trigger = el.querySelector('hlm-select-trigger[aria-labelledby="display-mode-label"]') as HTMLElement;
    expect(trigger.textContent).toContain('Windowed');

    (trigger.querySelector('button') ?? trigger).click();
    await fixture.whenStable();
    expect([...document.querySelectorAll('hlm-select-item')].map((i) => i.textContent!.trim())).toEqual(['Windowed', 'Maximized', 'Full screen']);
    ([...document.querySelectorAll('hlm-select-item')].find((i) => i.textContent?.trim() === 'Full screen') as HTMLElement).click();
    await fixture.whenStable();
    expect(TestBed.inject(AppSettings).customerDisplayMode()).toBe('fullscreen');
    expect(localStorage.getItem('micropos.customerDisplayMode')).toBe('"fullscreen"');
    expect(trigger.textContent).toContain('Full screen');
  });

  it('ignores a saved window mode that is not one of the choices, and migrates old installs to Windowed', () => {
    localStorage.setItem('micropos.customerDisplayMode', '"floating"');
    localStorage.setItem('micropos.schemaVersion', '6');
    expect(TestBed.inject(AppSettings).customerDisplayMode()).toBe('windowed');
    TestBed.resetTestingModule();
    localStorage.clear();
    localStorage.setItem('micropos.schemaVersion', '5');
    expect(TestBed.inject(AppSettings).customerDisplayMode()).toBe('windowed');
    expect(localStorage.getItem('micropos.customerDisplayMode')).toBe('"windowed"');
  });

  it('has the switch that shows and hides the customer display window, and follows the window being closed', async () => {
    const calls = { show: [] as (CustomerDisplayMode | undefined)[], hide: 0 };
    const listeners: ((open: boolean) => void)[] = [];
    const api = {
      display: {
        show: (options?: { mode?: CustomerDisplayMode }) => {
          calls.show.push(options?.mode);
          listeners.forEach((l) => l(true));
          return Promise.resolve();
        },
        hide: () => {
          calls.hide++;
          listeners.forEach((l) => l(false));
          return Promise.resolve();
        },
        isOpen: () => Promise.resolve(false),
        onVisibility: (l: (open: boolean) => void) => {
          listeners.push(l);
          return () => undefined;
        },
      },
    } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Show customer display');
    const row = [...el.querySelectorAll('label')].find((l) => l.textContent?.includes('Show customer display'))!;
    const button = row.querySelector('hlm-switch button') as HTMLElement;
    expect(button.getAttribute('aria-checked')).toBe('false');

    button.click();
    await fixture.whenStable();
    expect(calls.show).toEqual(['windowed']); // opened in the chosen window mode
    expect(button.getAttribute('aria-checked')).toBe('true');
    button.click();
    await fixture.whenStable();
    expect(calls.hide).toBe(1);
    expect(button.getAttribute('aria-checked')).toBe('false');

    listeners.forEach((l) => l(true)); // opened from elsewhere (on start)
    await fixture.whenStable();
    expect(button.getAttribute('aria-checked')).toBe('true');
    listeners.forEach((l) => l(false)); // closed from the window's own title bar
    await fixture.whenStable();
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('has a switch to remember the display\'s monitor and position: on by default, remembered, migrated on', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = switchFor(el, 'Remember monitor and position');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    await fixture.whenStable();
    expect(TestBed.inject(AppSettings).customerDisplayRemember()).toBe(false);
    expect(localStorage.getItem('micropos.customerDisplayRemember')).toBe('false');

    TestBed.resetTestingModule();
    localStorage.clear();
    localStorage.setItem('micropos.schemaVersion', '6'); // an install from before the setting
    expect(TestBed.inject(AppSettings).customerDisplayRemember()).toBe(true);
  });
});
