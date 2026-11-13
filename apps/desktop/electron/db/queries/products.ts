import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { MAX_QUANTITY_UNITS, type ProductField, type ProductInput, type ProductRecord, type RestoreProductsResult, type SaveProductResult } from '@micropos/core';
import type { AppDatabase } from '../index';
import { categories, PRODUCT_TRACKING, type ProductTracking, PRODUCT_UNITS, type ProductUnit, productCategories, products } from '../schema';
import { categoriesByProduct } from './catalog';
import { stockSummary } from './inventory';

const MAX_CENTS = 100_000_000_00;
const MAX_CATEGORIES = 100;

type Invalid = { field: ProductField | null; error: string };

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CENTS;

/** Trims a code; empty becomes null so it never collides with another empty code. */
function code(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed || null;
}

/** Validates what the renderer sent; returns clean input or the first problem found. */
export function sanitizeProductInput(value: unknown): ProductInput | Invalid {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v['name'] === 'string' ? v['name'].trim() : '';
  if (!name) return { field: 'name', error: 'Enter a name' };
  if (name.length > 200) return { field: 'name', error: 'Name is too long' };
  const sku = code(v['sku'], 64);
  if (sku === undefined) return { field: 'sku', error: 'SKU is too long' };
  const barcode = code(v['barcode'], 64);
  if (barcode === undefined) return { field: 'barcode', error: 'Barcode or PLU is too long' };
  if (!isCents(v['price'])) return { field: 'price', error: 'Enter a valid price' };
  const cost = v['cost'] ?? null;
  if (cost !== null && !isCents(cost)) return { field: 'cost', error: 'Enter a valid cost' };
  const unit = v['unit'] ?? 'each';
  if (!PRODUCT_UNITS.includes(unit as ProductUnit)) return { field: 'unit', error: 'Choose how it is sold' };
  const tracking = v['tracking'] ?? 'none';
  if (!PRODUCT_TRACKING.includes(tracking as ProductTracking)) return { field: 'tracking', error: 'Choose how stock is tracked' };
  // The shelf life only means something for products that expire.
  let shelfLifeDays: number | null = null;
  if (tracking === 'expiry' && v['shelfLifeDays'] !== null && v['shelfLifeDays'] !== undefined) {
    const days = v['shelfLifeDays'];
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 3650) {
      return { field: 'shelfLifeDays', error: 'Enter a number of days' };
    }
    shelfLifeDays = days;
  }
  // A critical level only means something for products whose stock is tracked.
  let criticalLevelMilli: number | null = null;
  if (tracking !== 'none' && v['criticalLevelMilli'] !== null && v['criticalLevelMilli'] !== undefined) {
    const level = v['criticalLevelMilli'];
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > MAX_QUANTITY_UNITS * 1000) {
      return { field: 'criticalLevel', error: 'Enter a quantity' };
    }
    criticalLevelMilli = level;
  }
  const ids = v['categoryIds'];
  if (!Array.isArray(ids) || ids.length > MAX_CATEGORIES || ids.some((id) => typeof id !== 'string')) {
    return { field: null, error: 'Categories are not valid' };
  }
  return {
    name,
    unit: unit as ProductUnit,
    tracking: tracking as ProductTracking,
    shelfLifeDays,
    criticalLevelMilli,
    sku,
    barcode,
    price: v['price'],
    cost,
    active: v['active'] !== false,
    categoryIds: [...new Set(ids as string[])],
  };
}

const isInvalid = (r: ProductInput | Invalid): r is Invalid => 'error' in r;

function selectRecords(db: AppDatabase, where: ReturnType<typeof and> | undefined): ProductRecord[] {
  const rows = db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      price: products.price,
      cost: products.cost,
      unit: products.unit,
      tracking: products.tracking,
      shelfLifeDays: products.shelfLifeDays,
      criticalLevelMilli: products.criticalLevelMilli,
      active: products.active,
      createdAt: products.createdAt,
      deletedAt: products.deletedAt,
    })
    .from(products)
    .where(where)
    .orderBy(sql`lower(${products.name})`)
    .all();
  const byProduct = categoriesByProduct(
    db,
    rows.map((r) => r.id),
  );
  const stock = stockSummary(db);
  return rows.map((row) => {
    const s = row.tracking === 'none' ? undefined : stock.get(row.id);
    return {
      ...row,
      categories: byProduct.get(row.id) ?? [],
      onHandMilli: row.tracking === 'none' ? null : (s?.onHandMilli ?? 0),
      nextExpiry: s?.nextExpiry ?? null,
    };
  });
}

/** Every live product (active or not) with cost and categories, sorted by name; deleted ones too when asked. */
export function listProductRecords(db: AppDatabase, includeDeleted = false): ProductRecord[] {
  return selectRecords(db, includeDeleted ? undefined : isNull(products.deletedAt));
}

