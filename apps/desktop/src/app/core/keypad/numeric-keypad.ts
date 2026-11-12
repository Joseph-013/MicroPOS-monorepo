import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { OnScreenKeypad } from './on-screen-keypad';
import { FLOATING_GAP, FLOATING_POSITIONS } from './overlay-positions';

export interface NumericKeypadHandle {
  close(): void;
  /** True if `node` is inside the keypad panel (focus moving there must not close it). */
  contains(node: Node | null): boolean;
}

export interface NumericLimits {
  /** Most digits before the decimal point. */
  wholeDigits: number;
  /** Most digits after the decimal point; 0 for whole numbers only. */
  decimals: number;
}

/**
 * Floats the numeric keypad next to `field` and applies its keys to the field's value (firing `input` each time).
 * The first key replaces an existing value; typing on a real keyboard turns that off. Done blurs the field.
 * `field` must be a text input (a number input cannot hold a half-typed "3."). Returns a handle to close it.
 *
 * Shared by `appOnScreenKeypad` (a field that asks for the keypad) and `OnScreenKeyboardService` (number fields).
 */
export function openNumericKeypad(overlay: Overlay, field: HTMLInputElement, limits: () => NumericLimits): NumericKeypadHandle {
  let replaceNext = field.value !== '';
  const onTyped = (): void => {
    replaceNext = false;
  };
  field.addEventListener('input', onTyped);

  const ref = overlay.create({
    positionStrategy: overlay
      .position()
      .flexibleConnectedTo(field)
      .withPositions(FLOATING_POSITIONS)
      .withPush(true)
      .withViewportMargin(FLOATING_GAP)
      .withFlexibleDimensions(false),
    scrollStrategy: overlay.scrollStrategies.reposition(),
  });

  ref.attach(new ComponentPortal(OnScreenKeypad)).instance.pressed.subscribe((key) => {
    if (key === 'done') {
      field.blur(); // leaving the field commits it and closes the keypad
      return;
    }
    const current = replaceNext ? '' : field.value;
    replaceNext = false;
    const { wholeDigits, decimals } = limits();
    let next: string;
    if (key === 'back') next = current.slice(0, -1);
    else if (key === '.') next = decimals === 0 || current.includes('.') ? current : `${current || '0'}.`;
    else next = current === '0' ? key : current + key;

    if (!new RegExp(`^\\d{0,${wholeDigits}}(\\.\\d{0,${decimals}})?$`).test(next)) return;
    field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

  return {
    contains: (node) => ref.overlayElement.contains(node),
    close: () => {
      field.removeEventListener('input', onTyped);
      ref.dispose();
    },
  };
}
