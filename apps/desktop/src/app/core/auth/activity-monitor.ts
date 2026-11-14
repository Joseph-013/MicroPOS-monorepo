import { DestroyRef, effect, inject, Service, signal, untracked } from '@angular/core';
import { DESKTOP_API } from '../api/desktop-api';
import { BannerService } from '../banner';
import { AuthService } from './auth.service';

/** How often it looks, and how often at most it tells the main process that someone is using the page. */
export const ACTIVITY_CHECK_MS = 5_000;
export const ACTIVITY_REPORT_MS = 10_000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Signs the person out after the shop's inactivity limit (Settings > Auto sign-out; none by default). "Activity" is
 * input on this page (touch, mouse, keys), not calls to the main process, so a screen left on by itself does not stay
 * open because of background refreshes. The page tells the main process while there is input
 * (`auth.activity`, which also keeps its own clock and ends an idle session even if this page were stuck), and the
 * limit comes back with that answer. Started by the root `App`.
 */
@Service()
export class ActivityMonitor {
  private readonly api = inject(DESKTOP_API);
  private readonly auth = inject(AuthService);
  private readonly banner = inject(BannerService);

  /** The inactivity limit in minutes, or null for never; learned when someone signs in and kept current by the reports. */
  readonly timeoutMinutes = signal<number | null>(null);
  private lastInput = Date.now();
  private lastReport = 0;
  private reported = true;

  constructor() {
    const onInput = (): void => {
      this.lastInput = Date.now();
      this.reported = false;
    };
    for (const type of INPUT_EVENTS) document.addEventListener(type, onInput, { passive: true, capture: true });
    const timer = setInterval(() => void this.check(), ACTIVITY_CHECK_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      for (const type of INPUT_EVENTS) document.removeEventListener(type, onInput, { capture: true });
    });
    // Someone signs in: the clock starts, and the limit is learned at once.
    effect(() => {
      if (this.auth.user()) {
        untracked(() => {
          this.lastInput = Date.now();
          this.lastReport = 0;
          void this.report();
        });
      } else this.timeoutMinutes.set(null);
    });
  }

  /** Saves a new limit (admins); the value is applied here at once. False when the main process refused it. */
  async setTimeout(minutes: number | null): Promise<boolean> {
    try {
      const saved = (await this.api?.auth.setSessionTimeout(minutes)) ?? false;
      if (saved) this.timeoutMinutes.set(minutes);
      return saved;
    } catch (error) {
      console.error('Failed to save the session limit', error);
      return false;
    }
  }

  private async check(now = Date.now()): Promise<void> {
    if (!this.auth.user()) return;
    const limit = this.timeoutMinutes();
    if (limit !== null && now - this.lastInput >= limit * 60_000) return this.expire(limit);
    if (!this.reported && now - this.lastReport >= ACTIVITY_REPORT_MS) await this.report(now);
  }

  /** Tells the main process someone is here, and learns the limit; a session it says has ended locks this page too. */
  private async report(now = Date.now()): Promise<void> {
    this.lastReport = now;
    this.reported = true;
    try {
      const activity = await this.api?.auth.activity();
      if (!activity) return;
      this.timeoutMinutes.set(activity.timeoutMinutes);
      if (!activity.user && this.auth.user()) await this.expire(activity.timeoutMinutes);
    } catch (error) {
      console.error('Failed to report activity', error);
    }
  }

  private async expire(minutes: number | null): Promise<void> {
    await this.auth.signOut();
    this.banner.info(minutes ? `Signed out after ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of inactivity` : 'Signed out', { key: 'session-expired', duration: 'long' });
  }
}
