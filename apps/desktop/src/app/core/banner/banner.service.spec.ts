import { TestBed } from '@angular/core/testing';
import { BANNER_DURATIONS, BannerService } from './banner.service';

describe('BannerService', () => {
  let banner: BannerService;
  const text = () => banner.current()?.text ?? null;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    banner = TestBed.inject(BannerService);
  });
  afterEach(() => vi.useRealTimers());

  it('shows a message for 1.5 seconds by default, with info severity', () => {
    banner.show('Hello');
    expect(banner.current()).toMatchObject({ text: 'Hello', severity: 'info', durationMs: 1500 });
    vi.advanceTimersByTime(1499);
    expect(text()).toBe('Hello');
    vi.advanceTimersByTime(1);
    expect(text()).toBeNull();
  });

  it('supports severities and duration presets or exact milliseconds', () => {
    banner.success('a', { duration: 'short' });
    expect(banner.current()).toMatchObject({ severity: 'success', durationMs: BANNER_DURATIONS.short });
    banner.clear();
    banner.warning('b', { duration: 'long' });
    expect(banner.current()).toMatchObject({ severity: 'warning', durationMs: BANNER_DURATIONS.long });
    banner.clear();
    banner.error('c', { duration: 2500 });
    expect(banner.current()).toMatchObject({ severity: 'error', durationMs: 2500 });
    banner.clear();
    banner.info('d');
    expect(banner.current()?.severity).toBe('info');
  });

  it('queues messages and shows them one after another, in order', () => {
    banner.show('first');
    banner.show('second', { duration: 1000 });
    banner.show('third');
    expect(text()).toBe('first');

    vi.advanceTimersByTime(1500 + 200);
    expect(text()).toBe('second');
    vi.advanceTimersByTime(1000 + 200);
    expect(text()).toBe('third');
    vi.advanceTimersByTime(1500 + 200);
    expect(text()).toBeNull();
  });

  it('a persistent banner stays until removed and reserves space', () => {
    banner.show('update soon', { duration: 'persistent', key: 'update' });
    vi.advanceTimersByTime(60_000);
    expect(text()).toBe('update soon');
    expect(banner.reserveSpace()).toBe(true);
    banner.remove('update');
    expect(text() ?? null).toBeNull();
    expect(banner.reserveSpace()).toBe(false);
  });

  it('timed banners show over a persistent one, which comes back afterwards', () => {
    banner.show('update soon', { duration: 'persistent', key: 'update' });
    banner.show('Saved');
    banner.show('Added');
    expect(text()).toBe('Saved');
    expect(banner.reserveSpace()).toBe(true); // space stays reserved while covered
    vi.advanceTimersByTime(1500 + 200);
    expect(text()).toBe('Added');
    vi.advanceTimersByTime(1500 + 200);
    expect(text()).toBe('update soon');
  });

  it('the same key replaces a persistent banner; dismiss removes the one on show', () => {
    banner.show('v1', { duration: 'persistent', key: 'update' });
    banner.show('v2', { duration: 'persistent', key: 'update' });
    expect(text()).toBe('v2');
    banner.dismiss();
    expect(text() ?? null).toBeNull();
  });

  it('dismiss closes the current banner and moves on; clear forgets everything', () => {
    banner.show('a');
    banner.show('b');
    banner.dismiss();
    expect(text()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(text()).toBe('b');

    banner.show('c');
    banner.clear();
    expect(text()).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(text()).toBeNull(); // nothing left in the queue
  });

  it('repeating a keyed message updates the one on screen and restarts its timer instead of queueing', () => {
    banner.show('Added', { key: 'k' });
    vi.advanceTimersByTime(1000);
    banner.show('Added again', { key: 'k' });
    expect(text()).toBe('Added again');
    vi.advanceTimersByTime(1400); // 2400 ms since the first, but only 1400 since the repeat
    expect(text()).toBe('Added again');
    vi.advanceTimersByTime(100);
    expect(text()).toBeNull();
  });

  it('replaces a waiting message with the same key', () => {
    banner.show('first');
    banner.show('v1', { key: 'k' });
    banner.show('v2', { key: 'k' });
    vi.advanceTimersByTime(1500 + 200);
    expect(text()).toBe('v2');
    vi.advanceTimersByTime(1500 + 200);
    expect(text()).toBeNull(); // v1 was replaced, not queued separately
  });

  it('keeps at most 5 waiting messages, dropping the oldest', () => {
    banner.show('on screen');
    for (let i = 1; i <= 8; i++) banner.show(`m${i}`);
    const seen: string[] = [];
    for (let i = 0; i < 12 && banner.current(); i++) {
      vi.advanceTimersByTime(1500 + 200);
      if (banner.current()) seen.push(text()!);
    }
    expect(seen).toEqual(['m4', 'm5', 'm6', 'm7', 'm8']);
  });
});
