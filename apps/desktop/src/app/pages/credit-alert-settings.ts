import { Component, inject, signal } from '@angular/core';
import { isAlertDays } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { SettingRow, SettingsSection } from './settings-section';
import { BannerService } from '../core/banner';
import { CustomersService } from '../core/data/customers.service';
import { OnScreenKeypadDirective } from '../core/keypad';
import { formatCentsInput, parseCents } from '../core/money-input';
import { AppSettings } from '../core/settings/app-settings.service';

/** Settings > Credit Alerts: when a customer is counted on the Customers link in the navigation. A blank limit is off. */
@Component({
  selector: 'app-credit-alert-settings',
  imports: [SettingRow, SettingsSection, OnScreenKeypadDirective, HlmButtonImports, HlmInputImports],
  template: `
    <app-settings-section title="Credit Alerts">
        <form (submit)="$event.preventDefault(); save()">
          <div appSetting="Owes more than" settingKeywords="credit alert limit amount customer badge" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
            <label for="alert-amount">Owes more than</label>
            <input
              hlmInput
              id="alert-amount"
              type="text"
              class="w-36 text-right"
              placeholder="Off"
              appOnScreenKeypad
              [keypadWholeDigits]="7"
              [keypadDecimals]="2"
              [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
              [forceInvalid]="invalid() && amountBad()"
              [value]="amount()"
              (input)="amount.set($any($event.target).value)"
            />
          </div>
          <div appSetting="Unpaid for more than" settingKeywords="credit alert limit days overdue customer badge" class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
            <label for="alert-days">Unpaid for more than</label>
            <div class="flex items-center gap-2">
              <input
                hlmInput
                id="alert-days"
                type="text"
                class="w-24 text-right"
                placeholder="Off"
                appOnScreenKeypad
                [keypadWholeDigits]="4"
                [keypadDecimals]="0"
                [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'numeric'"
                [forceInvalid]="invalid() && daysBad()"
                [value]="days()"
                (input)="days.set($any($event.target).value)"
              />
              <span aria-hidden="true">days</span>
            </div>
          </div>
          @if (invalid()) { <p class="text-destructive text-sm">Enter an amount and a number of days, or leave a limit blank to turn it off</p> }
          <div class="mt-2 flex justify-end">
            <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Save</button>
          </div>
        </form>
    </app-settings-section>
  `,
})
export class CreditAlertSettingsCard {
  protected readonly settings = inject(AppSettings);
  private readonly customers = inject(CustomersService);
  private readonly banner = inject(BannerService);

  protected readonly amount = signal('');
  protected readonly days = signal('');
  protected readonly invalid = signal(false);
  protected readonly saving = signal(false);

  constructor() {
    void this.customers.loadAlertSettings().then((s) => {
      this.amount.set(formatCentsInput(s.amount));
      this.days.set(s.days === null ? '' : String(s.days));
    });
  }

  private parsedAmount(): number | null | undefined {
    const text = this.amount().trim();
    if (text === '') return null;
    const cents = parseCents(text);
    return cents !== null && cents > 0 ? cents : undefined;
  }
  private parsedDays(): number | null | undefined {
    const text = this.days().trim();
    if (text === '') return null;
    const n = Number(text);
    return /^\d+$/.test(text) && isAlertDays(n) ? n : undefined;
  }
  protected amountBad = (): boolean => this.parsedAmount() === undefined;
  protected daysBad = (): boolean => this.parsedDays() === undefined;

  protected async save(): Promise<void> {
    const amount = this.parsedAmount();
    const days = this.parsedDays();
    this.invalid.set(amount === undefined || days === undefined);
    if (amount === undefined || days === undefined) return;
    this.saving.set(true);
    const ok = await this.customers.saveAlertSettings({ amount, days });
    this.saving.set(false);
    if (ok) this.banner.success('Credit alerts saved', { key: 'alerts-saved' });
    else this.banner.error('Could not save the limits', { key: 'alerts-saved' });
  }
}
