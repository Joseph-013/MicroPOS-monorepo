import { beforeEach, describe, expect, it } from 'vitest';
import { type GateClock, type GateKey, ScanGate } from './scan-gate';

/** A clock the test drives by hand: time only moves when told, timers fire when their time comes. */
class FakeClock implements GateClock {
  time = 1000;
  private timers: { at: number; run: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number {
    return this.time;
  }
  setTimer(run: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, run, id });
    return id;
  }
  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.time = due.at;
      this.timers = this.timers.filter((t) => t !== due);
      due.run();
    }
    this.time = end;
  }
}

describe('ScanGate', () => {
  let clock: FakeClock;
  let scans: string[];
  let replayed: string[];
  let gate: ScanGate;
  /** Keys the page would have received: what the gate let through, plus what it replayed. */
  let delivered: string[];

  beforeEach(() => {
    clock = new FakeClock();
    scans = [];
    replayed = [];
    delivered = [];
    gate = new ScanGate(
      { emitScan: (code) => scans.push(code), replay: (keys) => (replayed.push(...keys), delivered.push(...keys)) },
      undefined,
      clock,
    );
  });

  /** Press a key; returns whether the gate swallowed it. A key that is not swallowed reaches the page. */
  const press = (key: string, extra: Partial<GateKey> = {}): boolean => {
    const taken = gate.onKeyDown({ key, ...extra });
    if (!taken) delivered.push(key);
    return taken;
  };
  /** A scanner: a key every 5 ms. */
  const scan = (text: string, gap = 5): void => {
    for (const ch of text) {
      press(ch);
      clock.advance(gap);
    }
  };

  it('holds back every key of a scan, swallows the closing Enter and reports the code', () => {
    const swallowed = [...'4006381333931'].map((ch) => {
      const taken = press(ch);
      clock.advance(5);
      return taken;
    });
    const enter = press('Enter');
    expect(swallowed.every(Boolean)).toBe(true);
    expect(enter).toBe(true);
    expect(scans).toEqual(['4006381333931']);
    expect(delivered).toEqual([]); // the page saw none of it
  });

  it('a stray scan cannot reach whatever has focus: nothing is delivered, not even the first key', () => {
    scan('SO-1234');
    press('Enter');
    expect(delivered).toEqual([]);
    expect(scans).toEqual(['SO-1234']);
  });

  it('detects a long scan with no Enter once the keys stop', () => {
    scan('9780201379624');
    expect(scans).toEqual([]); // still waiting for more
    clock.advance(50);
    expect(scans).toEqual(['9780201379624']);
    expect(delivered).toEqual([]);
  });

  it('replays human typing in order, one threshold late', () => {
    press('h');
    expect(delivered).toEqual([]); // held while we wait to see if more fast keys follow
    clock.advance(40);
    expect(delivered).toEqual(['h']);
    press('i');
    clock.advance(40);
    expect(delivered).toEqual(['h', 'i']);
    expect(scans).toEqual([]);
  });

  it('replays a short fast burst that is too short to be a scan', () => {
    scan('ab');
    clock.advance(50);
    expect(delivered).toEqual(['a', 'b']);
    expect(scans).toEqual([]);
  });

  it('lets Enter through after human typing, after replaying what was typed', () => {
    press('o');
    press('k');
    const enter = press('Enter');
    expect(enter).toBe(false);
    expect(delivered).toEqual(['o', 'k', 'Enter']);
    expect(scans).toEqual([]);
  });

  it('passes shortcuts and other keys straight through, replaying anything held first', () => {
    press('a');
    expect(press('c', { control: true })).toBe(false);
    expect(delivered).toEqual(['a', 'c']);
    expect(press('Tab')).toBe(false);
    expect(press('ArrowLeft')).toBe(false);
  });

  it('keeps a scan together across Shift (uppercase characters)', () => {
    for (const ch of 'AB-12') {
      if (ch === 'A' || ch === 'B') expect(press('Shift')).toBe(false); // modifier itself is never held
      press(ch);
      clock.advance(5);
    }
    press('Enter');
    expect(scans).toEqual(['AB-12']);
    expect(delivered).toEqual(['Shift', 'Shift']);
  });

  it('does not treat a slow key after a held burst as part of it', () => {
    press('x');
    clock.advance(36); // idle timer fires: not a scan, replayed
    clock.advance(0);
    press('y');
    clock.advance(40);
    expect(delivered).toEqual(['x', 'y']);
    expect(scans).toEqual([]);
  });

  it('settles a quiet burst even if the idle timer is late', () => {
    scan('1234567');
    // Simulate a late timer: time passes without it firing, then the next key arrives.
    clock.time += 500;
    press('z');
    expect(scans).toEqual(['1234567']);
    expect(delivered).not.toContain('1');
  });

  it('auto-repeat is never a scan', () => {
    press('a');
    expect(press('a', { isAutoRepeat: true })).toBe(false);
    expect(delivered).toEqual(['a', 'a']);
  });

  it('lets everything through while disabled', () => {
    gate.enabled = false;
    scan('4006381333931');
    expect(delivered).toHaveLength(13);
    expect(scans).toEqual([]);
  });

  it('dispose drops what is held without delivering it', () => {
    scan('12345');
    gate.dispose();
    clock.advance(100);
    expect(delivered).toEqual([]);
    expect(scans).toEqual([]);
  });
});
