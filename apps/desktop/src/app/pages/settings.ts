import { Component, inject } from '@angular/core';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { AppSettings } from '../core/settings/app-settings.service';

/** Per-device settings. */
@Component({
  imports: [HlmCardImports, HlmSwitchImports],
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
  `,
})
export class SettingsPage {
  protected readonly settings = inject(AppSettings);
}