/** The first code already used by another live product, so the form can point at the field. */
function findDuplicate(db: AppDatabase, input: ProductInput, exceptId: string | null): Invalid | null {
  const fields = [
    ['sku', 'SKU', products.sku],
    ['barcode', 'Barcode or PLU', products.barcode],
  ] as const;
  for (const [field, label, column] of fields) {
    const value = input[field];
    if (!value) continue;
    const clash = and(eq(column, value), isNull(products.deletedAt), exceptId ? ne(products.id, exceptId) : undefined);
    const [hit] = db.select({ id: products.id }).from(products).where(clash).limit(1).all();
    if (hit) return { field, error: `${label} is already used` };
  }
  return null;
}

/** Category ids that no longer exist (deleted meanwhile) are rejected rather than silently dropped. */
function unknownCategory(db: AppDatabase, ids: string[]): boolean {
  if (ids.length === 0) return false;
  const found = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.id, ids), isNull(categories.deletedAt)))
    .all();
  return found.length !== ids.length;
}

function save(db: AppDatabase, id: string | null, raw: unknown): SaveProductResult {
  const input = sanitizeProductInput(raw);
  if (isInvalid(input)) return { ok: false, ...input };
  const duplicate = findDuplicate(db, input, id);
  if (duplicate) return { ok: false, ...duplicate };
  if (unknownCategory(db, input.categoryIds)) return { ok: false, field: null, error: 'A category no longer exists' };

  const { categoryIds, ...columns } = input;
  const savedId = db.transaction((tx) => {
    let productId = id;
    if (productId === null) {
      productId = tx.insert(products).values(columns).returning({ id: products.id }).get().id;
    } else {
      const updated = tx
        .update(products)
        .set(columns)
        .where(and(eq(products.id, productId), isNull(products.deletedAt)))
        .returning({ id: products.id })
        .all();
      if (updated.length === 0) return null;
      tx.delete(productCategories).where(eq(productCategories.productId, productId)).run();
    }
    if (categoryIds.length) {
      tx.insert(productCategories)
        .values(categoryIds.map((categoryId) => ({ productId: productId as string, categoryId })))
        .run();
    }
    return productId;
  });
  if (savedId === null) return { ok: false, field: null, error: 'Product no longer exists' };
  const [product] = selectRecords(db, eq(products.id, savedId));
  return { ok: true, product: product! };
}

export function createProduct(db: AppDatabase, input: unknown): SaveProductResult {
  return save(db, null, input);
}

export function updateProduct(db: AppDatabase, id: unknown, input: unknown): SaveProductResult {
  if (typeof id !== 'string') return { ok: false, field: null, error: 'Product no longer exists' };
  return save(db, id, input);
}

const MAX_BULK = 1000;
const idList = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))].slice(0, MAX_BULK) : [];

/** Soft delete: the rows stay so past orders and drafts can still resolve them, and their codes are freed. */
export function deleteProducts(db: AppDatabase, ids: unknown): void {
  const list = idList(ids);
  if (list.length === 0) return;
  db.update(products)
    .set({ deletedAt: Date.now() })
    .where(and(inArray(products.id, list), isNull(products.deletedAt)))
    .run();
}

/** Sets the active flag of live products (inactive ones stay on file but are not offered at checkout). */
export function setProductsActive(db: AppDatabase, ids: unknown, active: unknown): void {
  const list = idList(ids);
  if (list.length === 0 || typeof active !== 'boolean') return;
  db.update(products)
    .set({ active })
    .where(and(inArray(products.id, list), isNull(products.deletedAt)))
    .run();
}

/**
 * Undeletes products. A product whose SKU or barcode a live product has taken since is skipped (and named in
 * `conflicts`) rather than failing the whole batch; the codes are unique among live products.
 */
export function restoreProducts(db: AppDatabase, ids: unknown): RestoreProductsResult {
  const list = idList(ids);
  const result: RestoreProductsResult = { restored: 0, conflicts: [] };
  if (list.length === 0) return result;
  db.transaction((tx) => {
    const rows = tx
      .select({ id: products.id, name: products.name, sku: products.sku, barcode: products.barcode })
      .from(products)
      .where(and(inArray(products.id, list), isNotNull(products.deletedAt)))
      .orderBy(sql`lower(${products.name})`)
      .all();
    for (const row of rows) {
      const clash = [];
      if (row.sku) clash.push(eq(products.sku, row.sku));
      if (row.barcode) clash.push(eq(products.barcode, row.barcode));
      const taken = clash.length
        ? tx
            .select({ id: products.id })
            .from(products)
            .where(and(isNull(products.deletedAt), or(...clash)))
            .limit(1)
            .all().length > 0
        : false;
      if (taken) {
        result.conflicts.push(row.name);
        continue;
      }
      tx.update(products).set({ deletedAt: null }).where(eq(products.id, row.id)).run();
      result.restored++;
    }
  });
  return result;
}
