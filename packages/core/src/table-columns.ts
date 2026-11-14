/** The order of each page table's columns, by table id (`products`, `orders`...) then column keys, as an admin set it. */
export type TableColumnOrders = Record<string, string[]>;

export const MAX_TABLE_ID = 40;
export const MAX_COLUMNS = 40;

/** A table id is a short word like `products` or `purchase-orders`. */
export const isTableId = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_TABLE_ID && /^[a-z][a-z0-9-]*$/.test(value);

/** A list of distinct column keys. */
export const isColumnKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= MAX_COLUMNS && value.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 40) && new Set(value).size === value.length;

/**
 * The columns in the saved order. Saved keys that are no longer columns are dropped and columns the saved list does not
 * know (added by an update) go at the end in their default place, so a table never loses a column.
 */
export function orderColumns(saved: readonly string[] | undefined, defaults: readonly string[]): string[] {
  const known = (saved ?? []).filter((key, i, all) => defaults.includes(key) && all.indexOf(key) === i);
  return [...known, ...defaults.filter((key) => !known.includes(key))];
}
