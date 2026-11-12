import { DestroyRef, inject, Service } from '@angular/core';

/** Fields that need focus to work. Everything else matching `PRESS_TARGETS` is kept unfocused. */
const FOCUSABLE_FIELDS = 'input, textarea, select, [contenteditable="true"], [data-allow-focus]';
const PRESS_TARGETS =
  'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"]';

/**
 * Kiosk rule: pressing a button with the mouse or a finger does not move focus to it.
 * Focus stays where it was (typically a barcode or search field), so a stray Enter or Space
 * from a scanner or keyboard can never activate the last button that was tapped.
 * Clicks still work; use `data-allow-focus` on an element that must take focus.
 *
 * Inject it once at the root.
 */
@Service()
export class KioskFocusService {
  constructor() {
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest(FOCUSABLE_FIELDS)) return;
      if (event.target.closest(PRESS_TARGETS)) event.preventDefault();
    };
    document.addEventListener('mousedown', onMouseDown, { capture: true });
    inject(DestroyRef).onDestroy(() => document.removeEventListener('mousedown', onMouseDown, { capture: true }));
  }
}
