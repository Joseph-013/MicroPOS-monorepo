import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CatalogCategory, CatalogProduct } from '@micropos/core';
import type { AppDatabase } from '../index';
import { categories, productCategories, products } from '../schema';

/** Live (not deleted, active) products with all their categories, sorted by name. */
export function listProducts(db: AppDatabase): CatalogProduct[] {
  const rows = db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      price: products.price,
      unit: products.unit,
      tracking: products.tracking,
    })
    .from(products)
    .where(and(isNull(products.deletedAt), eq(products.active, true)))
    .orderBy(sql`lower(${products.name})`)
    .all();
  if (rows.length === 0) return [];

  const byProduct = categoriesByProduct(db, rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, categories: byProduct.get(row.id) ?? [] }));
}

/** Live categories of each given product, sorted by name; one query for any number of products. */
export function categoriesByProduct(db: AppDatabase, productIds: string[]): Map<string, CatalogCategory[]> {
  const byProduct = new Map<string, CatalogCategory[]>();
  if (productIds.length === 0) return byProduct;
  const links = db
    .select({ productId: productCategories.productId, id: categories.id, name: categories.name })
    .from(productCategories)
    .innerJoin(categories, and(eq(productCategories.categoryId, categories.id), isNull(categories.deletedAt)))
    .where(inArray(productCategories.productId, productIds))
    .orderBy(sql`lower(${categories.name})`)
    .all();
  for (const { productId, ...category } of links) {
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), category]);
  }
  return byProduct;
}

/** Live categories, sorted by name (case-insensitive). */
export function listCategories(db: AppDatabase): CatalogCategory[] {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(sql`lower(${categories.name})`)
    .all();
}
