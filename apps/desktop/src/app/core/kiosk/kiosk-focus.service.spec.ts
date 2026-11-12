import { TestBed } from '@angular/core/testing';
import { KioskFocusService } from './kiosk-focus.service';

function press(el: Element, button = 0): MouseEvent {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button });
  el.dispatchEvent(event);
  return event;
}

describe('KioskFocusService', () => {
  beforeEach(() => TestBed.inject(KioskFocusService));
  afterEach(() => (document.body.innerHTML = ''));

  it('keeps focus off buttons and links but still lets clicks through', () => {
    document.body.innerHTML = '<button id="b"><span id="inner">x</span></button><a href="#" id="a">a</a>';
    expect(press(document.getElementById('b')!).defaultPrevented).toBe(true);
    expect(press(document.getElementById('inner')!).defaultPrevented).toBe(true);
    expect(press(document.getElementById('a')!).defaultPrevented).toBe(true);
    const onClick = vi.fn();
    document.getElementById('b')!.addEventListener('click', onClick);
    document.getElementById('b')!.click();
    expect(onClick).toHaveBeenCalled();
  });

  it('leaves fields, opt-outs, other mouse buttons and plain content alone', () => {
    document.body.innerHTML =
      '<input id="i"><textarea id="t"></textarea><select id="s"></select><button id="o" data-allow-focus>o</button><div id="d">d</div><button id="b">b</button>';
    for (const id of ['i', 't', 's', 'o', 'd']) expect(press(document.getElementById(id)!).defaultPrevented).toBe(false);
    expect(press(document.getElementById('b')!, 2).defaultPrevented).toBe(false);
  });

  it('does not move focus away from a focused field when a button is pressed', () => {
    document.body.innerHTML = '<input id="i"><button id="b">b</button>';
    document.getElementById('i')!.focus();
    press(document.getElementById('b')!);
    expect(document.activeElement?.id).toBe('i');
  });
});
