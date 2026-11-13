import { DestroyRef, effect, inject, Service, signal, untracked } from '@angular/core';
import type { CustomerDisplayState } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { AppSettings } from './settings/app-settings.service';

/**
 * The customer-facing window, from the till's side: whether it is open, a way to open and close it, and a way to
 * tell it what to show. The window itself lives in the main process (`electron/display/`), which also remembers the
 * monitor and position it had.
 */
@Service()
export class CustomerDisplayService {
  private readonly api = inject(DESKTOP_API);
  private readonly settings = inject(AppSettings);

  /** True while the window is open (it can also be closed from its own title bar). */
  readonly open = signal(false);

  constructor() {
    if (!this.api) return;
    // The answer to "is it open?" can arrive after an opening or closing that was announced first: the later news wins.
    let heard = false;
    this.api.display.isOpen().then((open) => (heard ? undefined : this.open.set(open)), () => undefined);
    const stop = this.api.display.onVisibility((open) => {
      heard = true;
      this.open.set(open);
    });
    inject(DestroyRef).onDestroy(stop);
    // Changing the window mode or remembering in Settings applies to a window that is already open (opening again does).
    effect(() => {
      this.settings.customerDisplayMode();
      this.settings.customerDisplayRemember();
      if (untracked(() => this.open())) void this.show();
    });
  }

  async show(): Promise<void> {
    try {
      await this.api?.display.show({ mode: this.settings.customerDisplayMode(), remember: this.settings.customerDisplayRemember() });
    } catch (error) {
      console.error('Could not open the customer display', error);
    }
  }

  async hide(): Promise<void> {
    try {
      await this.api?.display.hide();
    } catch (error) {
      console.error('Could not close the customer display', error);
    }
  }

  /** Shows the window when `on`, hides it otherwise (what a switch does). */
  set(on: boolean): Promise<void> {
    return on ? this.show() : this.hide();
  }

  toggle(): Promise<void> {
    return this.open() ? this.hide() : this.show();
  }

  /** Sends what the customer should see; the main process passes it on when the window is open (and keeps it for when it opens). */
  publish(state: CustomerDisplayState): void {
    this.api?.display.publish(state).catch((error: unknown) => console.error('Could not update the customer display', error));
  }
}
