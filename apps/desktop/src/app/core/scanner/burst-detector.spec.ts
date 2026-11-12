import { BurstDetector, BurstOutcome } from './burst-detector';

/** Feed `text` at `gapMs` between keys starting at `start`; returns the last outcome and end time. */
function feed(d: BurstDetector, text: string, start: number, gapMs: number) {
  let t = start;
  let last: BurstOutcome = { type: 'none' };
  for (const ch of text) {
    last = d.onKey(ch, t);
    t += gapMs;
  }
  return { last, end: t - gapMs };
}

describe('BurstDetector', () => {
  it('detects a fast burst ended by Enter and swallows the Enter', () => {
    const d = new BurstDetector();
    const { end } = feed(d, '4006381333931', 1000, 5);
    expect(d.onKey('Enter', end + 5)).toEqual({ type: 'scan', code: '4006381333931', consumeKey: true });
    expect(d.pending).toBe(0);
  });

  it('accepts 2D payloads with symbols', () => {
    const d = new BurstDetector();
    const code = 'sales-orders://SO-1042?x=1&y=2#top';
    const { end } = feed(d, code, 0, 3);
    expect(d.onKey('Enter', end + 3)).toMatchObject({ type: 'scan', code });
  });

  it('ignores Shift and CapsLock inside a burst', () => {
    const d = new BurstDetector();
    feed(d, 'AB', 0, 5);
    expect(d.onKey('Shift', 11).type).toBe('buffering');
    feed(d, 'CD', 12, 5);
    expect(d.onKey('Enter', 20)).toMatchObject({ type: 'scan', code: 'ABCD' });
  });

  it('detects a long burst with no terminator once the line goes idle', () => {
    const d = new BurstDetector();
    feed(d, '123456', 0, 5);
    expect(d.flushIdle()).toEqual({ type: 'scan', code: '123456', consumeKey: false });
  });

  it('rejects a short burst that stops without Enter', () => {
    const d = new BurstDetector();
    feed(d, '12345', 0, 5);
    expect(d.flushIdle()).toEqual({ type: 'none' });
    expect(d.pending).toBe(0);
  });

  it('treats human-speed typing as not a scan', () => {
    const d = new BurstDetector();
    const { end } = feed(d, '123456789', 0, 120);
    expect(d.pending).toBe(1);
    expect(d.onKey('Enter', end + 120)).toEqual({ type: 'none' });
  });

  it('starts a new burst after human typing and still detects the scan', () => {
    const d = new BurstDetector();
    feed(d, 'ab', 0, 150);
    const { end } = feed(d, '9780201379624', 1000, 5);
    expect(d.onKey('Enter', end + 5)).toMatchObject({ type: 'scan', code: '9780201379624' });
  });

  it('resets on shortcuts and navigation keys', () => {
    const d = new BurstDetector();
    feed(d, '1234', 0, 5);
    expect(d.onKey('c', 25, true)).toEqual({ type: 'none' });
    expect(d.pending).toBe(0);

    feed(d, '1234', 100, 5);
    expect(d.onKey('Backspace', 125)).toEqual({ type: 'none' });
    expect(d.pending).toBe(0);
  });

  it('does not treat a bare Enter or a too-short burst as a scan', () => {
    const d = new BurstDetector();
    expect(d.onKey('Enter', 0)).toEqual({ type: 'none' });
    feed(d, '12', 10, 5);
    expect(d.onKey('Enter', 20)).toEqual({ type: 'none' });
  });
});
