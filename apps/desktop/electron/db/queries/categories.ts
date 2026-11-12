import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { CategoryField, CategoryInput, CategoryRecord, RestoreCategoriesResult, SaveCategoryResult } from '@micropos/core';
import type { AppDatabase } from '../index';
import { categories } from '../schema';

const MAX_BULK = 1000;
const MAX_ORDER = 9999;
type Invalid = { field: CategoryField | null; error: string };

/** Validates what the renderer sent; returns clean input or the first problem found. */
export function sanitizeCategoryInput(value: unknown): CategoryInput | Invalid {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v['name'] === 'string' ? v['name'].trim().replace(/\s+/g, ' ') : '';
  if (!name) return { field: 'name', error: 'Enter a name' };
  if (name.length > 100) return { field: 'name', error: 'Name is too long' };
  const order = v['sortOrder'] ?? 0;
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > MAX_ORDER) {
    return { field: 'sortOrder', error: 'Enter a whole number' };
  }
  return { name, sortOrder: order };
}

const isInvalid = (r: CategoryInput | Invalid): r is Invalid => 'error' in r;

function selectRecords(db: AppDatabase, where: ReturnType<typeof and> | undefined): CategoryRecord[] {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      createdAt: categories.createdAt,
      deletedAt: categories.deletedAt,
      // Live products only: a deleted product no longer counts.
      productCount: sql<number>`(SELECT COUNT(*) FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE pc.category_id = categories.id AND p.deleted_at IS NULL)`,
    })
    .from(categories)
    .where(where)
    .orderBy(categories.sortOrder, sql`lower(${categories.name})`)
    .all();
}

/** Live categories with their product counts; deleted ones too when asked. */
export function listCategoryRecords(db: AppDatabase, includeDeleted = false): CategoryRecord[] {
  return selectRecords(db, includeDeleted ? undefined : isNull(categories.deletedAt));
}

/** Names compare without regard to case, so "Dairy" and "dairy" are the same category. */
function nameTaken(db: AppDatabase, name: string, exceptId: string | null): boolean {
  const clash = and(sql`lower(${categories.name}) = lower(${name})`, isNull(categories.deletedAt), exceptId ? ne(categories.id, exceptId) : undefined);
  return db.select({ id: categories.id }).from(categories).where(clash).limit(1).all().length > 0;
}

function save(db: AppDatabase, id: string | null, raw: unknown): SaveCategoryResult {
  const input = sanitizeCategoryInput(raw);
  if (isInvalid(input)) return { ok: false, ...input };
  if (nameTaken(db, input.name, id)) return { ok: false, field: 'name', error: 'Name is already used' };
  let savedId: string;
  if (id === null) {
    savedId = db.insert(categories).values(input).returning({ id: categories.id }).get().id;
  } else {
    const updated = db
      .update(categories)
      .set(input)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .returning({ id: categories.id })
      .all();
    if (updated.length === 0) return { ok: false, field: null, error: 'Category no longer exists' };
    savedId = id;
  }
  const [category] = selectRecords(db, eq(categories.id, savedId));
  return { ok: true, category: category! };
}

export const createCategory = (db: AppDatabase, input: unknown): SaveCategoryResult => save(db, null, input);

export function updateCategory(db: AppDatabase, id: unknown, input: unknown): SaveCategoryResult {
  if (typeof id !== 'string') return { ok: false, field: null, error: 'Category no longer exists' };
  return save(db, id, input);
}

const idList = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))].slice(0, MAX_BULK) : [];

/** Soft delete: the product links stay, so a restore brings the category back with its products. */
export function deleteCategories(db: AppDatabase, ids: unknown): void {
  const list = idList(ids);
  if (list.length === 0) return;
  db.update(categories)
    .set({ deletedAt: Date.now() })
    .where(and(inArray(categories.id, list), isNull(categories.deletedAt)))
    .run();
}

/** Undeletes categories; one whose name a live category has taken since is skipped and named in `conflicts`. */
export function restoreCategories(db: AppDatabase, ids: unknown): RestoreCategoriesResult {
  const list = idList(ids);
  const result: RestoreCategoriesResult = { restored: 0, conflicts: [] };
  if (list.length === 0) return result;
  db.transaction((tx) => {
    const rows = tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(inArray(categories.id, list), isNotNull(categories.deletedAt)))
      .orderBy(sql`lower(${categories.name})`)
      .all();
    for (const row of rows) {
      if (nameTaken(tx as unknown as AppDatabase, row.name, row.id)) {
        result.conflicts.push(row.name);
        continue;
      }
      tx.update(categories).set({ deletedAt: null }).where(eq(categories.id, row.id)).run();
      result.restored++;
    }
  });
  return result;
}
