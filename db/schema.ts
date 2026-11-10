import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  translationStatus: text("translation_status").notNull().default("pending"),
  translationProvider: text("translation_provider").notNull().default("baidu"),
  translationError: text("translation_error"),
  translatedAt: text("translated_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_articles_owner_created").on(table.ownerId, table.createdAt)]);

export const savedWords = sqliteTable("saved_words", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  articleId: integer("article_id"),
  articleTitle: text("article_title").notNull(),
  text: text("text").notNull(),
  translation: text("translation").notNull(),
  context: text("context").notNull().default(""),
  maimemoVocId: text("maimemo_voc_id"),
  maimemoPhraseId: text("maimemo_phrase_id"),
  syncStatus: text("sync_status").notNull().default("pending"),
  syncError: text("sync_error"),
  syncedAt: text("synced_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_saved_words_owner_text_context").on(table.ownerId, table.text, table.context),
  index("idx_saved_words_owner_created").on(table.ownerId, table.createdAt),
]);

export const maimemoConnections = sqliteTable("maimemo_connections", {
  ownerId: text("owner_id").primaryKey(),
  encryptedToken: text("encrypted_token").notNull(),
  tokenIv: text("token_iv").notNull(),
  accountLabel: text("account_label").notNull().default("墨墨账号"),
  connectedAt: text("connected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  verifiedAt: text("verified_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const baiduTranslationConnections = sqliteTable("baidu_translation_connections", {
  ownerId: text("owner_id").primaryKey(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  apiKeyIv: text("api_key_iv").notNull(),
  encryptedSecretKey: text("encrypted_secret_key").notNull(),
  secretKeyIv: text("secret_key_iv").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenIv: text("access_token_iv"),
  accessTokenExpiresAt: integer("access_token_expires_at"),
  connectedAt: text("connected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  verifiedAt: text("verified_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const articleTranslations = sqliteTable("article_translations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  articleId: integer("article_id").notNull(),
  kind: text("kind").notNull(),
  sourceText: text("source_text").notNull(),
  normalizedSource: text("normalized_source").notNull(),
  translation: text("translation").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_article_translations_lookup").on(table.ownerId, table.articleId, table.kind, table.normalizedSource),
  index("idx_article_translations_article").on(table.ownerId, table.articleId),
]);

export const savedSentences = sqliteTable("saved_sentences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  articleId: integer("article_id"),
  articleTitle: text("article_title").notNull(),
  text: text("text").notNull(),
  translation: text("translation").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_saved_sentences_owner_text").on(table.ownerId, table.text),
  index("idx_saved_sentences_owner_created").on(table.ownerId, table.createdAt),
]);

export const aiConnections = sqliteTable("ai_connections", {
  ownerId: text("owner_id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull(),
  thinkingMode: text("thinking_mode").notNull().default("disabled"),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  apiKeyIv: text("api_key_iv").notNull(),
  connectedAt: text("connected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const wordAiEnrichments = sqliteTable("word_ai_enrichments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  word: text("word").notNull(),
  similarJson: text("similar_json").notNull(),
  lookalikeJson: text("lookalike_json").notNull(),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("uq_word_ai_owner_word").on(table.ownerId, table.word)]);
