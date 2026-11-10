CREATE TABLE IF NOT EXISTS `reading_daily` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`article_id` integer NOT NULL,
	`seconds` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `day`, `article_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reading_daily_owner_day` ON `reading_daily` (`owner_id`, `day`);
