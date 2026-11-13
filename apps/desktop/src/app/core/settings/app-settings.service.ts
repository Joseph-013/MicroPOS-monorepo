import { DestroyRef, effect, inject, Service, signal } from '@angular/core';
import { StorageService } from '../storage/storage.service';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Sizes the customer display can be set to, in percent of its normal size. */
export const CUSTOMER_DISPLAY_SCALES = [75, 100, 125, 150, 175, 200, 250, 300] as const;
export const DEFAULT_CUSTOMER_DISPLAY_SCALE = 100;
const isScale = (value: unknown): value is number => typeof value === 'number' && (CUSTOMER_DISPLAY_SCALES as readonly number[]).includes(value);
const SCALE_KEY = 'customerDisplayScale';

/**
 * Per-device settings chosen on the Settings page, persisted with `StorageService`
 * (a new setting needs a default and, if existing installs should get it, a storage migration).
 */
@Service()
export class AppSettings {
  private readonly storage = inject(StorageService);

  /** Show the app's own on-screen keyboard for text entry (for tills without a physical keyboard). */
  readonly onScreenKeyboard = signal(this.storage.get('onScreenKeyboard', false, isBoolean));

  /** Show a numpad to the right of the on-screen keyboard (only matters when the keyboard is on). */
  readonly showNumpad = signal(this.storage.get('showNumpad', false, isBoolean));

  /** Open the customer-facing display window when the app starts. */
  readonly customerDisplayOnStart = signal(this.storage.get('customerDisplayOnStart', false, isBoolean));

  /**
   * How large everything on the customer display is, in percent (it is read from a distance, so it is often wanted
   * bigger). The display window is a separate page that shares this storage: it follows a change made in the
   * till's window as soon as it is saved.
   */
  readonly customerDisplayScale = signal<number>(this.storage.get(SCALE_KEY, DEFAULT_CUSTOMER_DISPLAY_SCALE, isScale));

  constructor() {
    effect(() => this.storage.set(SCALE_KEY, this.customerDisplayScale()));
    const follow = (event: StorageEvent): void => {
      if (event.key === `micropos.${SCALE_KEY}`) this.customerDisplayScale.set(this.storage.get(SCALE_KEY, DEFAULT_CUSTOMER_DISPLAY_SCALE, isScale));
    };
    window.addEventListener('storage', follow);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', follow));
    effect(() => this.storage.set('customerDisplayOnStart', this.customerDisplayOnStart()));
    effect(() => this.storage.set('onScreenKeyboard', this.onScreenKeyboard()));
    effect(() => this.storage.set('showNumpad', this.showNumpad()));
  }
}
