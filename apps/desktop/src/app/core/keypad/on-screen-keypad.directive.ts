import { Overlay } from '@angular/cdk/overlay';
import { DestroyRef, Directive, effect, ElementRef, inject, input } from '@angular/core';
import { AppSettings } from '../settings/app-settings.service';
import { openNumericKeypad } from './numeric-keypad';

/**
 * Shows a floating on-screen keypad next to a text input while it is focused, when the "On-screen keyboard"
 * setting is on. Keys edit the input's value (and fire its `input` event, so bindings update); Done leaves the
 * field, which is what commits it. The panel opens below the field, or above / right / left when there is no room.
 *
 *   <input appOnScreenKeypad [keypadWholeDigits]="7" [keypadDecimals]="2" />
 *
 * Use it on `type="text"` inputs when you need to set the digit limits yourself. Plain `type="number"` fields
 * (and `inputmode="decimal|numeric"`) get a numpad automatically from `OnScreenKeyboardService`, with no directive.
 */
@Directive({
  selector: 'input[appOnScreenKeypad]',
  host: {
    '(focus)': 'open()',
    '(blur)': 'close()',
    '(keydown.escape)': 'close()',
    // Tells the global keyboard service that this field manages its own keypad.
    'data-keypad': '',
  },
})
export class OnScreenKeypadDirective {
  /** Most digits before the decimal point. */
  readonly keypadWholeDigits = input(7);
  /** Most digits after the decimal point; 0 for whole numbers only. */
  readonly keypadDecimals = input(2);

  private readonly field = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly overlay = inject(Overlay);
  private readonly settings = inject(AppSettings);
  private session: { close(): void } | null = null;

  constructor() {
    // Turning the setting off while a keypad is showing closes it.
    effect(() => {
      if (!this.settings.onScreenKeyboard()) this.close();
    });
    inject(DestroyRef).onDestroy(() => this.close());
  }

  protected open(): void {
    if (this.session || !this.settings.onScreenKeyboard()) return;
    this.session = openNumericKeypad(this.overlay, this.field, () => ({
      wholeDigits: this.keypadWholeDigits(),
      decimals: this.keypadDecimals(),
    }));
  }

  protected close(): void {
    this.session?.close();
    this.session = null;
  }
}
