import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnScreenKeyboard } from './on-screen-keyboard';

describe('OnScreenKeyboard', () => {
  let fixture: ComponentFixture<OnScreenKeyboard>;
  let el: HTMLElement;
  let pressed: string[];

  beforeEach(async () => {
    fixture = TestBed.createComponent(OnScreenKeyboard);
    el = fixture.nativeElement as HTMLElement;
    pressed = [];
    fixture.componentInstance.pressed.subscribe((k) => pressed.push(k));
    await fixture.whenStable();
  });
  afterEach(() => fixture.destroy());

  const btn = (label: string) => el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  const click = async (label: string): Promise<void> => {
    btn(label)!.click();
    await fixture.whenStable();
  };
  const labels = () => [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

  it('is QWERTY with a row of numbers on top', () => {
    const order = labels();
    const text = (from: string, to: string) => order.slice(order.indexOf(from), order.indexOf(to) + 1).join('');
    expect(text('1', '0')).toBe('1234567890');
    expect(text('q', 'p')).toBe('qwertyuiop');
    expect(text('a', 'l')).toBe('asdfghjkl');
    expect(text('z', '.')).toBe('zxcvbnm,.');
    expect(order.indexOf('1')).toBeLessThan(order.indexOf('q')); // numbers above the letters
    for (const special of ['Backspace', 'Enter', 'Shift', 'Space', 'Done']) expect(btn(special), special).toBeTruthy();
  });

  it('sends the pressed character, and the special keys by name', async () => {
    for (const k of ['h', 'i', 'Space', 'Enter', 'Backspace', 'Done']) await click(k);
    expect(pressed).toEqual(['h', 'i', ' ', 'Enter', 'Backspace', 'Done']);
  });

  it('shift capitalizes the next letter only, and turns the number row into symbols meanwhile', async () => {
    await click('Shift');
    expect(btn('Shift')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn('A')).toBeTruthy();
    expect(btn('a')).toBeNull();
    expect(btn('!')).toBeTruthy(); // 1 becomes !
    expect(btn('1')).toBeNull();

    await click('A');
    await click('b'); // shift was used up by the first key
    expect(pressed).toEqual(['A', 'b']);
    expect(btn('Shift')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('shift again cancels it, and symbols can be typed', async () => {
    await click('Shift');
    await click('Shift');
    expect(btn('q')).toBeTruthy();

    await click('Shift');
    await click('@'); // there are two @ keys (symbol row and bottom row); either sends the same thing
    expect(pressed).toEqual(['@']);
  });

  it('has no numpad by default, and shows one on the right when asked', async () => {
    expect(el.querySelector('[aria-label="Numpad"]')).toBeNull();
    fixture.componentRef.setInput('showNumpad', true);
    await fixture.whenStable();
    expect(el.querySelector('[aria-label="Numpad"]')).not.toBeNull();
    const pad = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.'].map((k) => `Numpad ${k}`);
    for (const label of pad) expect(btn(label), label).toBeTruthy();

    await click('Numpad 7');
    await click('Numpad .');
    expect(pressed).toEqual(['7', '.']);
    expect(el.className).toContain('60rem'); // wider to fit it
  });

  it('keeps focus where it is when the panel is pressed', () => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
