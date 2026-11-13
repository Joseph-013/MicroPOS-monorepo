import { Component, computed, inject, signal } from '@angular/core';
import { formatRate, INTEREST_MODE_LABELS, INTEREST_MODES, type CustomerField, type CustomerRecord, type InterestMode, parseRate } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { CustomersService } from '../../core/data/customers.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface CustomerFormContext {
  /** The customer being edited; absent when adding. */
  customer?: CustomerRecord;
}

/** Add / edit dialog of the Customers page. Closes with `true` once the change is saved. */
@Component({
  host: { class: 'contents' },
  imports: [OnScreenKeypadDirective, HlmAlertDialogImports, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, HlmSelectImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ customer ? 'Edit customer' : 'Add customer' }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="cu-name">Name</label>
        <input hlmInput id="cu-name" type="text" [forceInvalid]="invalid('name')" [value]="name()" (input)="name.set($any($event.target).value)" />
        @if (errorFor('name'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="cu-phone">Phone</label>
        <input hlmInput id="cu-phone" type="text" [forceInvalid]="invalid('phone')" [value]="phone()" (input)="phone.set($any($event.target).value)" />
        @if (errorFor('phone'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="cu-limit">Credit limit</label>
        <input
          hlmInput
          id="cu-limit"
          type="text"
          placeholder="No limit"
          appOnScreenKeypad
          [keypadWholeDigits]="7"
          [keypadDecimals]="2"
          [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
          [forceInvalid]="invalid('creditLimit')"
          [value]="creditLimit()"
          (input)="creditLimit.set($any($event.target).value)"
        />
        @if (errorFor('creditLimit'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel id="cu-interest-label">Interest on credit</label>
        <hlm-select [value]="interestMode()" (valueChange)="setMode($event)" [itemToString]="modeLabel">
          <hlm-select-trigger class="w-full" aria-labelledby="cu-interest-label">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            @for (mode of modes; track mode) {
              <hlm-select-item [value]="mode">{{ modeLabel(mode) }}</hlm-select-item>
            }
          </hlm-select-content>
        </hlm-select>
      </div>
      @if (interestMode() !== 'none') {
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="cu-rate">Rate per month (%)</label>
          <input
            hlmInput
            id="cu-rate"
            type="text"
            appOnScreenKeypad
            [keypadWholeDigits]="3"
            [keypadDecimals]="2"
            [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
            [forceInvalid]="invalid('interest')"
            [value]="rate()"
            (input)="rate.set($any($event.target).value)"
          />
          @if (errorFor('interest'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      }
      <div class="flex flex-col gap-2">
        <label hlmLabel for="cu-note">Note</label>
        <input hlmInput id="cu-note" type="text" [forceInvalid]="invalid('note')" [value]="note()" (input)="note.set($any($event.target).value)" />
        @if (errorFor('note'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer class="sm:justify-between">
      @if (customer) {
        <hlm-alert-dialog>
          <button hlmAlertDialogTrigger hlmBtn variant="destructive" type="button" class="px-5">Delete</button>
          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
            <hlm-alert-dialog-header>
              <h3 hlmAlertDialogTitle>Delete {{ customer.name }}?</h3>
              <p hlmAlertDialogDescription>Their past orders and account history are kept. A customer who owes or is owed money cannot be deleted.</p>
            </hlm-alert-dialog-header>
            <hlm-alert-dialog-footer>
              <button hlmAlertDialogCancel type="button">Cancel</button>
              <button hlmAlertDialogAction variant="destructive" type="button" (click)="remove()">Delete</button>
            </hlm-alert-dialog-footer>
          </hlm-alert-dialog-content>
        </hlm-alert-dialog>
      } @else {
        <span></span>
      }
      <div class="flex gap-2">
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
        <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">Save</button>
      </div>
    </hlm-dialog-footer>
  `,
})
export class CustomerForm {
  protected readonly settings = inject(AppSettings);
  private readonly customers = inject(CustomersService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly customer = injectBrnDialogContext<CustomerFormContext>().customer;

  protected readonly name = signal(this.customer?.name ?? '');
  protected readonly phone = signal(this.customer?.phone ?? '');
  protected readonly note = signal(this.customer?.note ?? '');
  protected readonly creditLimit = signal(formatCentsInput(this.customer?.creditLimit ?? null));
  protected readonly modes = ['none', ...INTEREST_MODES] as const;
  protected readonly interestMode = signal<InterestMode | 'none'>(this.customer?.interestMode ?? 'none');
  protected readonly rate = signal(this.customer?.interestRateBp ? formatRate(this.customer.interestRateBp) : '');
  protected readonly modeLabel = (mode: InterestMode | 'none'): string => (mode === 'none' ? 'No interest' : INTEREST_MODE_LABELS[mode]);
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: CustomerField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  constructor() {
    void this.customers.loadInterestDefaults();
  }

  /** Switching interest on starts from the saved default rate for that kind. */
  protected setMode(mode: InterestMode | 'none' | null | undefined): void {
    const next = mode ?? 'none';
    if (next === this.interestMode()) return;
    this.interestMode.set(next);
    if (next !== 'none') {
      const defaults = this.customers.interestDefaults();
      this.rate.set(formatRate(next === 'order' ? defaults.orderRateBp : defaults.totalRateBp));
    }
  }

  protected invalid(field: CustomerField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: CustomerField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    if (!this.name().trim()) return void this.problem.set({ field: 'name', error: 'Enter a name' });
    const limitText = this.creditLimit().trim();
    const limit = limitText === '' ? null : parseCents(limitText);
    if (limitText !== '' && limit === null) return void this.problem.set({ field: 'creditLimit', error: 'Enter a valid credit limit' });
    const mode = this.interestMode() === 'none' ? null : (this.interestMode() as InterestMode);
    const rateBp = mode === null ? null : parseRate(this.rate());
    if (mode !== null && rateBp === null) return void this.problem.set({ field: 'interest', error: 'Enter a rate between 0.01% and 100%' });
    this.saving.set(true);
    const result = await this.customers.save(this.customer?.id ?? null, { name: this.name(), phone: this.phone() || null, note: this.note() || null, creditLimit: limit, interestMode: mode, interestRateBp: rateBp });
    this.saving.set(false);
    if (result.ok) this.ref.close(true);
    else this.problem.set({ field: result.field, error: result.error });
  }

  protected async remove(): Promise<void> {
    if (!this.customer) return;
    const result = await this.customers.remove([this.customer.id]);
    if (result?.removed) this.ref.close(true);
    else this.problem.set({ field: null, error: result?.blocked.length ? 'This customer still owes or is owed money' : 'Could not delete the customer' });
  }
}
