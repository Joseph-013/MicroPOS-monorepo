-- Hand-edited: existing products start with stock tracking off and no shelf life.
CREATE TABLE `product_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`batch_number` text,
	`received_at` integer NOT NULL,
	`expires_at` integer,
	`unit_cost` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `product_batches_product_expiry_idx` ON `product_batches` (`product_id`,`expires_at`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_batches_lot_unique` ON `product_batches` (`product_id`,`batch_number`) WHERE "product_batches"."batch_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_batches_unnamed_unique` ON `product_batches` (`product_id`) WHERE "product_batches"."batch_number" IS NULL;--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`order_line_id` text,
	`employee_id` text,
	`at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `product_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_movements_type_valid" CHECK("stock_movements"."type" IN ('receive', 'sale', 'refund', 'void', 'adjust', 'waste', 'expired')),
	CONSTRAINT "stock_movements_sign_matches_type" CHECK("stock_movements"."quantity_milli" <> 0 AND (
        ("stock_movements"."type" IN ('receive', 'refund', 'void') AND "stock_movements"."quantity_milli" > 0) OR
        ("stock_movements"."type" IN ('sale', 'waste', 'expired') AND "stock_movements"."quantity_milli" < 0) OR
        "stock_movements"."type" = 'adjust'
      ))
);
--> statement-breakpoint
CREATE INDEX `stock_movements_batch_id_idx` ON `stock_movements` (`batch_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_order_line_id_idx` ON `stock_movements` (`order_line_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_employee_id_idx` ON `stock_movements` (`employee_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_at_idx` ON `stock_movements` (`at`);--> statement-breakpoint
ALTER TABLE `order_lines` ADD `unit_cost` integer;--> statement-breakpoint
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
	CONSTRAINT "products_weighed_has_code" CHECK("__new_products"."unit" = 'each' OR "__new_products"."barcode" IS NOT NULL),
	CONSTRAINT "products_price_non_negative" CHECK("__new_products"."price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "name", "sku", "barcode", "price", "cost", "unit", "tracking", "shelf_life_days", "active", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "sku", "barcode", "price", "cost", "unit", 'none', NULL, "active", "created_at", "updated_at", "deleted_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`) WHERE "products"."deleted_at" IS NULL;