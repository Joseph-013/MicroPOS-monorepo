import { computed, effect, inject, Service, signal, untracked } from '@angular/core';
import { orderColumns, type TableColumnOrders } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { AuthService } from '../auth/auth.service';
import { BannerService } from '../banner';

/**
 * The column order an admin saved for each page table, shared by everyone on this till. Loaded once someone is signed
 * in (the main process refuses it to a locked till); a table with nothing saved keeps its default order.
 */
@Service()
export class TableColumnsService {
  private readonly api = inject(DESKTOP_API);
  private readonly auth = inject(AuthService);
  private readonly banner = inject(BannerService);

  readonly orders = signal<TableColumnOrders>({});

  constructor() {
    effect(() => {
      if (this.auth.user()) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    try {
      this.orders.set((await this.api?.tables.columnOrders()) ?? {});
    } catch (error) {
      console.error('Failed to load the table column orders', error);
    }
  }

  /** Saves a table's order (shown at once; put back with a message if the main process refuses it). */
  async save(tableId: string, keys: string[]): Promise<void> {
    const before = this.orders();
    this.orders.set({ ...before, [tableId]: keys });
    let saved = false;
    try {
      saved = (await this.api?.tables.saveColumnOrder(tableId, keys)) ?? false;
    } catch (error) {
      console.error('Failed to save the table column order', error);
    }
    if (!saved) {
      this.orders.set(before);
      this.banner.error('Could not save the column order', { key: 'columns-saved' });
    }
  }
}

/** A cell's part in the layout: see `TableLayout.col`. */
export interface ColumnCell {
  order: number;
  label: string;
  primary: boolean;
}

export interface ColumnDef {
  key: string;
  label: string;
  /** Its `grid-template-columns` width, such as `minmax(8rem,1fr)`. */
  width: string;
}

/**
 * One page table's columns in the order to show them. The title row, the filter row and every body row are the same CSS
 * grid, so a column moves by giving each of its cells `[style.order]="layout.order(key)"` and listing the widths in the
 * same order (`template()`). The selection column in front (`lead`) and an actions column at the end (`tail`, order
 * `END`) are not part of it and never move.
 */
export class TableLayout {
  static readonly END = 1000;
  private readonly service = inject(TableColumnsService);
  readonly keys = computed(() =>
    orderColumns(
      this.service.orders()[this.id],
      this.defs.map((d) => d.key),
    ),
  );
  readonly columns = computed(() => this.keys().map((key) => this.defs.find((d) => d.key === key)!));
  /** The value of `grid-template-columns`. */
  readonly template = computed(() => [this.lead, ...this.columns().map((c) => c.width), this.tail].filter(Boolean).join(' '));

  constructor(
    readonly id: string,
    readonly defs: readonly ColumnDef[],
    private readonly lead = '',
    private readonly tail = '',
  ) {}

  /** On a phone the sort and filter rows are hidden until this is turned on (the "Sort & filter" button). */
  readonly filtersOpen = signal(false);

  /** What a cell of this column needs from `appCol`: its place in the order, its name (the label on a phone's card) and whether it is the card's title. */
  col(key: string): ColumnCell {
    const order = this.order(key);
    return { order, label: this.defs.find((d) => d.key === key)?.label ?? '', primary: order === 1 };
  }

  /** The CSS `order` of a column's cells (the selection cell has none, so it stays first). */
  order(key: string): number {
    return this.keys().indexOf(key) + 1;
  }

  /** Moves a column to a new place in the order and saves it. */
  move(key: string, to: number): void {
    const keys = [...this.keys()];
    const from = keys.indexOf(key);
    if (from < 0 || to < 0 || to >= keys.length || from === to) return;
    keys.splice(to, 0, ...keys.splice(from, 1));
    void this.service.save(this.id, keys);
  }
}

/** The layout of a page table; call it where the page's fields are set up. */
export const tableLayout = (id: string, defs: readonly ColumnDef[], lead = '', tail = ''): TableLayout => new TableLayout(id, defs, lead, tail);
