import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** How long a finger must rest on an element before it counts as a long press, and how far it may wander meanwhile. */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP_PX = 10;
/** Native `contextmenu` events that follow our own within this time are dropped (Chromium sends one at about 500 ms). */
const NATIVE_DUPLICATE_MS = 1000;
/** The ripple that grows under the finger while it holds: its full size (diameter) and how long it takes to fade away when the press ends. */
export const RIPPLE_SIZE_PX = 96;
const RIPPLE_FADE_MS = 150;

/**
 * Long press on a touch screen opens the context menu, in browsers that do not do it themselves: Safari (iPhone, iPad)
 * never sends `contextmenu` for a long press. Part of `hlmContextMenuTrigger` (a host directive there), so every menu that
 * opens on right click gets it. A finger (or pen) held still for `LONG_PRESS_MS` sends a `contextmenu` event at the
 * touch point, which the trigger handles as it would a right click; the release that follows does not also click. Moving
 * more than `LONG_PRESS_SLOP_PX` (a swipe or a scroll) or lifting early is not a long press. While the finger holds, a slow
 * ripple grows under it over `LONG_PRESS_MS` (not with reduced motion), so the person sees the hold is being counted.
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
  private ripple: HTMLElement | null = null;

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
      this.startRipple(event.clientX, event.clientY);
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
      this.endRipple(false);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('contextmenu', onNativeMenu, true);
      el.removeEventListener('click', onClick, true);
    });
  }

  /** A circle that slowly grows from the touch point (fixed to the screen, so no row has to clip or position it). */
  private startRipple(x: number, y: number): void {
    this.endRipple(false);
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ripple = document.createElement('span');
    ripple.setAttribute('aria-hidden', 'true');
    ripple.setAttribute('data-long-press-ripple', '');
    ripple.setAttribute(
      'style',
      `position:fixed;left:${x}px;top:${y}px;width:${RIPPLE_SIZE_PX}px;height:${RIPPLE_SIZE_PX}px;margin:${-RIPPLE_SIZE_PX / 2}px 0 0 ${-RIPPLE_SIZE_PX / 2}px;border-radius:50%;pointer-events:none;z-index:2147483000;background:color-mix(in oklab, var(--primary) 30%, transparent)`,
    );
    document.body.appendChild(ripple);
    ripple.animate?.([{ transform: 'scale(0.1)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 0.55 }], { duration: LONG_PRESS_MS, easing: 'ease-out', fill: 'forwards' });
    this.ripple = ripple;
  }

  /** Takes the ripple away: it fades out when the press was let go early, and is gone at once when the menu opens. */
  private endRipple(fade: boolean): void {
    const ripple = this.ripple;
    this.ripple = null;
    if (!ripple) return;
    const remove = (): void => ripple.remove();
    if (!fade || !ripple.animate) return remove();
    ripple.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: RIPPLE_FADE_MS, fill: 'forwards' }).onfinish = remove;
    setTimeout(remove, RIPPLE_FADE_MS + 50);
  }

  private cancel(fade = true): void {
    this.endRipple(fade);
    clearTimeout(this.timer);
    this.pointerId = null;
    this.element.removeAttribute('data-pressing');
  }

  private fire(): void {
    this.firedAt = Date.now();
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false), 800); // the click after the release, if one comes
    this.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: this.startX, clientY: this.startY }));
    this.cancel(false); // the menu is opening: the ripple has done its job
  }
}
