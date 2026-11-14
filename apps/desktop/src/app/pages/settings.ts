import { Component, inject } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { LogsSettings } from './logs-settings';
import { PrinterSettingsCard } from './printer-settings';
import { WindowSettings } from './window-settings';
import { CreditAlertSettingsCard } from './credit-alert-settings';
import { CreditInterestSettings } from './credit-interest-settings';
import { AuthService } from '../core/auth/auth.service';
import { ChangePinDialog } from '../core/auth/change-pin-dialog';
import { BannerService } from '../core/banner';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { THEME_LABELS, THEME_MODES, type ThemeMode, ThemeService } from '../core/theme.service';
import { CustomerDisplayService } from '../core/customer-display.service';
import { CUSTOMER_DISPLAY_MODES, type CustomerDisplayMode } from '@micropos/core';
import { AppSettings, CUSTOMER_DISPLAY_SCALES } from '../core/settings/app-settings.service';

/** Per-device settings. */
@Component({
  imports: [LogsSettings, PrinterSettingsCard, WindowSettings, CreditAlertSettingsCard, CreditInterestSettings, HlmButtonImports, HlmCardImports, HlmSelectImports, HlmSwitchImports],
  template: `
    <h1 class="mb-3 text-2xl">Settings</h1>
    @if (auth.user(); as user) {
      <section hlmCard class="mb-3 max-w-xl">
        <div hlmCardHeader>
          <h2 hlmCardTitle>Account</h2>
        </div>
        <div hlmCardContent>
          <div class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
            <span>Signed in as {{ user.name }}</span>
            <button hlmBtn variant="outline" type="button" class="px-4" (click)="changePin()">Change PIN</button>
          </div>
          <div class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
            <span id="theme-label">Theme</span>
            <hlm-select [value]="theme.mode()" (valueChange)="setTheme($event)" [itemToString]="themeLabel">
              <hlm-select-trigger class="w-40" aria-labelledby="theme-label">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (mode of themes; track mode) {
                  <hlm-select-item [value]="mode">{{ themeLabel(mode) }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>
        </div>
      </section>
    }
    @if (auth.can('customers.manage')) {
      <app-credit-interest-settings />
      <app-credit-alert-settings />
    }
    <section hlmCard class="mt-3 max-w-xl">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Input</h2>
      </div>
      <div hlmCardContent>
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>On-screen keyboard</span>
          <hlm-switch [checked]="settings.onScreenKeyboard()" (checkedChange)="settings.onScreenKeyboard.set($event)" />
        </label>
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>Numpad beside keyboard</span>
          <hlm-switch
            [checked]="settings.showNumpad()"
            [disabled]="!settings.onScreenKeyboard()"
            (checkedChange)="settings.showNumpad.set($event)"
          />
        </label>
      </div>
    </section>
    @if (auth.can('settings.manage')) {
      <app-printer-settings />
      <app-window-settings />
      <app-logs-settings />
    }
    <section hlmCard class="mt-3 max-w-xl">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Customer Display</h2>
      </div>
      <div hlmCardContent>
        <!-- Shows or hides the customer-facing window now (it follows the window being closed from its own title bar). -->
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>Show customer display</span>
          <hlm-switch aria-label="Show customer display" [checked]="display.open()" (checkedChange)="display.set($event)" />
        </label>
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>Open on start</span>
          <hlm-switch [checked]="settings.customerDisplayOnStart()" (checkedChange)="settings.customerDisplayOnStart.set($event)" />
        </label>
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>Remember monitor and position</span>
          <hlm-switch [checked]="settings.customerDisplayRemember()" (checkedChange)="settings.customerDisplayRemember.set($event)" />
        </label>
        <div class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span id="display-mode-label">Window mode</span>
          <hlm-select [value]="settings.customerDisplayMode()" (valueChange)="setMode($event)" [itemToString]="modeLabel">
            <hlm-select-trigger class="w-40" aria-labelledby="display-mode-label">
              <hlm-select-value />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (mode of modes; track mode) {
                <hlm-select-item [value]="mode">{{ modeLabel(mode) }}</hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select>
        </div>
        <div class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span id="display-scale-label">UI scale</span>
          <hlm-select [value]="settings.customerDisplayScale()" (valueChange)="setScale($event)" [itemToString]="scaleLabel">
            <hlm-select-trigger class="w-32" aria-labelledby="display-scale-label">
              <hlm-select-value />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (scale of scales; track scale) {
                <hlm-select-item [value]="scale">{{ scaleLabel(scale) }}</hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select>
        </div>
      </div>
    </section>
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly themes = THEME_MODES;
  protected readonly themeLabel = (mode: ThemeMode): string => THEME_LABELS[mode];
  protected setTheme(mode: ThemeMode | null | undefined): void {
    if (mode) this.theme.set(mode);
  }
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);
  protected changePin(): void {
    this.dialogs
      .open<boolean>(ChangePinDialog, { id: 'change-pin', contentClass: 'w-[min(24rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)]' })
      .closed$.subscribe((changed) => {
        if (changed) this.banner.success('PIN changed', { key: 'pin-changed' });
      });
  }
  protected readonly settings = inject(AppSettings);
  protected readonly display = inject(CustomerDisplayService);
  protected readonly scales = CUSTOMER_DISPLAY_SCALES;
  protected readonly modes = CUSTOMER_DISPLAY_MODES;
  protected readonly modeLabel = (mode: CustomerDisplayMode): string => ({ windowed: 'Windowed', maximized: 'Maximized', fullscreen: 'Full screen' })[mode] ?? '';
  protected setMode(mode: CustomerDisplayMode | null | undefined): void {
    if (mode) this.settings.customerDisplayMode.set(mode);
  }
  protected setScale(scale: number | null | undefined): void {
    if (typeof scale === 'number') this.settings.customerDisplayScale.set(scale);
  }
  protected readonly scaleLabel = (scale: number): string => `${scale}%`;
}
