import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HoldRepeatDirective } from './hold-repeat.directive';

@Component({
  imports: [HoldRepeatDirective],
  template: `<button appHoldRepeat (click)="clicks = clicks + 1" (held)="holds = holds + 1">+</button>`,
})
class Host {
  clicks = 0;
  holds = 0;
}

const pointer = (type: string, button = 0): Event => Object.assign(new MouseEvent(type, { button, bubbles: true }), { pointerId: 1 });

describe('HoldRepeatDirective', () => {
  let host: Host;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable(); // settle first: Angular's own scheduling must not run on fake timers
    button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('does nothing for a quick tap except the normal click', () => {
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(200);
    button.dispatchEvent(pointer('pointerup'));
    button.click();
    vi.advanceTimersByTime(2000);
    expect(host.holds).toBe(0);
    expect(host.clicks).toBe(1);
  });

  it('starts repeating after 400 ms and keeps repeating, faster over time, until release', () => {
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(399);
    expect(host.holds).toBe(0);
    vi.advanceTimersByTime(1);
    expect(host.holds).toBe(1);

    vi.advanceTimersByTime(1000);
    const after1s = host.holds;
    expect(after1s).toBeGreaterThan(5);
    vi.advanceTimersByTime(1000);
    expect(host.holds - after1s).toBeGreaterThan(after1s - 1); // the second second repeats more often than the first
    button.dispatchEvent(pointer('pointerup'));
    const stopped = host.holds;
    vi.advanceTimersByTime(2000);
    expect(host.holds).toBe(stopped);
  });

  it('swallows the click that follows a hold, but not the next tap', () => {
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(700);
    button.dispatchEvent(pointer('pointerup'));
    button.click(); // the click that ends a hold
    expect(host.clicks).toBe(0);

    button.dispatchEvent(pointer('pointerdown'));
    button.dispatchEvent(pointer('pointerup'));
    button.click(); // an ordinary tap afterwards
    expect(host.clicks).toBe(1);
  });

  it('stops when the pointer leaves, and ignores non-primary buttons', () => {
    button.dispatchEvent(pointer('pointerdown', 2));
    vi.advanceTimersByTime(1000);
    expect(host.holds).toBe(0);

    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(500);
    button.dispatchEvent(pointer('pointerleave'));
    const held = host.holds;
    vi.advanceTimersByTime(1000);
    expect(host.holds).toBe(held);
    button.click();
    button.dispatchEvent(pointer('pointerdown'));
    button.click();
    expect(host.clicks).toBe(1); // the click after a leave that followed a hold was swallowed once, the later one was not
  });
});
