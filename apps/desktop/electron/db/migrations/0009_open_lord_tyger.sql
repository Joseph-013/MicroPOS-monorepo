CREATE TABLE `supplier_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`purchase_order_id` text,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`stock_movement_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`refund_amount` integer NOT NULL,
	`credited_amount` integer NOT NULL,
	`note` text,
	`employee_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `product_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stock_movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "supplier_returns_quantity_positive" CHECK("supplier_returns"."quantity_milli" > 0),
	CONSTRAINT "supplier_returns_refund_valid" CHECK("supplier_returns"."refund_amount" >= 0 AND "supplier_returns"."credited_amount" >= 0 AND "supplier_returns"."credited_amount" <= "supplier_returns"."refund_amount")
);
--> statement-breakpoint
CREATE INDEX `supplier_returns_supplier_id_idx` ON `supplier_returns` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `supplier_returns_purchase_order_id_idx` ON `supplier_returns` (`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `supplier_returns_batch_id_idx` ON `supplier_returns` (`batch_id`);--> statement-breakpoint
CREATE INDEX `supplier_returns_at_idx` ON `supplier_returns` (`at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`order_line_id` text,
	`purchase_order_line_id` text,
	`employee_id` text,
	`at` integer NOT NULL,
	`repackage_id` text,
	`note` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `product_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_movements_type_valid" CHECK("__new_stock_movements"."type" IN ('receive', 'sale', 'refund', 'void', 'adjust', 'waste', 'expired', 'repack_out', 'repack_in', 'supplier_return')),
	CONSTRAINT "stock_movements_sign_matches_type" CHECK("__new_stock_movements"."quantity_milli" <> 0 AND (
        ("__new_stock_movements"."type" IN ('receive', 'refund', 'void', 'repack_in') AND "__new_stock_movements"."quantity_milli" > 0) OR
        ("__new_stock_movements"."type" IN ('sale', 'waste', 'expired', 'repack_out', 'supplier_return') AND "__new_stock_movements"."quantity_milli" < 0) OR
        "__new_stock_movements"."type" = 'adjust'
      ))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "product_id", "batch_id", "type", "quantity_milli", "order_line_id", "purchase_order_line_id", "employee_id", "at", "repackage_id", "note") SELECT "id", "product_id", "batch_id", "type", "quantity_milli", "order_line_id", "purchase_order_line_id", "employee_id", "at", "repackage_id", "note" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `stock_movements_batch_id_idx` ON `stock_movements` (`batch_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_order_line_id_idx` ON `stock_movements` (`order_line_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_purchase_order_line_id_idx` ON `stock_movements` (`purchase_order_line_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_employee_id_idx` ON `stock_movements` (`employee_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_at_idx` ON `stock_movements` (`at`);--> statement-breakpoint
CREATE INDEX `stock_movements_repackage_id_idx` ON `stock_movements` (`repackage_id`);