ALTER TABLE `order_lines` ADD `discount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `note` text;