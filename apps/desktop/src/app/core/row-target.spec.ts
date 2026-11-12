import { TestBed } from '@angular/core/testing';
import { ROW_TARGET_MS, rowTarget } from './row-target';

describe('rowTarget', () => {
  afterEach(() => vi.useRealTimers());

  it('highlights a row for a limited time only, and targeting again restarts the clock', () => {
    vi.useFakeTimers();
    const target = TestBed.runInInjectionContext(() => rowTarget());
    expect(target()).toBeNull();

    target.set('a');
    expect(target()).toBe('a');
    vi.advanceTimersByTime(ROW_TARGET_MS - 1);
    expect(target()).toBe('a');
    target.set('b'); // a new target restarts the time
    vi.advanceTimersByTime(ROW_TARGET_MS - 1);
    expect(target()).toBe('b');
    vi.advanceTimersByTime(1);
    expect(target()).toBeNull();
  });

  it('can be cleared early', () => {
    vi.useFakeTimers();
    const target = TestBed.runInInjectionContext(() => rowTarget());
    target.set('a');
    target.set(null);
    expect(target()).toBeNull();
    vi.advanceTimersByTime(ROW_TARGET_MS * 2);
    expect(target()).toBeNull();
  });
});
