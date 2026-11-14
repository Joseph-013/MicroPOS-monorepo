import { Component, inject, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideColumns3, lucideGripVertical, lucideListFilter } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { AuthService } from '../auth/auth.service';
import type { TableLayout } from './table-columns';

/**
 * Buttons for a page table's header. "Sort and filter" (phone-sized screens only) opens the table's title and filter rows,
 * which the card layout keeps hidden. "Columns", for admins only (`settings.manage`) and not on a phone: opens a list of the columns with a drag
 * handle at the right of each row to reorder them. The handle also takes the arrow keys. No hiding of columns (yet).
 * The order is saved for everyone.
 */
@Component({
  selector: 'app-column-config',
  imports: [NgIcon, HlmButtonImports, HlmDropdownMenuImports],
  providers: [provideIcons({ lucideColumns3, lucideGripVertical, lucideListFilter })],
  template: `
    <!-- Phone-sized screens: the table is a list of cards, and its sort and filter rows open from here. -->
    <button
      hlmBtn
      [variant]="layout().filtersOpen() ? 'default' : 'outline'"
      size="icon"
      type="button"
      class="md:hidden"
      aria-label="Sort and filter"
      title="Sort and filter"
      [attr.aria-pressed]="layout().filtersOpen()"
      (click)="layout().filtersOpen.set(!layout().filtersOpen())"
    >
      <ng-icon name="lucideListFilter" size="18" />
    </button>
    @if (auth.can('settings.manage')) {
      <button hlmBtn variant="outline" size="icon" type="button" class="max-md:hidden" aria-label="Columns" title="Columns" [hlmDropdownMenuTrigger]="menu" align="end">
        <ng-icon name="lucideColumns3" size="18" />
      </button>
      <ng-template #menu>
        <div hlmDropdownMenu class="w-60">
          <p class="text-muted-foreground px-2 py-1.5 text-xs">Drag to change the order of the columns</p>
          <ul class="flex flex-col" [attr.aria-label]="'Columns of ' + layout().id" #list>
            @for (column of layout().columns(); track column.key; let i = $index) {
              <li class="flex min-h-(--control-height) items-center gap-2 rounded-sm px-2 text-sm" [class.bg-muted]="dragging() === column.key" [attr.data-column]="column.key">
                <span class="min-w-0 flex-1 truncate">{{ column.label }}</span>
                <button
                  type="button"
                  class="text-muted-foreground hover:bg-muted flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm active:cursor-grabbing"
                  [attr.aria-label]="'Move ' + column.label + ' (drag, or use the up and down arrow keys)'"
                  (pointerdown)="startDrag($event, column.key)"
                  (pointermove)="drag($event, list)"
                  (pointerup)="endDrag($event)"
                  (pointercancel)="endDrag($event)"
                  (keydown)="onKey($event, column.key, i)"
                >
                  <ng-icon name="lucideGripVertical" size="18" />
                </button>
              </li>
            }
          </ul>
        </div>
      </ng-template>
    }
  `,
})
export class ColumnConfig {
  protected readonly auth = inject(AuthService);
  readonly layout = input.required<TableLayout>();
  protected readonly dragging = signal<string | null>(null);

  protected startDrag(event: PointerEvent, key: string): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
    this.dragging.set(key);
  }

  /** While dragging, the column moves to the row the pointer is over. */
  protected drag(event: PointerEvent, list: HTMLElement): void {
    const key = this.dragging();
    if (!key) return;
    const rows = [...list.querySelectorAll('li')];
    const to = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().bottom);
    this.layout().move(key, to < 0 ? rows.length - 1 : to);
  }

  protected endDrag(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.dragging.set(null);
  }

  protected onKey(event: KeyboardEvent, key: string, index: number): void {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation(); // the menu would move focus to another item
    this.layout().move(key, index + step);
    queueMicrotask(() => (event.target as HTMLElement | null)?.closest('ul')?.querySelector<HTMLElement>(`[data-column="${key}"] button`)?.focus());
  }
}
