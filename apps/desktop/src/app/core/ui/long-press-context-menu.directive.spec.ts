import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, LongPressContextMenu } from './long-press-context-menu.directive';

@Component({ imports: [LongPressContextMenu], template: '<div appLongPressContextMenu id="row">row</div>' })
class Host {}

const pe = (type: string, x = 100, y = 100, pointerType = 'touch', id = 1): Event =>
  Object.assign(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }), { pointerId: id, pointerType });

describe('long press ripple', () => {
  let row: HTMLElement;
  let animations: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[];
  beforeEach(() => {
    vi.useFakeTimers();
    animations = [];
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      animations.push({ keyframes, options });
      return {};
    };
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    row = fixture.nativeElement.querySelector('#row');
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    document.querySelectorAll('[data-long-press-ripple]').forEach((r) => r.remove());
    vi.useRealTimers();
  });
  const ripple = (): HTMLElement | null => document.querySelector('[data-long-press-ripple]');

  it('grows slowly under the finger for as long as the hold takes, and is gone when the menu opens', () => {
    row.dispatchEvent(pe('pointerdown', 120, 200));
    expect(ripple()).not.toBeNull();
    expect(ripple()!.style.left).toBe('120px');
    expect(ripple()!.style.top).toBe('200px');
    expect(ripple()!.style.pointerEvents).toBe('none');
    expect(animations[0]!.options.duration).toBe(LONG_PRESS_MS); // as slow as the hold
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(ripple()).toBeNull();
  });

  it('fades out when the finger lifts or moves early, and a mouse press shows none', () => {
    row.dispatchEvent(pe('pointerdown'));
    row.dispatchEvent(pe('pointerup'));
    vi.advanceTimersByTime(300);
    expect(ripple()).toBeNull();
    row.dispatchEvent(pe('pointerdown'));
    row.dispatchEvent(pe('pointermove', 300, 300));
    vi.advanceTimersByTime(300);
    expect(ripple()).toBeNull();
    row.dispatchEvent(pe('pointerdown', 5, 5, 'mouse'));
    expect(ripple()).toBeNull();
  });
});

describe('long press opens the context menu', () => {
  let row: HTMLElement;
  let menus: MouseEvent[];
  let clicks: number;
  beforeEach(() => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    row = fixture.nativeElement.querySelector('#row');
    menus = [];
    clicks = 0;
    row.addEventListener('contextmenu', (e) => menus.push(e as MouseEvent));
    row.addEventListener('click', () => clicks++);
  });
  afterEach(() => vi.useRealTimers());

  it('sends a contextmenu event at the touch point after a long press, and the release does not also click', () => {
    row.dispatchEvent(pe('pointerdown', 40, 60));
    expect(row.hasAttribute('data-pressing')).toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    expect(menus).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(menus).toHaveLength(1);
    expect([menus[0]!.clientX, menus[0]!.clientY]).toEqual([40, 60]);
    expect(row.hasAttribute('data-pressing')).toBe(false);
    row.dispatchEvent(pe('pointerup', 40, 60));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // the click a browser sends on release
    expect(clicks).toBe(0);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // a later, ordinary click
    expect(clicks).toBe(1);
  });

  it('is not a long press when the finger lifts early, moves (a swipe or a scroll) or is cancelled', () => {
    row.dispatchEvent(pe('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    row.dispatchEvent(pe('pointerup'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    row.dispatchEvent(pe('pointerdown'));
    row.dispatchEvent(pe('pointermove', 100 + LONG_PRESS_SLOP_PX + 5, 100));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    row.dispatchEvent(pe('pointerdown'));
    row.dispatchEvent(pe('pointercancel'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    row.dispatchEvent(pe('pointerdown'));
    row.dispatchEvent(pe('pointermove', 103, 102)); // a little tremor is fine
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(menus).toHaveLength(1); // only the last one
  });

  it('leaves the mouse alone (it has the right button)', () => {
    row.dispatchEvent(pe('pointerdown', 10, 10, 'mouse'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 3);
    expect(menus).toHaveLength(0);
  });

  it('drops the browser\'s own long-press contextmenu that follows ours, so the menu opens once', () => {
    row.dispatchEvent(pe('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(menus).toHaveLength(1);
    // A trusted native event cannot be made in a test; a synthetic one is not dropped, which is also what keeps right click working.
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menus).toHaveLength(2);
  });
});
