import { ComponentRef, DestroyRef, effect, inject, Service } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { FLOATING_GAP, FLOATING_POSITIONS, type NumericKeypadHandle, type NumericLimits, openNumericKeypad } from '../keypad';
import { AppSettings } from '../settings/app-settings.service';
import { deleteBackward, insertText, type TextField } from './input-editing';
import { OnScreenKeyboard } from './on-screen-keyboard';

const TEXT_TYPES = /^(text|search|email|url|tel|password)$/;
/** Fields (or containers of fields) that never get the QWERTY keyboard: numeric keypad fields, and explicit opt-outs. */
const OPT_OUT = '[data-keypad], [data-no-keyboard]';

/** Number inputs, and text inputs that ask for a numeric soft keyboard, get the keypad rather than the QWERTY keyboard. */
function isNumeric(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  return field instanceof HTMLInputElement && (field.type === 'number' || /^(decimal|numeric)$/.test(field.getAttribute('inputmode') ?? ''));
}

/** Digit limits from what the field itself declares: `max` for the whole digits, `step` for the decimals. */
function numericLimits(field: HTMLInputElement): NumericLimits {
  const max = field.getAttribute('max');
  const step = field.getAttribute('step');
  const decimals = step === 'any' ? 3 : /\.(\d+)$/.exec(step ?? '')?.[1].length ?? 0;
  return { wholeDigits: max ? Math.max(1, String(Math.trunc(Math.abs(Number(max)) || 0)).length) : 9, decimals };
}

/**
 * Shows an on-screen keyboard for every text field while the "On-screen keyboard" setting is on: the QWERTY
 * keyboard for text, search, email, url, tel and password inputs and textareas, and the numeric keypad for number
 * inputs and fields marked `inputmode="decimal"` or `"numeric"`. It listens for focus on the whole document, so pages
 * and components need no code of their own. The keyboard floats next to the focused field (below, above, right or
 * left, whichever fits), and pushes back into view rather than being clipped.
 *
 * Opt out with `data-no-keyboard` on a field or its container. Fields that use `appOnScreenKeypad` mark themselves
 * `data-keypad` and are left to it. Inject once at the root so listening starts at launch.
 */
@Service()
export class OnScreenKeyboardService {
  private readonly overlay = inject(Overlay);
  private readonly settings = inject(AppSettings);

  private ref: OverlayRef | null = null;
  private keyboard: ComponentRef<OnScreenKeyboard> | null = null;
  private field: TextField | null = null;
  /** Set while the numeric keypad (not the QWERTY keyboard) is showing. */
  private numeric: (NumericKeypadHandle & { restore(): void }) | null = null;
  /** The field's own `inputmode`, restored when the keyboard closes. */
  private savedInputMode: string | null = null;

  constructor() {
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('focusin', this.onFocusIn, true);
      document.removeEventListener('focusout', this.onFocusOut, true);
      document.removeEventListener('keydown', this.onKeyDown, true);
      this.close();
    });

    effect(() => {
      if (!this.settings.onScreenKeyboard()) this.close();
    });
    effect(() => {
      // Read the signal first: with `this.keyboard?.setInput(..., signal())` nothing is read while no keyboard is open,
      // so the effect would never learn about later changes.
      const showNumpad = this.settings.showNumpad();
      this.keyboard?.setInput('showNumpad', showNumpad);
    });
  }

  private eligible(target: EventTarget | null): target is TextField {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
    if (target.readOnly || target.disabled || target.closest(OPT_OUT)) return false;
    return target instanceof HTMLTextAreaElement || TEXT_TYPES.test(target.type) || isNumeric(target);
  }

  private readonly onFocusIn = (event: FocusEvent): void => {
    if (!this.settings.onScreenKeyboard()) return;
    if (this.eligible(event.target)) this.open(event.target);
    else if (!this.inside(event.target as Node)) this.close();
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    if (!this.field) return;
    const next = event.relatedTarget as Node | null;
    // Focus moving to another field is handled by that field's focusin; moving into the keyboard keeps it open.
    if (next && (this.inside(next) || this.eligible(next))) return;
    this.close();
  };

  /** True if `node` is inside whichever keyboard or keypad is showing. */
  private inside(node: Node | null): boolean {
    return !!node && (this.ref?.overlayElement.contains(node) || this.numeric?.contains(node) || false);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.field) this.close();
  };

  private open(field: TextField): void {
    if (this.field === field && (this.ref || this.numeric)) return;
    this.close();
    this.field = field;
    if (field instanceof HTMLInputElement && isNumeric(field)) {
      this.openNumeric(field);
      return;
    }
    // Keep the OS keyboard (on touch devices) from popping up on top of this one.
    this.savedInputMode = field.getAttribute('inputmode');
    field.setAttribute('inputmode', 'none');

    this.ref = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(field)
        .withPositions(FLOATING_POSITIONS)
        .withPush(true)
        .withViewportMargin(FLOATING_GAP)
        .withFlexibleDimensions(false),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
    this.keyboard = this.ref.attach(new ComponentPortal(OnScreenKeyboard));
    this.keyboard.setInput('showNumpad', this.settings.showNumpad());
    this.keyboard.instance.pressed.subscribe((key) => this.press(key));
  }

  /**
   * Numeric fields get the keypad. A `type="number"` field cannot show a half-typed "3.", so while the keypad is up
   * it is switched to text and put back when the keypad closes.
   */
  private openNumeric(field: HTMLInputElement): void {
    const wasNumber = field.type === 'number';
    const originalValue = field.value;
    const limits = numericLimits(field);
    this.savedInputMode = field.getAttribute('inputmode');
    field.setAttribute('inputmode', 'none');
    if (wasNumber) field.type = 'text';
    const keypad = openNumericKeypad(this.overlay, field, () => limits);
    this.numeric = {
      ...keypad,
      restore: () => {
        if (wasNumber) {
          field.value = field.value.replace(/\.$/, ''); // "3." is not a number; "3" is
          field.type = 'number';
          if (field.value !== '' && field.validity.badInput) field.value = '';
        }
        if (field.value !== originalValue) field.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }

  private close(): void {
    if (this.numeric) {
      this.numeric.close();
      this.numeric.restore();
      this.numeric = null;
    }
    if (this.field) {
      if (this.savedInputMode === null) this.field.removeAttribute('inputmode');
      else this.field.setAttribute('inputmode', this.savedInputMode);
    }
    this.ref?.dispose();
    this.ref = null;
    this.keyboard = null;
    this.field = null;
    this.savedInputMode = null;
  }

  private press(key: string): void {
    const field = this.field;
    if (!field) return;
    switch (key) {
      case 'Done':
        field.blur(); // leaving the field commits it (and closes the keyboard)
        return;
      case 'Backspace':
        deleteBackward(field);
        return;
      case 'Enter':
        if (field instanceof HTMLTextAreaElement) {
          insertText(field, '\n');
        } else {
          // Synthetic events do not trigger a form's default submit, so do both: let (keydown.enter) handlers run, then submit.
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          field.form?.requestSubmit();
        }
        return;
      default:
        insertText(field, key);
    }
  }
}
