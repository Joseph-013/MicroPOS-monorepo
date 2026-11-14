import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** How long a finger must rest on an element before it counts as a long press, and how far it may wander meanwhile. */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP_PX = 10;
/** Native `contextmenu` events that follow our own within this time are dropped (Chromium sends one at about 500 ms). */
const NATIVE_DUPLICATE_MS = 1000;

/**
 * Long press on a touch screen opens the context menu, in browsers that do not do it themselves: Safari (iPhone, iPad)
 * never sends `contextmenu` for a long press. Part of `hlmContextMenuTrigger` (a host directive there), so every menu that
 * opens on right click gets it. A finger (or pen) held still for `LONG_PRESS_MS` sends a `contextmenu` event at the
 * touch point, which the trigger handles as it would a right click; the release that follows does not also click. Moving
 * more than `LONG_PRESS_SLOP_PX` (a swipe or a scroll) or lifting early is not a long press.
 */
@Directive({ selector: '[appLongPressContextMenu]' })
export class LongPressContextMenu {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private startX = 0;
  private startY = 0;
  private pointerId: number | null = null;
  private firedAt = 0;
  private swallowClick = false;

  constructor() {
    const el = this.element;
    const onDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' || this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.startX = event.clientX;
      this.startY = event.clientY;
      el.setAttribute('data-pressing', ''); // no text selection or link callout while the finger is down (see `[data-pressing]` in styles.css)
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.fire(), LONG_PRESS_MS);
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== this.pointerId) return;
      if (Math.hypot(event.clientX - this.startX, event.clientY - this.startY) > LONG_PRESS_SLOP_PX) this.cancel();
    };
    const onEnd = (event: PointerEvent): void => {
      if (event.pointerId === this.pointerId) this.cancel();
    };
    const onNativeMenu = (event: Event): void => {
      // The browser's own long-press menu event right after ours would open the menu a second time.
      if (event.isTrusted && Date.now() - this.firedAt < NATIVE_DUPLICATE_MS) event.stopImmediatePropagation();
    };
    const onClick = (event: Event): void => {
      if (!this.swallowClick) return;
      this.swallowClick = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    el.addEventListener('contextmenu', onNativeMenu, true);
    el.addEventListener('click', onClick, true);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('contextmenu', onNativeMenu, true);
      el.removeEventListener('click', onClick, true);
    });
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.pointerId = null;
    this.element.removeAttribute('data-pressing');
  }

  private fire(): void {
    this.firedAt = Date.now();
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false), 800); // the click after the release, if one comes
    this.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: this.startX, clientY: this.startY }));
    this.cancel();
  }
}
