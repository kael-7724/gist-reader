CREATE TABLE `article_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`article_id` integer NOT NULL,
	`kind` text NOT NULL,
	`source_text` text NOT NULL,
	`normalized_source` text NOT NULL,
	`translation` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_article_translations_lookup` ON `article_translations` (`owner_id`,`article_id`,`kind`,`normalized_source`);--> statement-breakpoint
CREATE INDEX `idx_article_translations_article` ON `article_translations` (`owner_id`,`article_id`);--> statement-breakpoint
CREATE TABLE `baidu_translation_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`api_key_iv` text NOT NULL,
	`encrypted_secret_key` text NOT NULL,
	`secret_key_iv` text NOT NULL,
	`encrypted_access_token` text,
	`access_token_iv` text,
	`access_token_expires_at` integer,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`verified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `articles` ADD `translation_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `translation_error` text;--> statement-breakpoint
ALTER TABLE `articles` ADD `translated_at` text;