ALTER TABLE saved_words ADD COLUMN srs_stability REAL;
ALTER TABLE saved_words ADD COLUMN srs_difficulty REAL;
ALTER TABLE saved_words ADD COLUMN srs_lapses INTEGER NOT NULL DEFAULT 0;
