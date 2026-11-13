import { TestBed } from '@angular/core/testing';
import { AppSettings } from '../core/settings/app-settings.service';
import { SettingsPage } from './settings';

// jsdom has no ResizeObserver or scrollIntoView (the select's overlay uses both).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
Element.prototype.scrollIntoView ??= () => undefined;

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
    const toggle = [...el.querySelectorAll('hlm-switch button')].pop() as HTMLButtonElement;
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
    const trigger = el.querySelector('hlm-select-trigger') as HTMLElement;
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
});
