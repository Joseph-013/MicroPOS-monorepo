/**
 * Keyboard-wedge scanner detection: a scanner "types" its payload as a rapid burst of
 * key presses (usually ending with Enter), far faster than any human. This class is the
 * pure state machine for that; it has no DOM or Angular dependencies.
 */

export interface BurstOptions {
  /** Max gap between two keys of one burst. Humans are far slower than this. */
  speedThresholdMs: number;
  /** Min characters for a burst that ends with Enter. */
  minLengthWithTerminator: number;
  /** Min characters for a burst that just stops (no Enter); stricter to avoid false positives. */
  minLengthWithoutTerminator: number;
}

export const DEFAULT_BURST_OPTIONS: BurstOptions = {
  speedThresholdMs: 35,
  minLengthWithTerminator: 3,
  minLengthWithoutTerminator: 6,
};

export type BurstOutcome =
  /** Key is not part of a scan. */
  | { type: 'none' }
  /** Key may be the start or middle of a scan; await more keys or an idle gap. */
  | { type: 'buffering' }
  /** A scan completed. `consumeKey` is true when the terminating key should be swallowed. */
  | { type: 'scan'; code: string; consumeKey: boolean };

const NONE: BurstOutcome = { type: 'none' };
const BUFFERING: BurstOutcome = { type: 'buffering' };

/** Printable ASCII (1D and 2D payloads include symbols such as : / ? = & #). */
function isPayloadChar(key: string): boolean {
  if (key.length !== 1) return false;
  const code = key.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e;
}

export class BurstDetector {
  private buffer: string[] = [];
  private lastTime = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: BurstOptions = DEFAULT_BURST_OPTIONS) {}

  /** Number of characters currently buffered. */
  get pending(): number {
    return this.buffer.length;
  }

  onKey(key: string, time: number, hasModifier = false): BurstOutcome {
    // Shortcuts are never scanner input.
    if (hasModifier) {
      this.reset();
      return NONE;
    }
    // Shift/CapsLock appear inside bursts for uppercase characters; they carry no data or timing.
    if (key === 'Shift' || key === 'CapsLock') return this.buffer.length > 0 ? BUFFERING : NONE;

    const fast = time - this.lastTime < this.options.speedThresholdMs;
    this.lastTime = time;

    if (key === 'Enter') {
      const ok = fast && this.buffer.length >= this.options.minLengthWithTerminator;
      const code = this.buffer.join('');
      this.buffer = [];
      return ok ? { type: 'scan', code, consumeKey: true } : NONE;
    }

    if (isPayloadChar(key)) {
      // A slow key means the previous characters were human typing: start a new burst.
      if (!fast) this.buffer = [];
      this.buffer.push(key);
      return BUFFERING;
    }

    // Backspace, arrows, Tab, Escape, F-keys...: human input.
    this.buffer = [];
    return NONE;
  }

  /** Call when no key arrived within `speedThresholdMs` of the last buffered key. */
  flushIdle(): BurstOutcome {
    const ok = this.buffer.length >= this.options.minLengthWithoutTerminator;
    const code = this.buffer.join('');
    this.buffer = [];
    return ok ? { type: 'scan', code, consumeKey: false } : NONE;
  }

  reset(): void {
    this.buffer = [];
  }
}
