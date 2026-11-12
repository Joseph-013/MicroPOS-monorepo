import { TestBed } from '@angular/core/testing';
import { AppSettings } from '../core/settings/app-settings.service';
import { SettingsPage } from './settings';

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
});
