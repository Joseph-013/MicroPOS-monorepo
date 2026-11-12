import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { categories } from './categories';
import { products } from './products';

/** Many-to-many link: a product can belong to several categories, a category holds many products. */
export const productCategories = sqliteTable(
  'product_categories',
  {
    productId: text()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: text()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    // The primary key already serves lookups by product; this one serves "products in a category".
    index('product_categories_category_id_idx').on(t.categoryId),
  ],
);

export type ProductCategory = typeof productCategories.$inferSelect;
export type NewProductCategory = typeof productCategories.$inferInsert;
