import { Component, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideDelete } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HoldRepeatDirective } from '../ui/hold-repeat.directive';

/** What a key sends: a digit, '.', 'back' (delete one character) or 'done'. */
export type KeypadKey = string;

/**
 * The keypad panel itself: digits, a decimal point, backspace (hold to repeat) and Done.
 * It only reports key presses; `OnScreenKeypadDirective` places it next to an input and applies them.
 * Pressing a key never takes focus away from the input (see the kiosk focus rule).
 */
@Component({
  selector: 'app-on-screen-keypad',
  imports: [NgIcon, HlmButtonImports, HoldRepeatDirective],
  providers: [provideIcons({ lucideCheck, lucideDelete })],
  host: {
    class: 'bg-popover text-popover-foreground border-border block w-60 border p-2 shadow-lg',
    role: 'group',
    'aria-label': 'On-screen keypad',
    // Never let a press on the panel (even on the gaps) move focus out of the input.
    '(mousedown)': '$event.preventDefault()',
  },
  template: `
    <div class="grid grid-cols-3 gap-2">
      @for (key of keys; track key) {
        @if (key === 'back') {
          <button
            hlmBtn
            variant="outline"
            type="button"
            appHoldRepeat
            aria-label="Delete"
            (click)="pressed.emit('back')"
            (held)="pressed.emit('back')"
          >
            <ng-icon name="lucideDelete" size="20" strokeWidth="1.5" />
          </button>
        } @else {
          <button hlmBtn variant="outline" type="button" class="text-lg" [attr.aria-label]="key" (click)="pressed.emit(key)">{{ key }}</button>
        }
      }
      <button hlmBtn type="button" class="col-span-3" aria-label="Done" (click)="pressed.emit('done')">
        <ng-icon name="lucideCheck" size="20" strokeWidth="2" />
        Done
      </button>
    </div>
  `,
})
export class OnScreenKeypad {
  protected readonly keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back'];
  readonly pressed = output<KeypadKey>();
}
