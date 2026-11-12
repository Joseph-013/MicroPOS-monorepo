import { Component, computed, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowBigUp, lucideCornerDownLeft, lucideDelete } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HoldRepeatDirective } from '../ui/hold-repeat.directive';

/** What a key sends: a printable character, or one of 'Backspace', 'Enter', 'Done'. */
export type KeyboardKey = string;

const NUMBER_ROW = [...'1234567890'];
const SYMBOL_ROW = [...'!@#$%^&*()'];
const ROW_1 = [...'qwertyuiop'];
const ROW_2 = [...'asdfghjkl'];
const ROW_3 = [...'zxcvbnm', ',', '.'];
const NUMPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

/**
 * A QWERTY on-screen keyboard with a row of numbers on top, shift (one-shot, also turns the number row into
 * symbols) and, optionally, a numpad on the right. It only reports key presses; `OnScreenKeyboardService` places it
 * next to the focused field and applies them. Pressing a key never takes focus away from the field.
 */
@Component({
  selector: 'app-on-screen-keyboard',
  imports: [NgIcon, HlmButtonImports, HoldRepeatDirective],
  providers: [provideIcons({ lucideArrowBigUp, lucideCornerDownLeft, lucideDelete })],
  host: {
    class: 'bg-popover text-popover-foreground border-border block border p-2 shadow-lg',
    '[class]': 'showNumpad() ? "w-[min(60rem,calc(100vw-1rem))]" : "w-[min(46rem,calc(100vw-1rem))]"',
    role: 'group',
    'aria-label': 'On-screen keyboard',
    // Never let a press on the panel (even on the gaps) move focus out of the field.
    '(mousedown)': '$event.preventDefault()',
  },
  template: `
    <div class="flex gap-3">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex gap-1.5">
          @for (key of numberRow(); track key) {
            <button hlmBtn variant="outline" type="button" class="min-w-0 flex-1 px-0" [attr.aria-label]="key" (click)="type(key)">{{ key }}</button>
          }
          <button
            hlmBtn
            variant="outline"
            type="button"
            class="min-w-0 flex-[1.6] px-0"
            appHoldRepeat
            aria-label="Backspace"
            (click)="pressed.emit('Backspace')"
            (held)="pressed.emit('Backspace')"
          >
            <ng-icon name="lucideDelete" size="20" strokeWidth="1.5" />
          </button>
        </div>
        <div class="flex gap-1.5">
          @for (key of row1(); track key) {
            <button hlmBtn variant="outline" type="button" class="min-w-0 flex-1 px-0" [attr.aria-label]="key" (click)="type(key)">{{ key }}</button>
          }
        </div>
        <div class="flex gap-1.5">
          @for (key of row2(); track key) {
            <button hlmBtn variant="outline" type="button" class="min-w-0 flex-1 px-0" [attr.aria-label]="key" (click)="type(key)">{{ key }}</button>
          }
          <button hlmBtn variant="outline" type="button" class="min-w-0 flex-[1.6] px-0" aria-label="Enter" (click)="pressed.emit('Enter')">
            <ng-icon name="lucideCornerDownLeft" size="20" strokeWidth="1.5" />
          </button>
        </div>
        <div class="flex gap-1.5">
          <button
            hlmBtn
            [variant]="shift() ? 'default' : 'outline'"
            type="button"
            class="min-w-0 flex-[1.6] px-0"
            aria-label="Shift"
            [attr.aria-pressed]="shift()"
            (click)="shift.set(!shift())"
          >
            <ng-icon name="lucideArrowBigUp" size="20" strokeWidth="1.5" />
          </button>
          @for (key of row3(); track key) {
            <button hlmBtn variant="outline" type="button" class="min-w-0 flex-1 px-0" [attr.aria-label]="key" (click)="type(key)">{{ key }}</button>
          }
        </div>
        <div class="flex gap-1.5">
          <button hlmBtn variant="outline" type="button" class="min-w-0 flex-1 px-0" aria-label="@" (click)="type('@')">@</button>
          <button hlmBtn variant="outline" type="button" class="min-w-0 flex-[6] px-0" aria-label="Space" (click)="type(' ')"></button>
          <button hlmBtn variant="outline" type="button" class="min-w-0 flex-1 px-0" aria-label="-" (click)="type('-')">-</button>
          <button hlmBtn type="button" class="min-w-0 flex-[2] px-0" aria-label="Done" (click)="pressed.emit('Done')">Done</button>
        </div>
      </div>

      @if (showNumpad()) {
        <div class="grid w-44 shrink-0 grid-cols-3 content-start gap-1.5" role="group" aria-label="Numpad">
          @for (key of numpad; track key) {
            <button hlmBtn variant="outline" type="button" class="px-0 text-lg" [attr.aria-label]="'Numpad ' + key" (click)="pressed.emit(key)">{{ key }}</button>
          }
          <button hlmBtn variant="outline" type="button" class="col-span-2 px-0 text-lg" aria-label="Numpad 0" (click)="pressed.emit('0')">0</button>
          <button hlmBtn variant="outline" type="button" class="px-0 text-lg" aria-label="Numpad ." (click)="pressed.emit('.')">.</button>
        </div>
      }
    </div>
  `,
})
export class OnScreenKeyboard {
  /** Show a numpad beside the letters. */
  readonly showNumpad = input(false);
  readonly pressed = output<KeyboardKey>();

  protected readonly numpad = NUMPAD;
  protected readonly shift = signal(false);

  protected readonly numberRow = computed(() => (this.shift() ? SYMBOL_ROW : NUMBER_ROW));
  protected readonly row1 = computed(() => this.cased(ROW_1));
  protected readonly row2 = computed(() => this.cased(ROW_2));
  protected readonly row3 = computed(() => this.cased(ROW_3));

  /** Sends a character; shift applies to one key only. */
  protected type(key: string): void {
    this.pressed.emit(key);
    this.shift.set(false);
  }

  private cased(keys: string[]): string[] {
    return this.shift() ? keys.map((k) => k.toUpperCase()) : keys;
  }
}
