CREATE TABLE `customer_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`order_id` text,
	`method` text,
	`reference` text,
	`note` text,
	`employee_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "customer_ledger_type_valid" CHECK("customer_ledger"."type" IN ('charge', 'payment', 'refund', 'void', 'adjustment')),
	CONSTRAINT "customer_ledger_sign_matches_type" CHECK("customer_ledger"."amount" <> 0 AND (
        ("customer_ledger"."type" = 'charge' AND "customer_ledger"."amount" > 0) OR
        ("customer_ledger"."type" IN ('payment', 'refund', 'void') AND "customer_ledger"."amount" < 0) OR
        "customer_ledger"."type" = 'adjustment'
      ))
);
--> statement-breakpoint
CREATE INDEX `customer_ledger_customer_id_idx` ON `customer_ledger` (`customer_id`);--> statement-breakpoint
CREATE INDEX `customer_ledger_order_id_idx` ON `customer_ledger` (`order_id`);--> statement-breakpoint
CREATE INDEX `customer_ledger_at_idx` ON `customer_ledger` (`at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`note` text,
	`credit_limit` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` text REFERENCES customers(id);--> statement-breakpoint
CREATE INDEX `orders_customer_id_idx` ON `orders` (`customer_id`);