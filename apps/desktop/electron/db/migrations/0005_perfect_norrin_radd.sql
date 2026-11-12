-- Hand-edited: existing movements belong to no repackage.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
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
	CONSTRAINT "stock_movements_type_valid" CHECK("__new_stock_movements"."type" IN ('receive', 'sale', 'refund', 'void', 'adjust', 'waste', 'expired', 'repack_out', 'repack_in')),
	CONSTRAINT "stock_movements_sign_matches_type" CHECK("__new_stock_movements"."quantity_milli" <> 0 AND (
        ("__new_stock_movements"."type" IN ('receive', 'refund', 'void', 'repack_in') AND "__new_stock_movements"."quantity_milli" > 0) OR
        ("__new_stock_movements"."type" IN ('sale', 'waste', 'expired', 'repack_out') AND "__new_stock_movements"."quantity_milli" < 0) OR
        "__new_stock_movements"."type" = 'adjust'
      ))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "product_id", "batch_id", "type", "quantity_milli", "order_line_id", "employee_id", "at", "note") SELECT "id", "product_id", "batch_id", "type", "quantity_milli", "order_line_id", "employee_id", "at", "note" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `stock_movements_batch_id_idx` ON `stock_movements` (`batch_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_order_line_id_idx` ON `stock_movements` (`order_line_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_employee_id_idx` ON `stock_movements` (`employee_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_at_idx` ON `stock_movements` (`at`);--> statement-breakpoint
CREATE INDEX `stock_movements_repackage_id_idx` ON `stock_movements` (`repackage_id`);