import { inject, DestroyRef, Service, signal } from '@angular/core';

export type BannerSeverity = 'info' | 'success' | 'warning' | 'error';

/** How long a banner stays: a preset name or a number of milliseconds. `persistent` waits for a click or `dismiss()`. */
export const BANNER_DURATIONS = { short: 800, default: 1500, long: 4000, persistent: 0 } as const;
export type BannerDuration = keyof typeof BANNER_DURATIONS | number;

export interface BannerOptions {
  severity?: BannerSeverity;
  duration?: BannerDuration;
  /**
   * Messages with the same key replace each other instead of queueing. Use it for things that can repeat
   * quickly (adding the same item five times shows one banner, whose timer restarts).
   */
  key?: string;
}

export interface BannerMessage {
  id: number;
  text: string;
  severity: BannerSeverity;
  /** Milliseconds; 0 means persistent. */
  durationMs: number;
  key?: string;
}

const MAX_QUEUED = 5;
/** Blank moment between two banners so a sequence reads as separate messages. */
const GAP_MS = 120;

/**
 * Thin, temporary messages at the top of the window (rendered by `BannerHost`).
 * One banner shows at a time; others wait in a queue (oldest waiting messages are dropped past 5).
 * Default duration is 1.5 s, default severity `info`.
 *
 *   banner.success('Bananas added');
 *   banner.warning('Unknown barcode 123', { duration: 'long' });
 *   banner.show('Saved', { severity: 'success', duration: 800, key: 'saved' });
 */
@Service()
export class BannerService {
  private readonly queue: BannerMessage[] = [];
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The banner on screen, or null. */
  readonly current = signal<BannerMessage | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  show(text: string, options: BannerOptions = {}): void {
    const duration = options.duration ?? 'default';
    const message: BannerMessage = {
      id: this.nextId++,
      text,
      severity: options.severity ?? 'info',
      durationMs: typeof duration === 'number' ? Math.max(0, duration) : BANNER_DURATIONS[duration],
      key: options.key,
    };

    const { key } = options;
    if (key && this.current()?.key === key) {
      this.display(message); // same thing again: update it in place and restart its timer
      return;
    }
    const queuedIndex = key ? this.queue.findIndex((m) => m.key === key) : -1;
    if (queuedIndex >= 0) {
      this.queue[queuedIndex] = message;
      return;
    }
    if (!this.current()) {
      this.display(message);
      return;
    }
    this.queue.push(message);
    while (this.queue.length > MAX_QUEUED) this.queue.shift();
  }

  info(text: string, options?: Omit<BannerOptions, 'severity'>): void {
    this.show(text, { ...options, severity: 'info' });
  }
  success(text: string, options?: Omit<BannerOptions, 'severity'>): void {
    this.show(text, { ...options, severity: 'success' });
  }
  warning(text: string, options?: Omit<BannerOptions, 'severity'>): void {
    this.show(text, { ...options, severity: 'warning' });
  }
  error(text: string, options?: Omit<BannerOptions, 'severity'>): void {
    this.show(text, { ...options, severity: 'error' });
  }

  /** Closes the banner on screen; the next queued one (if any) follows. */
  dismiss(): void {
    clearTimeout(this.timer);
    this.current.set(null);
    this.timer = this.queue.length ? setTimeout(() => this.showNext(), GAP_MS) : undefined;
  }

  /** Closes the banner on screen and forgets everything waiting. */
  clear(): void {
    this.queue.length = 0;
    clearTimeout(this.timer);
    this.current.set(null);
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (next) this.display(next);
  }

  private display(message: BannerMessage): void {
    clearTimeout(this.timer);
    this.current.set(message);
    this.timer = message.durationMs > 0 ? setTimeout(() => this.dismiss(), message.durationMs) : undefined;
  }
}
