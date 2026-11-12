CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`detail` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `audit_log_employee_id_idx` ON `audit_log` (`employee_id`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`) WHERE "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`employee_number` text NOT NULL,
	`pin_hash` text NOT NULL,
	`role` text DEFAULT 'cashier' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_employee_number_unique` ON `employees` (`employee_number`) WHERE "employees"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `login_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`logged_in_at` integer NOT NULL,
	`logged_out_at` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `login_sessions_employee_id_idx` ON `login_sessions` (`employee_id`,`logged_in_at`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`name` text NOT NULL,
	`unit_price` integer NOT NULL,
	`unit_cost` integer,
	`quantity_milli` integer NOT NULL,
	`line_total` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "order_lines_quantity_non_zero" CHECK("order_lines"."quantity_milli" <> 0)
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_id_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_lines_product_id_idx` ON `order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`employee_id` text NOT NULL,
	`refund_of_order_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`refund_of_order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_total_matches" CHECK("orders"."total" = "orders"."subtotal" - "orders"."discount_total")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `orders_employee_id_idx` ON `orders` (`employee_id`);--> statement-breakpoint
CREATE INDEX `orders_refund_of_order_id_idx` ON `orders` (`refund_of_order_id`);--> statement-breakpoint
CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`tendered` integer,
	`change` integer,
	`reference` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payments_order_id_idx` ON `payments` (`order_id`);--> statement-breakpoint
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
CREATE TABLE `product_categories` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_categories_category_id_idx` ON `product_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `products` (
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
	CONSTRAINT "products_unit_valid" CHECK("products"."unit" IN ('each', 'kg', 'g', 'lb', 'oz')),
	CONSTRAINT "products_tracking_valid" CHECK("products"."tracking" IN ('none', 'quantity', 'batch', 'expiry')),
	CONSTRAINT "products_shelf_life_positive" CHECK("products"."shelf_life_days" IS NULL OR "products"."shelf_life_days" > 0),
	CONSTRAINT "products_weighed_has_code" CHECK("products"."unit" = 'each' OR "products"."barcode" IS NOT NULL),
	CONSTRAINT "products_price_non_negative" CHECK("products"."price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`order_line_id` text,
	`employee_id` text,
	`at` integer NOT NULL,
	`repackage_id` text,
	`note` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `product_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_movements_type_valid" CHECK("stock_movements"."type" IN ('receive', 'sale', 'refund', 'void', 'adjust', 'waste', 'expired', 'repack_out', 'repack_in')),
	CONSTRAINT "stock_movements_sign_matches_type" CHECK("stock_movements"."quantity_milli" <> 0 AND (
        ("stock_movements"."type" IN ('receive', 'refund', 'void', 'repack_in') AND "stock_movements"."quantity_milli" > 0) OR
        ("stock_movements"."type" IN ('sale', 'waste', 'expired', 'repack_out') AND "stock_movements"."quantity_milli" < 0) OR
        "stock_movements"."type" = 'adjust'
      ))
);
--> statement-breakpoint
CREATE INDEX `stock_movements_batch_id_idx` ON `stock_movements` (`batch_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_order_line_id_idx` ON `stock_movements` (`order_line_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_employee_id_idx` ON `stock_movements` (`employee_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_at_idx` ON `stock_movements` (`at`);--> statement-breakpoint
CREATE INDEX `stock_movements_repackage_id_idx` ON `stock_movements` (`repackage_id`);