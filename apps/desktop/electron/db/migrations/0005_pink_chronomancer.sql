ALTER TABLE `employees` ADD `permissions` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `pin_change_required` integer DEFAULT false NOT NULL;