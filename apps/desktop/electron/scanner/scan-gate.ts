import { BurstDetector, type BurstOptions, DEFAULT_BURST_OPTIONS } from './burst-detector';

/** The parts of an Electron `before-input-event` key that the gate needs. */
export interface GateKey {
  key: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  isAutoRepeat?: boolean;
}

export interface GateHost {
  /** A scan was recognised; deliver it to the page. */
  emitScan(code: string): void;
  /** Keys that turned out to be human typing: type them into the page after all. */
  replay(keys: string[]): void;
}

export interface GateClock {
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const systemClock: GateClock = {
  now: () => performance.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Stops stray scanner keypresses from ever reaching the page, and tells the page when a real scan happened.
 *
 * It sits in front of the window's keyboard input (Electron's `before-input-event`). The first character of a
 * scan cannot be told from typing, so every printable key is *held back* for one speed threshold:
 *
 * - if more keys follow quickly and the burst turns out to be a scan, the held keys are never delivered and
 *   `emitScan` fires with the code (the scanner's closing Enter is swallowed too);
 * - if the burst turns out to be a person typing (a slow gap, a shortcut, too few characters), the held keys are
 *   replayed to the page in order, so typing costs one threshold (35 ms) of delay and nothing more.
 *
 * Because held keys are never delivered, a scan cannot type into a field, press a focused button, toggle a
 * checkbox or reopen a dialog's trigger, whatever has focus. Detection itself is `BurstDetector`.
 */
export class ScanGate {
  private readonly detector: BurstDetector;
  private readonly thresholdMs: number;
  /** Keys held back, awaiting the verdict. */
  private held: string[] = [];
  private lastKeyAt = Number.NEGATIVE_INFINITY;
  private timer: unknown;
  /** Turn detection off (keys then pass straight through). */
  enabled = true;

  constructor(
    private readonly host: GateHost,
    options: BurstOptions = DEFAULT_BURST_OPTIONS,
    private readonly clock: GateClock = systemClock,
  ) {
    this.detector = new BurstDetector(options);
    this.thresholdMs = options.speedThresholdMs;
  }

  /** Returns true when the key was taken (the caller must `preventDefault` it so the page never sees it). */
  onKeyDown(input: GateKey): boolean {
    if (!this.enabled) return false;

    // Modifier keys carry no payload; they must not disturb a burst (uppercase characters use Shift).
    if (input.key === 'Shift' || input.key === 'CapsLock') return false;

    const now = this.clock.now();
    // A held burst that went quiet is settled first, so this key starts afresh even if the idle timer is late.
    if (this.held.length > 0 && now - this.lastKeyAt >= this.thresholdMs) this.settleIdle();
    this.lastKeyAt = now;

    if (input.isAutoRepeat) {
      this.flushHeld();
      this.detector.reset();
      return false;
    }

    const outcome = this.detector.onKey(input.key, now, !!(input.control || input.meta || input.alt));
    switch (outcome.type) {
      case 'buffering':
        this.held.push(input.key);
        this.restartTimer();
        return true;
      case 'scan':
        this.clearTimer();
        this.held = [];
        this.host.emitScan(outcome.code);
        return outcome.consumeKey; // the closing Enter is ours; any other key still goes through
      case 'none':
        this.clearTimer();
        this.flushHeld(); // it was typing after all; the current key follows the replayed ones
        return false;
    }
  }

  /** Drop everything held without delivering it (window closing, feature switched off). */
  dispose(): void {
    this.clearTimer();
    this.held = [];
    this.detector.reset();
  }

  private restartTimer(): void {
    this.clearTimer();
    this.timer = this.clock.setTimer(() => this.settleIdle(), this.thresholdMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** No key for a whole threshold: the burst is over. A long enough one is a scan, otherwise it was typing. */
  private settleIdle(): void {
    this.clearTimer();
    const outcome = this.detector.flushIdle();
    if (outcome.type === 'scan') {
      this.held = [];
      this.host.emitScan(outcome.code);
    } else {
      this.flushHeld();
    }
  }

  private flushHeld(): void {
    if (this.held.length === 0) return;
    const keys = this.held;
    this.held = [];
    this.host.replay(keys);
  }
}
