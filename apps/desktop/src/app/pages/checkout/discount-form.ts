import { Component, computed, inject, signal } from '@angular/core';
import { discountCents, type DiscountSpec, formatDiscount, MAX_DISCOUNT_REASON, parseDiscount } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { MoneyPipe } from '../../core/money.pipe';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface DiscountContext {
  /** "Discount on Rice" or "Discount on the order". */
  title: string;
  /** What the discount comes off, in cents (a line's price, or the order after its line discounts). */
  base: number;
  current: DiscountSpec | null;
  reason: string;
}

/** What the dialog closes with: the discount (null removes it) and the reason; nothing when cancelled. */
export interface DiscountOutcome {
  spec: DiscountSpec | null;
  reason: string;
}

/** Asks for a discount as an amount or a percent, and optionally why. */
@Component({
  host: { class: 'contents' },
  imports: [HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, OnScreenKeypadDirective, MoneyPipe],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ title }}</h3>
      <p hlmDialogDescription>Comes off {{ base | money }}.</p>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); apply()">
      <div class="grid grid-cols-2 gap-2" role="group" aria-label="Kind of discount">
        <button hlmBtn type="button" [variant]="mode() === 'amount' ? 'default' : 'outline'" [attr.aria-pressed]="mode() === 'amount'" (click)="setMode('amount')">Amount</button>
        <button hlmBtn type="button" [variant]="mode() === 'percent' ? 'default' : 'outline'" [attr.aria-pressed]="mode() === 'percent'" (click)="setMode('percent')">Percent</button>
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="discount-value">{{ mode() === 'amount' ? 'Amount off' : 'Percent off' }}</label>
        <input
          hlmInput
          id="discount-value"
          type="text"
          autocomplete="off"
          [placeholder]="mode() === 'amount' ? '0.00' : '0'"
          appOnScreenKeypad
          [keypadWholeDigits]="mode() === 'amount' ? 7 : 3"
          [keypadDecimals]="2"
          [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
          [forceInvalid]="text().trim() !== '' && !spec()"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
        />
        @if (spec()) {
          <p class="text-muted-foreground text-sm">Takes off {{ cents() | money }}@if (spec()!.value && cents() < wanted()) { (the most it can) }</p>
        }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="discount-reason">Reason (optional)</label>
        <input hlmInput id="discount-reason" type="text" autocomplete="off" [attr.maxlength]="maxReason" [value]="reason()" (input)="reason.set($any($event.target).value)" />
      </div>
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      @if (current) {
        <button hlmBtn variant="outline" type="button" class="px-5 sm:mr-auto" (click)="remove()">Remove discount</button>
      }
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn type="button" class="px-6" [disabled]="!spec() || cents() === 0" (click)="apply()">Apply</button>
    </hlm-dialog-footer>
  `,
})
export class DiscountForm {
  private readonly context = injectBrnDialogContext<DiscountContext>();
  private readonly ref = inject<BrnDialogRef<DiscountOutcome>>(BrnDialogRef);
  protected readonly settings = inject(AppSettings);

  protected readonly title = this.context.title;
  protected readonly base = this.context.base;
  protected readonly current = this.context.current;
  protected readonly maxReason = MAX_DISCOUNT_REASON;

  protected readonly mode = signal<DiscountSpec['mode']>(this.context.current?.mode ?? 'percent');
  protected readonly text = signal(this.context.current ? formatDiscount(this.context.current).replace('%', '') : '');
  protected readonly reason = signal(this.context.reason);

  protected readonly spec = computed(() => parseDiscount(this.text(), this.mode()));
  /** What the discount takes off, never more than the base. */
  protected readonly cents = computed(() => discountCents(this.spec(), this.base));
  /** What it would take off without that limit. */
  protected readonly wanted = computed(() => {
    const s = this.spec();
    return !s ? 0 : s.mode === 'amount' ? s.value : Math.round((this.base * s.value) / 10_000);
  });

  protected setMode(mode: DiscountSpec['mode']): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.text.set('');
  }

  protected apply(): void {
    const spec = this.spec();
    if (!spec || this.cents() === 0) return;
    this.ref.close({ spec, reason: this.reason().trim() });
  }

  protected remove(): void {
    this.ref.close({ spec: null, reason: this.reason().trim() });
  }
}
