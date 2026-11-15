import { Component, computed, inject, signal } from '@angular/core';
import { MAX_QUANTITY_UNITS, MILLI, parseQuantityMilli } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface QuantityContext {
  /** "Quantity of 3 items". */
  title: string;
}

/** Asks for one quantity to set on every selected order line; closes with it in thousandths, or nothing when cancelled. */
@Component({
  host: { class: 'contents' },
  imports: [HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, OnScreenKeypadDirective],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ title }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); apply()">
      <div class="flex flex-col gap-2">
        <label hlmLabel for="bulk-quantity">Set each to</label>
        <input
          hlmInput
          id="bulk-quantity"
          type="text"
          autocomplete="off"
          placeholder="1"
          appOnScreenKeypad
          [keypadWholeDigits]="5"
          [keypadDecimals]="3"
          [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
          [forceInvalid]="text().trim() !== '' && !quantity()"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
        />
      </div>
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn type="button" class="px-6" [disabled]="!quantity()" (click)="apply()">Apply</button>
    </hlm-dialog-footer>
  `,
})
export class QuantityForm {
  private readonly ref = inject<BrnDialogRef<number>>(BrnDialogRef);
  protected readonly settings = inject(AppSettings);
  protected readonly title = injectBrnDialogContext<QuantityContext>().title;
  protected readonly text = signal('');
  /** The typed amount in thousandths, or null while it is empty, zero, too big or not a number. */
  protected readonly quantity = computed(() => {
    const milli = parseQuantityMilli(this.text());
    return milli !== null && milli > 0 && milli <= MAX_QUANTITY_UNITS * MILLI ? milli : null;
  });

  protected apply(): void {
    const quantity = this.quantity();
    if (quantity) this.ref.close(quantity);
  }
}
