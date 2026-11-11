ALTER TABLE saved_words ADD COLUMN reviewed_at TEXT;
ALTER TABLE saved_words ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
