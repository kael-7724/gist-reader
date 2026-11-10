CREATE TABLE IF NOT EXISTS `self_host_users` (
	`username` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`import_token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_self_host_users_owner` ON `self_host_users` (`owner_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_self_host_users_import_token` ON `self_host_users` (`import_token`);
