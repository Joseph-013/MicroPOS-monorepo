import { computed, inject, DestroyRef, Service, signal } from '@angular/core';

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
  /**
   * Persistent banners only: whether a click removes it. Default true; pass false for a notice that must stay
   * until the system calls `remove(key)` (e.g. an impending update).
   */
  dismissible?: boolean;
  /** A button on the strip (for example "View"); running it also dismisses the banner. */
  action?: BannerAction;
}

export interface BannerAction {
  label: string;
  run: () => void;
}

export interface BannerMessage {
  id: number;
  text: string;
  severity: BannerSeverity;
  /** Milliseconds; 0 means persistent. */
  durationMs: number;
  key?: string;
  /** A click on the strip removes it. */
  dismissible: boolean;
  action?: BannerAction;
}

const MAX_QUEUED = 5;
/** Blank moment between two banners so a sequence reads as separate messages. */
const GAP_MS = 120;
/** After the pointer leaves a paused banner it stays at least this long, so it does not vanish the instant the pointer moves off. */
const MIN_RESUME_MS = 600;

/**
 * Thin, temporary messages at the top of the window (rendered by `BannerHost`).
 * One banner shows at a time; others wait in a queue (oldest waiting messages are dropped past 5).
 * Default duration is 1.5 s, default severity `info`.
 * `duration: 'persistent'` banners stay until `remove(key)` / `dismiss()` / a click; timed ones show over them
 * for their moment, then the persistent one returns.
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
  /** When the timed banner is due to go, and whether the pointer is holding it (see `pause`). */
  private deadline = 0;
  private held = false;
  private remainingMs = 0;

  /** The timed banner on screen, if any. It temporarily covers the persistent ones. */
  private readonly timed = signal<BannerMessage | null>(null);
  /** Persistent banners (newest last); they stay until removed. */
  private readonly pinned = signal<BannerMessage[]>([]);

  /** The banner on screen: a timed one if there is one, otherwise the newest persistent one, or null. */
  readonly current = computed(() => this.timed() ?? this.pinned().at(-1) ?? null);
  /** True while a persistent banner exists. The app makes room for the strip then, so nothing hides behind it. */
  readonly reserveSpace = computed(() => this.pinned().length > 0);

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
      dismissible: options.dismissible ?? true,
      action: options.action,
    };

    const { key } = options;
    if (message.durationMs === 0) {
      // Persistent: kept apart from the queue; the same key replaces the earlier one.
      this.pinned.update((list) => [...list.filter((m) => !key || m.key !== key), message]);
      return;
    }
    if (key && this.timed()?.key === key) {
      this.display(message); // same thing again: update it in place and restart its timer
      return;
    }
    const queuedIndex = key ? this.queue.findIndex((m) => m.key === key) : -1;
    if (queuedIndex >= 0) {
      this.queue[queuedIndex] = message;
      return;
    }
    if (!this.timed()) {
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

  /**
   * Closes the banner on screen. A timed one is followed by the next queued message; with none on screen,
   * the newest persistent banner is removed.
   */
  dismiss(): void {
    if (!this.timed()) {
      this.pinned.update((list) => list.slice(0, -1));
      return;
    }
    clearTimeout(this.timer);
    this.held = false; // the strip under the pointer is gone
    this.timed.set(null);
    this.timer = this.queue.length ? setTimeout(() => this.showNext(), GAP_MS) : undefined;
  }

  /** Removes the persistent banner with this key (no-op if it is gone), e.g. when an update notice is obsolete. */
  remove(key: string): void {
    this.pinned.update((list) => list.filter((m) => m.key !== key));
  }

  /** Closes the banner on screen and forgets everything waiting, persistent banners included. */
  clear(): void {
    this.queue.length = 0;
    clearTimeout(this.timer);
    this.timed.set(null);
    this.pinned.set([]);
  }

  /** The pointer is over the timed banner: its countdown stops, so a message can be read (or clicked) at leisure. */
  pause(): void {
    if (!this.timed() || this.held) return;
    this.held = true;
    this.remainingMs = Math.max(0, this.deadline - Date.now());
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The pointer left: the countdown carries on with what was left of it. */
  resume(): void {
    if (!this.held) return;
    this.held = false;
    if (this.timed()) this.timer = setTimeout(() => this.dismiss(), Math.max(this.remainingMs, MIN_RESUME_MS));
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (next) this.display(next);
  }

  private display(message: BannerMessage): void {
    clearTimeout(this.timer);
    this.timed.set(message);
    this.deadline = Date.now() + message.durationMs;
    if (this.held) this.remainingMs = message.durationMs; // still under the pointer: the new message waits too
    else this.timer = setTimeout(() => this.dismiss(), message.durationMs);
  }
}
