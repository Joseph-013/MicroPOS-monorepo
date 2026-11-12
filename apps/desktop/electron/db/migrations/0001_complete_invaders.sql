PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`barcode` text,
	`price` integer NOT NULL,
	`cost` integer,
	`unit` text DEFAULT 'each' NOT NULL,
	`tracking` text DEFAULT 'none' NOT NULL,
	`shelf_life_days` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "products_unit_valid" CHECK("__new_products"."unit" IN ('each', 'kg', 'g', 'lb', 'oz')),
	CONSTRAINT "products_tracking_valid" CHECK("__new_products"."tracking" IN ('none', 'quantity', 'batch', 'expiry')),
	CONSTRAINT "products_shelf_life_positive" CHECK("__new_products"."shelf_life_days" IS NULL OR "__new_products"."shelf_life_days" > 0),
	CONSTRAINT "products_price_non_negative" CHECK("__new_products"."price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "name", "sku", "barcode", "price", "cost", "unit", "tracking", "shelf_life_days", "active", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "sku", "barcode", "price", "cost", "unit", "tracking", "shelf_life_days", "active", "created_at", "updated_at", "deleted_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`) WHERE "products"."deleted_at" IS NULL;