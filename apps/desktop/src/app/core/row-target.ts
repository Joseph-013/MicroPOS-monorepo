import { DestroyRef, inject, signal } from '@angular/core';

/**
 * `?highlight=<row id>` on a table page shows the page holding that row and highlights it (not selects it). Other
 * pages link here, for example the order dialog's link to Sales Orders. The parameter is removed again once handled.
 */
export const HIGHLIGHT_PARAM = 'highlight';

/**
 * Scrolls a table row (marked `data-row-id`) into the middle of its scroll area. The row may not be rendered yet
 * (the table was still loading, or the page just changed), so this looks again every 50 ms for up to 2 s.
 */
export function scrollToRow(id: string): void {
  let tries = 0;
  const look = (): void => {
    const row = document.querySelector(`[data-row-id="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView?.({ block: 'center' });
    else if (++tries < 40) setTimeout(look, 50);
  };
  setTimeout(look);
}

/** How long a targeted row stays highlighted. */
export const ROW_TARGET_MS = 6000;

/** Reads like a signal (`target()`); `set(id)` highlights a row, and `set(null)` clears it. */
export interface RowTarget {
  (): string | null;
  set(id: string | null): void;
}

/**
 * The highlighted row of a table page. The highlight lasts `ROW_TARGET_MS` and then goes away on its own (targeting
 * another row, or the same one again, restarts the clock). Create it as a field of a component.
 */
export function rowTarget(durationMs = ROW_TARGET_MS): RowTarget {
  const id = signal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  const target = (() => id()) as RowTarget;
  target.set = (next) => {
    clearTimeout(timer);
    id.set(next);
    if (next) timer = setTimeout(() => id.set(null), durationMs);
  };
  return target;
}
