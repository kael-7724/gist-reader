CREATE TABLE IF NOT EXISTS `login_failures` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
