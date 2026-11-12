import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppSettings } from '../settings/app-settings.service';
import { OnScreenKeypadDirective } from './on-screen-keypad.directive';

@Component({
  imports: [OnScreenKeypadDirective],
  template: `
    <input id="money" appOnScreenKeypad [keypadWholeDigits]="3" [keypadDecimals]="2" />
    <input id="whole" appOnScreenKeypad [keypadWholeDigits]="4" [keypadDecimals]="0" />
  `,
})
class Host {}

describe('OnScreenKeypadDirective', () => {
  let fixture: ComponentFixture<Host>;
  let money: HTMLInputElement;
  let whole: HTMLInputElement;
  let settings: AppSettings;

  const keypad = () => document.querySelector('app-on-screen-keypad');
  const key = async (label: string): Promise<void> => {
    (document.querySelector(`app-on-screen-keypad button[aria-label="${label}"]`) as HTMLButtonElement).click();
    await fixture.whenStable();
  };
  const keys = async (...labels: string[]): Promise<void> => {
    for (const label of labels) await key(label);
  };

  async function setup(keyboardOn: boolean): Promise<void> {
    TestBed.resetTestingModule();
    localStorage.clear();
    localStorage.setItem('micropos.onScreenKeyboard', String(keyboardOn));
    localStorage.setItem('micropos.schemaVersion', '2');
    settings = TestBed.inject(AppSettings);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    money = (fixture.nativeElement as HTMLElement).querySelector('#money')!;
    whole = (fixture.nativeElement as HTMLElement).querySelector('#whole')!;
  }
  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  const focus = async (input: HTMLInputElement): Promise<void> => {
    input.focus();
    await fixture.whenStable();
  };

  it('shows a keypad when the field is focused and the setting is on, and hides it when the field is left', async () => {
    await setup(true);
    expect(keypad()).toBeNull();
    await focus(money);
    expect(keypad()).not.toBeNull();
    money.blur();
    await fixture.whenStable();
    expect(keypad()).toBeNull();
  });

  it('does nothing when the setting is off', async () => {
    await setup(false);
    await focus(money);
    expect(keypad()).toBeNull();
  });

  it('closes when the setting is turned off while it is showing, and on Escape', async () => {
    await setup(true);
    await focus(money);
    settings.onScreenKeyboard.set(false);
    await fixture.whenStable();
    expect(keypad()).toBeNull();

    settings.onScreenKeyboard.set(true);
    money.blur();
    await focus(money);
    expect(keypad()).not.toBeNull();
    money.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(keypad()).toBeNull();
  });

  it('types into the field and fires its input event so bindings update', async () => {
    await setup(true);
    const seen: string[] = [];
    money.addEventListener('input', () => seen.push(money.value));
    await focus(money);
    await keys('1', '2', '.', '5');
    expect(money.value).toBe('12.5');
    expect(seen).toEqual(['1', '12', '12.', '12.5']);
  });

  it('the first key replaces an existing value, later keys append', async () => {
    await setup(true);
    money.value = '99';
    await focus(money);
    await keys('4', '2');
    expect(money.value).toBe('42');

    money.blur();
    money.value = '';
    await focus(money);
    await keys('7');
    expect(money.value).toBe('7');
  });

  it('starts a decimal with 0, allows one point, and respects the digit limits', async () => {
    await setup(true);
    await focus(money);
    await keys('.');
    expect(money.value).toBe('0.');
    await keys('.', '2', '5', '9'); // a second point and a third decimal are ignored
    expect(money.value).toBe('0.25');

    money.blur();
    await focus(money);
    await keys('1', '2', '3', '4'); // three whole digits at most
    expect(money.value).toBe('123');
  });

  it('does not accept a decimal point in a whole-number field', async () => {
    await setup(true);
    await focus(whole);
    await keys('5', '.', '3');
    expect(whole.value).toBe('53');
  });

  it('deletes one character at a time, and Delete on an empty field is harmless', async () => {
    await setup(true);
    await focus(money);
    await keys('1', '2', '.', '5', 'Delete', 'Delete');
    expect(money.value).toBe('12');
    await keys('Delete', 'Delete', 'Delete');
    expect(money.value).toBe('');
  });

  it('typing on a real keyboard keeps working, and the next keypad key then appends', async () => {
    await setup(true);
    money.value = '5';
    await focus(money);
    money.value = '50';
    money.dispatchEvent(new Event('input', { bubbles: true }));
    await keys('1');
    expect(money.value).toBe('501');
  });

  it('Done leaves the field, which closes the keypad', async () => {
    await setup(true);
    await focus(money);
    await key('Done');
    expect(document.activeElement).not.toBe(money);
    expect(keypad()).toBeNull();
  });

  it('keeps a press on the keypad from taking focus away from the field', async () => {
    await setup(true);
    await focus(money);
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.querySelector('app-on-screen-keypad')!.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
  });
});
