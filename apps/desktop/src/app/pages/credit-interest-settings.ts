import { Component, inject, signal } from '@angular/core';
import { formatRate, parseRate } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { SettingRow, SettingsSection } from './settings-section';
import { BannerService } from '../core/banner';
import { CustomersService } from '../core/data/customers.service';
import { OnScreenKeypadDirective } from '../core/keypad';
import { AppSettings } from '../core/settings/app-settings.service';

/** Settings > Credit Interest: the monthly rates a customer's interest starts from when it is switched on for them. */
@Component({
  selector: 'app-credit-interest-settings',
  imports: [SettingRow, SettingsSection, OnScreenKeypadDirective, HlmButtonImports, HlmInputImports],
  template: `
    <app-settings-section title="Credit Interest">
        <form (submit)="$event.preventDefault(); save()">
          @for (field of fields; track field.id) {
            <div [appSetting]="field.label" settingKeywords="interest rate credit percent monthly customer" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
              <label [for]="field.id">{{ field.label }}</label>
              <div class="flex items-center gap-2">
                <input
                  hlmInput
                  [id]="field.id"
                  type="text"
                  class="w-24 text-right"
                  appOnScreenKeypad
                  [keypadWholeDigits]="3"
                  [keypadDecimals]="2"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                  [attr.aria-label]="field.label"
                  [forceInvalid]="invalid() && field.text() !== null && parse(field.text()!) === null"
                  [value]="field.text() ?? ''"
                  (input)="field.text.set($any($event.target).value)"
                />
                <span aria-hidden="true">% a month</span>
              </div>
            </div>
          }
          @if (invalid()) { <p class="text-destructive text-sm">Enter a rate between 0.01% and 100%</p> }
          <div class="mt-2 flex justify-end">
            <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Save</button>
          </div>
        </form>
    </app-settings-section>
  `,
})
export class CreditInterestSettings {
  protected readonly settings = inject(AppSettings);
  private readonly customers = inject(CustomersService);
  private readonly banner = inject(BannerService);

  protected readonly parse = parseRate;
  private readonly orderText = signal<string | null>(null);
  private readonly totalText = signal<string | null>(null);
  protected readonly fields = [
    { id: 'interest-order', label: 'Per sales order rate', text: this.orderText },
    { id: 'interest-total', label: 'Total credit rate', text: this.totalText },
  ];
  protected readonly invalid = signal(false);
  protected readonly saving = signal(false);

  constructor() {
    void this.customers.loadInterestDefaults().then(() => {
      const d = this.customers.interestDefaults();
      this.orderText.set(formatRate(d.orderRateBp));
      this.totalText.set(formatRate(d.totalRateBp));
    });
  }

  protected async save(): Promise<void> {
    const orderRateBp = parseRate(this.orderText() ?? '');
    const totalRateBp = parseRate(this.totalText() ?? '');
    this.invalid.set(orderRateBp === null || totalRateBp === null);
    if (orderRateBp === null || totalRateBp === null) return;
    this.saving.set(true);
    const ok = await this.customers.saveInterestDefaults({ orderRateBp, totalRateBp });
    this.saving.set(false);
    if (ok) this.banner.success('Interest rates saved', { key: 'interest-saved' });
    else this.banner.error('Could not save the rates', { key: 'interest-saved' });
  }
}
