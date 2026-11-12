CREATE TABLE `product_categories` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_categories_category_id_idx` ON `product_categories` (`category_id`);--> statement-breakpoint
-- Keep existing data: every product's single category becomes one link row.
INSERT INTO `product_categories` (`product_id`, `category_id`) SELECT `id`, `category_id` FROM `products` WHERE `category_id` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`barcode` text,
	`plu` text,
	`price` integer NOT NULL,
	`cost` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "products_price_non_negative" CHECK("__new_products"."price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "name", "sku", "barcode", "plu", "price", "cost", "active", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "sku", "barcode", "plu", "price", "cost", "active", "created_at", "updated_at", "deleted_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `products_plu_unique` ON `products` (`plu`) WHERE "products"."deleted_at" IS NULL;