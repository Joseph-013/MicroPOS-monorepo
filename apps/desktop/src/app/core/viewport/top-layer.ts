import { DestroyRef, inject } from '@angular/core';

/** Attribute that tells other top-layer elements where this one ranks. */
export const TOP_LAYER_PRIORITY_ATTR = 'data-top-layer-priority';

/**
 * Keeps a manual popover above everything else in the browser's top layer.
 *
 * Dialogs, menus and other CDK overlays are popovers too, and the most recently opened one is on top, so
 * anything that must stay above them (banner, "window too small" warning) re-opens itself whenever another
 * popover opens. To avoid two such elements raising each other forever, each one only reacts to popovers
 * of lower priority: give the panel `data-top-layer-priority="<n>"` and pass the same number here
 * (higher = stays above). Call in an injection context.
 */
export function keepOnTop(panel: () => HTMLElement, priority: number, isActive: () => boolean): void {
  const onToggle = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target || target === panel() || (event as ToggleEvent).newState !== 'open' || !isActive()) return;
    if (Number(target.getAttribute(TOP_LAYER_PRIORITY_ATTR) ?? 0) >= priority) return;
    const el = panel();
    el.hidePopover?.();
    el.showPopover?.();
  };
  document.addEventListener('toggle', onToggle, true);
  inject(DestroyRef).onDestroy(() => document.removeEventListener('toggle', onToggle, true));
}

/** True while a popover element is open (false where the Popover API does not exist, e.g. jsdom). */
export function isPopoverOpen(el: HTMLElement): boolean {
  try {
    return el.matches(':popover-open');
  } catch {
    return false;
  }
}
