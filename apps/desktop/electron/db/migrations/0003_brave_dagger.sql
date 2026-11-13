CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `purchase_order_lines_purchase_order_id_idx` ON `purchase_order_lines` (`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `purchase_order_lines_product_id_idx` ON `purchase_order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`po_number` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text DEFAULT 'ordered' NOT NULL,
	`ordered_at` integer NOT NULL,
	`expected_at` integer,
	`due_at` integer,
	`received_at` integer,
	`reference` text,
	`note` text,
	`total` integer DEFAULT 0 NOT NULL,
	`employee_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_po_number_unique` ON `purchase_orders` (`po_number`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_id_idx` ON `purchase_orders` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `purchase_orders_status_idx` ON `purchase_orders` (`status`);--> statement-breakpoint
CREATE INDEX `purchase_orders_ordered_at_idx` ON `purchase_orders` (`ordered_at`);--> statement-breakpoint
CREATE TABLE `purchase_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`note` text,
	`employee_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "purchase_payments_amount_positive" CHECK("purchase_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `purchase_payments_purchase_order_id_idx` ON `purchase_payments` (`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `purchase_payments_at_idx` ON `purchase_payments` (`at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
