import { effect, inject, Service, signal } from '@angular/core';
import { StorageService } from '../storage/storage.service';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

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

  constructor() {
    effect(() => this.storage.set('customerDisplayOnStart', this.customerDisplayOnStart()));
    effect(() => this.storage.set('onScreenKeyboard', this.onScreenKeyboard()));
    effect(() => this.storage.set('showNumpad', this.showNumpad()));
  }
}
