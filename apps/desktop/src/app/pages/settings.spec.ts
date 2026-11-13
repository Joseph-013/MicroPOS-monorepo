import { TestBed } from '@angular/core/testing';
import type { CustomerDisplayMode, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../core/api/desktop-api';
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
    const titles = [...(fixture.nativeElement as HTMLElement).querySelectorAll('h2')].map((h) => h.textContent!.trim());
    expect(titles).toEqual(['Input', 'Customer Display']);
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
