import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnScreenKeypadDirective } from '../keypad';
import { AppSettings } from '../settings/app-settings.service';
import { OnScreenKeyboardService } from './on-screen-keyboard.service';

@Component({
  imports: [OnScreenKeypadDirective],
  template: `
    <form id="form" (submit)="$event.preventDefault(); submitted = submitted + 1">
      <input id="text" type="text" />
      <input id="second" type="text" />
      <input id="search" type="search" />
      <input id="email" type="email" />
      <input id="password" type="password" />
      <textarea id="area"></textarea>
      <input id="number" type="number" />
      <input id="count" type="number" value="1" min="1" max="99" />
      <input id="money" type="number" step="0.01" />
      <input id="weight" type="number" step="any" />
      <input id="decimal" type="text" inputmode="decimal" />
      <input id="checkbox" type="checkbox" />
      <input id="readonly" type="text" readonly />
      <input id="disabled" type="text" disabled />
      <input id="optout" type="text" data-no-keyboard />
      <div data-no-keyboard><input id="nested-optout" type="text" /></div>
      <input id="numeric" type="text" appOnScreenKeypad />
    </form>
  `,
})
class Host {
  submitted = 0;
}

describe('OnScreenKeyboardService', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  let settings: AppSettings;

  const keyboard = () => document.querySelector('app-on-screen-keyboard');
  const keypad = () => document.querySelector('app-on-screen-keypad');
  const pad = async (label: string): Promise<void> => {
    (document.querySelector(`app-on-screen-keypad button[aria-label="${label}"]`) as HTMLButtonElement).click();
    await fixture.whenStable();
  };
  const field = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement & HTMLTextAreaElement;
  const key = async (label: string): Promise<void> => {
    (document.querySelector(`app-on-screen-keyboard button[aria-label="${label}"]`) as HTMLButtonElement).click();
    await fixture.whenStable();
  };
  const focus = async (id: string): Promise<void> => {
    field(id).focus();
    await fixture.whenStable();
  };

  async function setup(keyboardOn = true): Promise<void> {
    TestBed.resetTestingModule();
    localStorage.clear();
    localStorage.setItem('micropos.onScreenKeyboard', String(keyboardOn));
    localStorage.setItem('micropos.schemaVersion', '3');
    settings = TestBed.inject(AppSettings);
    TestBed.inject(OnScreenKeyboardService);
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }
  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('opens for text-like fields: text, search, email, password and textareas', async () => {
    await setup();
    for (const id of ['text', 'search', 'email', 'password', 'area']) {
      await focus(id);
      expect(keyboard(), id).not.toBeNull();
      field(id).blur();
      await fixture.whenStable();
      expect(keyboard(), `${id} closed`).toBeNull();
    }
  });

  it('stays away from fields that cannot or should not take it', async () => {
    await setup();
    for (const id of ['checkbox', 'readonly', 'disabled', 'optout', 'nested-optout', 'numeric']) {
      field(id).focus();
      await fixture.whenStable();
      expect(keyboard(), id).toBeNull();
      field(id).blur();
    }
  });

  describe('numeric fields', () => {
    it('get the numeric keypad, not the QWERTY keyboard: number inputs and inputmode decimal or numeric', async () => {
      await setup();
      for (const id of ['number', 'decimal']) {
        await focus(id);
        expect(keypad(), id).not.toBeNull();
        expect(keyboard(), id).toBeNull();
        field(id).blur();
        await fixture.whenStable();
        expect(keypad(), `${id} closed`).toBeNull();
      }
    });

    it('turns a number field into text while the keypad is up and back into a number afterwards', async () => {
      await setup();
      const input = field('count');
      expect(input.type).toBe('number');
      await focus('count');
      expect(input.type).toBe('text'); // so a half-typed "2." can be shown
      expect(input.getAttribute('inputmode')).toBe('none');
      await pad('Done');
      expect(input.type).toBe('number');
      expect(input.hasAttribute('inputmode')).toBe(false);
    });

    it('types numbers, replacing the existing value with the first key', async () => {
      await setup();
      const input = field('count');
      await focus('count');
      await pad('4');
      await pad('2');
      expect(input.value).toBe('42');
      await pad('Done');
      expect(input.value).toBe('42');
      expect(input.valueAsNumber).toBe(42);
    });

    it('takes its limits from the field: step decides the decimals, max the digits', async () => {
      await setup();
      await focus('count'); // no step: whole numbers; max 99: two digits
      await pad('1');
      await pad('.');
      await pad('2');
      await pad('3');
      expect(field('count').value).toBe('12'); // no decimal point, and a third digit is refused
      field('count').blur();

      await focus('money'); // step 0.01: two decimals
      await pad('3');
      await pad('.');
      await pad('1');
      await pad('4');
      await pad('9');
      expect(field('money').value).toBe('3.14');
      field('money').blur();

      await focus('weight'); // step any: three decimals
      for (const k of ['2', '.', '5', '5', '5', '5']) await pad(k);
      expect(field('weight').value).toBe('2.555');
    });

    it('drops a trailing point when the keypad closes, so the number is valid', async () => {
      await setup();
      await focus('weight');
      await pad('7');
      await pad('.');
      await pad('Done');
      expect(field('weight').type).toBe('number');
      expect(field('weight').value).toBe('7');
    });

    it('fires change when the value changed, like a user edit would, and not when it did not', async () => {
      await setup();
      const changes: string[] = [];
      field('count').addEventListener('change', () => changes.push(field('count').value));
      await focus('count');
      await pad('Done');
      expect(changes).toEqual([]); // opened and left without changing anything

      await focus('count');
      await pad('5');
      await pad('Done');
      expect(changes).toEqual(['5']);
    });

    it('fires input as keys are pressed so bindings stay in step', async () => {
      await setup();
      const seen: string[] = [];
      field('count').addEventListener('input', () => seen.push(field('count').value));
      await focus('count');
      await pad('9');
      await pad('8');
      expect(seen).toEqual(['9', '98']);
    });
  });

  it('does nothing while the setting is off, and starts working when it is turned on', async () => {
    await setup(false);
    await focus('text');
    expect(keyboard()).toBeNull();
    field('text').blur();

    settings.onScreenKeyboard.set(true);
    await fixture.whenStable();
    await focus('text');
    expect(keyboard()).not.toBeNull();
  });

  it('closes when the setting is turned off, on Escape, and when focus leaves', async () => {
    await setup();
    await focus('text');
    settings.onScreenKeyboard.set(false);
    await fixture.whenStable();
    expect(keyboard()).toBeNull();

    settings.onScreenKeyboard.set(true);
    field('text').blur();
    await focus('text');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(keyboard()).toBeNull();
  });

  it('types at the caret and fires input; Backspace deletes', async () => {
    await setup();
    const input = field('text');
    input.value = 'hllo';
    await focus('text');
    input.setSelectionRange(1, 1);
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    await key('e');
    expect(input.value).toBe('hello');
    await key('Backspace');
    expect(input.value).toBe('hllo');
    await key('Space');
    await key('Shift');
    await key('W');
    expect(input.value).toBe('h Wllo');
    expect(seen.length).toBe(4);
  });

  it('moves between fields: the keyboard follows focus and types into the new one', async () => {
    await setup();
    await focus('text');
    await key('a');
    await focus('second');
    expect(document.querySelectorAll('app-on-screen-keyboard').length).toBe(1);
    await key('b');
    expect(field('text').value).toBe('a');
    expect(field('second').value).toBe('b');
  });

  it('Enter in an input runs its Enter handlers and submits the form; in a textarea it adds a line', async () => {
    await setup();
    await focus('text');
    let enterKeys = 0;
    field('text').addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && enterKeys++);
    await key('Enter');
    expect(enterKeys).toBe(1);
    expect(fixture.componentInstance.submitted).toBe(1);

    field('text').blur();
    await focus('area');
    await key('a');
    await key('Enter');
    await key('b');
    expect(field('area').value).toBe('a\nb');
    expect(fixture.componentInstance.submitted).toBe(1); // a textarea does not submit
  });

  it('Done leaves the field and closes the keyboard', async () => {
    await setup();
    await focus('text');
    await key('Done');
    expect(document.activeElement).not.toBe(field('text'));
    expect(keyboard()).toBeNull();
  });

  it('hides the OS keyboard while open (inputmode none) and puts the field back afterwards', async () => {
    await setup();
    const input = field('text');
    input.setAttribute('inputmode', 'email');
    await focus('text');
    expect(input.getAttribute('inputmode')).toBe('none');
    input.blur();
    await fixture.whenStable();
    expect(input.getAttribute('inputmode')).toBe('email');

    const plain = field('second');
    await focus('second');
    expect(plain.getAttribute('inputmode')).toBe('none');
    plain.blur();
    await fixture.whenStable();
    expect(plain.hasAttribute('inputmode')).toBe(false);
  });

  it('shows the numpad only when that setting is on, even while the keyboard is open', async () => {
    await setup();
    await focus('text');
    expect(document.querySelector('app-on-screen-keyboard [aria-label="Numpad"]')).toBeNull();
    settings.showNumpad.set(true);
    TestBed.tick(); // run the effect that pushes the setting into the open keyboard
    await fixture.whenStable();
    expect(document.querySelector('app-on-screen-keyboard [aria-label="Numpad"]')).not.toBeNull();
    await key('Numpad 7');
    expect(field('text').value).toBe('7');
    settings.showNumpad.set(false);
    TestBed.tick();
    await fixture.whenStable();
    expect(document.querySelector('app-on-screen-keyboard [aria-label="Numpad"]')).toBeNull();
  });
});
