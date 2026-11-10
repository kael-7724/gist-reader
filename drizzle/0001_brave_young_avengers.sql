CREATE TABLE `maimemo_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`encrypted_token` text NOT NULL,
	`token_iv` text NOT NULL,
	`account_label` text DEFAULT '墨墨账号' NOT NULL,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`verified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `saved_words` ADD `maimemo_voc_id` text;--> statement-breakpoint
ALTER TABLE `saved_words` ADD `maimemo_phrase_id` text;--> statement-breakpoint
ALTER TABLE `saved_words` ADD `sync_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `saved_words` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `saved_words` ADD `synced_at` text;