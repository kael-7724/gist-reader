CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_articles_owner_created` ON `articles` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `saved_sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`article_id` integer,
	`article_title` text NOT NULL,
	`text` text NOT NULL,
	`translation` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_saved_sentences_owner_text` ON `saved_sentences` (`owner_id`,`text`);--> statement-breakpoint
CREATE INDEX `idx_saved_sentences_owner_created` ON `saved_sentences` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `saved_words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`article_id` integer,
	`article_title` text NOT NULL,
	`text` text NOT NULL,
	`translation` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_saved_words_owner_text_context` ON `saved_words` (`owner_id`,`text`,`context`);--> statement-breakpoint
CREATE INDEX `idx_saved_words_owner_created` ON `saved_words` (`owner_id`,`created_at`);