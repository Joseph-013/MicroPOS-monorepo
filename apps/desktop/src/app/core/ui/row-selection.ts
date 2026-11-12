import { signal } from '@angular/core';

type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

/**
 * Row selection for the data tables, with the gestures of a file explorer on top of the checkboxes:
 * - **Ctrl/Cmd + click** a row toggles it; **Shift + click** a row selects the range from the last clicked row
 *   (replacing the selection, or adding to it with Ctrl too). A plain click is not a selection gesture here: it opens
 *   the row, so `click` returns false and the page does that.
 * - **Shift + click a checkbox** ticks (or unticks) every row between it and the last one clicked.
 * Ranges follow the order of the rows on the current page (`rows`).
 */
export class RowSelection<T extends { id: string }> {
  readonly ids = signal<ReadonlySet<string>>(new Set());
  /** The row a Shift range starts from: the last one clicked without Shift. */
  private anchor: string | null = null;
  private shift = false;

  constructor(private readonly rows: () => T[]) {}

  has(id: string): boolean {
    return this.ids().has(id);
  }

  /**
   * Call on pointerdown over a checkbox: the checkbox's own change event does not say whether Shift was held, and
   * it fires before the click, so the modifier is remembered here and used by the next `toggle`.
   */
  noteModifiers(event: Modifiers): void {
    this.shift = event.shiftKey;
  }

  /** A checkbox was ticked or unticked. With Shift held, everything from the anchor to this row follows it. */
  toggle(id: string, on: boolean): void {
    const shift = this.shift;
    this.shift = false;
    const range = shift && this.anchor ? this.between(this.anchor, id) : [id];
    this.ids.update((ids) => {
      const next = new Set(ids);
      for (const rowId of range) {
        if (on) next.add(rowId);
        else next.delete(rowId);
      }
      return next;
    });
    if (!shift || !this.anchor) this.anchor = id;
  }

  /** A click on a row. Returns true when it was a selection gesture (Shift or Ctrl/Cmd held), false for a plain click. */
  click(id: string, event: Modifiers): boolean {
    const ctrl = event.ctrlKey || event.metaKey;
    if (!event.shiftKey && !ctrl) return false;
    if (event.shiftKey) {
      const range = this.between(this.anchor ?? id, id);
      this.ids.update((ids) => new Set(ctrl ? [...ids, ...range] : range));
      this.anchor ??= id;
    } else {
      this.ids.update((ids) => {
        const next = new Set(ids);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      this.anchor = id;
    }
    return true;
  }

  selectAll(on: boolean): void {
    this.ids.set(on ? new Set(this.rows().map((row) => row.id)) : new Set());
    this.anchor = null;
  }

  clear(): void {
    this.selectAll(false);
  }

  /** Drops rows from the selection (after a bulk action took them away). */
  remove(ids: string[]): void {
    this.ids.update((current) => new Set([...current].filter((id) => !ids.includes(id))));
  }

  /** The ids from `a` to `b` inclusive, in page order, whichever comes first; just `b` when `a` is not on the page. */
  private between(a: string, b: string): string[] {
    const ids = this.rows().map((row) => row.id);
    const from = ids.indexOf(a);
    const to = ids.indexOf(b);
    if (from < 0 || to < 0) return [b];
    return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
  }
}
