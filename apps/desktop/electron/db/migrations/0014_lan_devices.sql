CREATE TABLE `lan_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lan_devices_token_hash_unique` ON `lan_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `lan_devices_revoked_at_idx` ON `lan_devices` (`revoked_at`);