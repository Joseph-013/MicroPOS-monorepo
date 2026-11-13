PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_customer_ledger` (
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
	CONSTRAINT "customer_ledger_type_valid" CHECK("__new_customer_ledger"."type" IN ('charge', 'payment', 'refund', 'void', 'adjustment', 'interest')),
	CONSTRAINT "customer_ledger_sign_matches_type" CHECK("__new_customer_ledger"."amount" <> 0 AND (
        ("__new_customer_ledger"."type" IN ('charge', 'interest') AND "__new_customer_ledger"."amount" > 0) OR
        ("__new_customer_ledger"."type" IN ('payment', 'refund', 'void') AND "__new_customer_ledger"."amount" < 0) OR
        "__new_customer_ledger"."type" = 'adjustment'
      ))
);
--> statement-breakpoint
INSERT INTO `__new_customer_ledger`("id", "customer_id", "type", "amount", "order_id", "method", "reference", "note", "employee_id", "at") SELECT "id", "customer_id", "type", "amount", "order_id", "method", "reference", "note", "employee_id", "at" FROM `customer_ledger`;--> statement-breakpoint
DROP TABLE `customer_ledger`;--> statement-breakpoint
ALTER TABLE `__new_customer_ledger` RENAME TO `customer_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `customer_ledger_customer_id_idx` ON `customer_ledger` (`customer_id`);--> statement-breakpoint
CREATE INDEX `customer_ledger_order_id_idx` ON `customer_ledger` (`order_id`);--> statement-breakpoint
CREATE INDEX `customer_ledger_at_idx` ON `customer_ledger` (`at`);--> statement-breakpoint
CREATE TABLE `__new_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`note` text,
	`credit_limit` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`interest_mode` text,
	`interest_rate_bp` integer,
	`interest_started_at` integer,
	`deleted_at` integer,
	CONSTRAINT "customers_interest_valid" CHECK(("__new_customers"."interest_mode" IS NULL AND "__new_customers"."interest_rate_bp" IS NULL AND "__new_customers"."interest_started_at" IS NULL) OR ("__new_customers"."interest_mode" IS NOT NULL AND "__new_customers"."interest_rate_bp" BETWEEN 1 AND 10000 AND "__new_customers"."interest_started_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "name", "phone", "note", "credit_limit", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "phone", "note", "credit_limit", "created_at", "updated_at", "deleted_at" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;