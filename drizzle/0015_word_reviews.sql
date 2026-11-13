-- One row per flashcard turn, so the stats page can show reviews per day.
CREATE TABLE IF NOT EXISTS `word_reviews` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` text NOT NULL,
  `word_id` integer NOT NULL,
  `grade` text NOT NULL,
  `day` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_word_reviews_owner_day` ON `word_reviews` (`owner_id`, `day`);
