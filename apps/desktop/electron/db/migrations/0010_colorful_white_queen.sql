CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`employee_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cash_movements_type_valid" CHECK("cash_movements"."type" IN ('in', 'out')),
	CONSTRAINT "cash_movements_amount_positive" CHECK("cash_movements"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `cash_movements_session_id_idx` ON `cash_movements` (`session_id`);--> statement-breakpoint
CREATE INDEX `cash_movements_at_idx` ON `cash_movements` (`at`);--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`opened_at` integer NOT NULL,
	`opened_by` text,
	`opening_float` integer NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`counted_cash` integer,
	`expected_cash` integer,
	`variance` integer,
	`note` text,
	FOREIGN KEY (`opened_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`closed_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cash_sessions_float_non_negative" CHECK("cash_sessions"."opening_float" >= 0),
	CONSTRAINT "cash_sessions_closing_complete" CHECK(("cash_sessions"."closed_at" IS NULL AND "cash_sessions"."counted_cash" IS NULL AND "cash_sessions"."expected_cash" IS NULL AND "cash_sessions"."variance" IS NULL) OR ("cash_sessions"."closed_at" IS NOT NULL AND "cash_sessions"."counted_cash" IS NOT NULL AND "cash_sessions"."expected_cash" IS NOT NULL AND "cash_sessions"."variance" IS NOT NULL AND "cash_sessions"."counted_cash" >= 0 AND "cash_sessions"."variance" = "cash_sessions"."counted_cash" - "cash_sessions"."expected_cash"))
);
--> statement-breakpoint
CREATE INDEX `cash_sessions_opened_at_idx` ON `cash_sessions` (`opened_at`);