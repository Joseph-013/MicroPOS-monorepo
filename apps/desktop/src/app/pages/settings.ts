import { Component, inject } from '@angular/core';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { AppSettings, CUSTOMER_DISPLAY_SCALES } from '../core/settings/app-settings.service';

/** Per-device settings. */
@Component({
  imports: [HlmCardImports, HlmSelectImports, HlmSwitchImports],
  template: `
    <h1 class="mb-3 text-2xl">Settings</h1>
    <section hlmCard class="max-w-xl">
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
    <section hlmCard class="mt-3 max-w-xl">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Customer Display</h2>
      </div>
      <div hlmCardContent>
        <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
          <span>Open on start</span>
          <hlm-switch [checked]="settings.customerDisplayOnStart()" (checkedChange)="settings.customerDisplayOnStart.set($event)" />
        </label>
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
  protected readonly settings = inject(AppSettings);
  protected readonly scales = CUSTOMER_DISPLAY_SCALES;
  protected setScale(scale: number | null | undefined): void {
    if (typeof scale === 'number') this.settings.customerDisplayScale.set(scale);
  }
  protected readonly scaleLabel = (scale: number): string => `${scale}%`;
}
