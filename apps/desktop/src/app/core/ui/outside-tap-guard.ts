import { DestroyRef, inject, Service } from '@angular/core';

/** Where an open menu's panel is (a context menu or a dropdown, in the overlay container). */
const OPEN_MENU = '.cdk-overlay-container [role="menu"]';

/**
 * On a touch screen, while a menu is open (a row's context menu, a dropdown), a tap outside it only closes it: the tap does
 * not also land on whatever is underneath (a row that would open its dialog, a button), because a finger that misses the menu
 * is most likely an accident. With a mouse, clicking outside still closes the menu and clicks the thing as usual.
 *
 * How: a `pointerdown` from a finger or pen while a menu is open and outside it marks the coming `click` as the dismissing
 * one. The click listener sits on the app's root element, in the capture phase: after the overlay's own listener on the
 * body, which closes the menu, and before the target, which never hears it. Started by the root `App`.
 */
@Service()
export class OutsideTapGuard {
  private dismissing = false;

  constructor() {
    const root = document.querySelector('app-root') ?? document.body;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse') return void (this.dismissing = false);
      const menu = document.querySelector(OPEN_MENU);
      this.dismissing = !!menu && !menu.closest('.cdk-overlay-pane')?.contains(event.target as Node | null) && !(event.target as Element | null)?.closest?.('.cdk-overlay-container');
    };
    const onClick = (event: Event): void => {
      if (!this.dismissing) return;
      this.dismissing = false;
      event.stopPropagation();
      event.preventDefault();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('click', onClick, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('click', onClick, true);
    });
  }
}
