import { TestBed } from '@angular/core/testing';
import { OutsideTapGuard } from './outside-tap-guard';

const pe = (type: string, pointerType: string, target: Element): void => {
  const event = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }), { pointerId: 1, pointerType });
  target.dispatchEvent(event);
};

describe('OutsideTapGuard', () => {
  let root: HTMLElement;
  let beneath: HTMLButtonElement;
  let clicks: number;
  let overlay: HTMLElement;
  let item: HTMLElement;

  beforeEach(() => {
    root = document.createElement('app-root');
    beneath = document.createElement('button');
    root.append(beneath);
    document.body.append(root);
    overlay = document.createElement('div');
    overlay.className = 'cdk-overlay-container';
    overlay.innerHTML = '<div class="cdk-overlay-pane"><div role="menu"><button id="item">Edit</button></div></div>';
    item = overlay.querySelector('#item')!;
    clicks = 0;
    beneath.addEventListener('click', () => clicks++);
    TestBed.inject(OutsideTapGuard);
  });
  afterEach(() => {
    root.remove();
    overlay.remove();
    TestBed.resetTestingModule();
  });
  const tap = (pointerType: string, target: Element): void => {
    pe('pointerdown', pointerType, target);
    pe('pointerup', pointerType, target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  it('a touch outside an open menu does not reach what is underneath, and the next tap does', () => {
    document.body.append(overlay);
    tap('touch', beneath);
    expect(clicks).toBe(0); // only closes the menu
    overlay.remove(); // the menu is closed now
    tap('touch', beneath);
    expect(clicks).toBe(1);
  });

  it('works for a pen too, but a mouse click outside still clicks what is under it', () => {
    document.body.append(overlay);
    tap('pen', beneath);
    expect(clicks).toBe(0);
    tap('mouse', beneath);
    expect(clicks).toBe(1);
  });

  it('a touch on the menu itself is left alone, and so is any tap when no menu is open', () => {
    document.body.append(overlay);
    let itemClicks = 0;
    item.addEventListener('click', () => itemClicks++);
    tap('touch', item);
    expect(itemClicks).toBe(1);
    overlay.remove();
    tap('touch', beneath);
    expect(clicks).toBe(1);
  });

  it('a touch that did not end in a click (a scroll) does not swallow the next, separate tap', () => {
    document.body.append(overlay);
    pe('pointerdown', 'touch', beneath); // finger down outside the menu, then it scrolls away: no click
    overlay.remove();
    tap('touch', beneath); // a new press starts afresh
    expect(clicks).toBe(1);
  });
});
