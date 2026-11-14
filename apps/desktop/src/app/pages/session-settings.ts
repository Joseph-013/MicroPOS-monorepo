import { Component, effect, inject, signal } from '@angular/core';
import { isSessionTimeoutMinutes, MAX_SESSION_TIMEOUT_MINUTES } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { SettingRow, SettingsSection } from './settings-section';
import { ActivityMonitor } from '../core/auth/activity-monitor';
import { BannerService } from '../core/banner';
import { OnScreenKeypadDirective } from '../core/keypad';
import { AppSettings } from '../core/settings/app-settings.service';

/**
 * Settings > Auto sign-out (needs `settings.manage`): after how many minutes without any touch, click or key the till (and
 * every paired phone) signs the person out and shows the sign-in screen. Blank is off, which is how it starts.
 */
@Component({
  selector: 'app-session-settings',
  imports: [SettingRow, SettingsSection, OnScreenKeypadDirective, HlmButtonImports, HlmInputImports],
  template: `
    <app-settings-section title="Auto sign-out">
      <form (submit)="$event.preventDefault(); save()">
        <div appSetting="Sign out after" settingKeywords="session expiry inactivity idle timeout lock automatic minutes" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <label for="session-minutes">Sign out after</label>
          <div class="flex items-center gap-2">
            <input
              hlmInput
              id="session-minutes"
              type="text"
              class="w-24 text-right"
              placeholder="Off"
              appOnScreenKeypad
              [keypadWholeDigits]="4"
              [keypadDecimals]="0"
              [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'numeric'"
              [forceInvalid]="invalid()"
              [value]="minutes()"
              (input)="minutes.set($any($event.target).value)"
            />
            <span aria-hidden="true">minutes idle</span>
          </div>
        </div>
        @if (invalid()) { <p class="text-destructive text-sm">Enter a whole number of minutes from 1 to {{ max }}, or leave it blank to turn it off</p> }
        <div class="mt-2 flex justify-end">
          <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Save</button>
        </div>
      </form>
    </app-settings-section>
  `,
})
export class SessionSettingsCard {
  protected readonly settings = inject(AppSettings);
  private readonly monitor = inject(ActivityMonitor);
  private readonly banner = inject(BannerService);

  protected readonly max = MAX_SESSION_TIMEOUT_MINUTES;
  protected readonly minutes = signal('');
  protected readonly invalid = signal(false);
  protected readonly saving = signal(false);
  private shown = false;

  constructor() {
    // The saved limit fills the field once it is known (it arrives with the first report after sign-in).
    effect(() => {
      const limit = this.monitor.timeoutMinutes();
      if (!this.shown && limit !== null) this.minutes.set(String(limit));
      this.shown = this.shown || limit !== null;
    });
  }

  protected async save(): Promise<void> {
    const text = this.minutes().trim();
    const value = text === '' ? null : /^\d+$/.test(text) ? Number(text) : NaN;
    const valid = value === null || isSessionTimeoutMinutes(value);
    this.invalid.set(!valid);
    if (!valid) return;
    this.saving.set(true);
    const ok = await this.monitor.setTimeout(value);
    this.saving.set(false);
    if (ok) this.banner.success(value === null ? 'Auto sign-out is off' : `Signing out after ${value} ${value === 1 ? 'minute' : 'minutes'} idle`, { key: 'session-saved' });
    else this.banner.error('Could not save it', { key: 'session-saved' });
  }
}
