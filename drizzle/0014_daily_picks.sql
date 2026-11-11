CREATE TABLE IF NOT EXISTS `daily_picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pick_date` text NOT NULL,
	`title` text NOT NULL,
	`short_title` text,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `daily_picks_date_idx` ON `daily_picks` (`pick_date`);
