import { database, message, ownerId } from "@/lib/site-data";
import { lemmatizeEnglishWord } from "@/lib/english-lemma";
import { nextState, type Grade, type SrsState } from "@/lib/srs";
import { cleanShortTitle } from "@/lib/short-title";

// A phrase is stored in the word book in lower case, without surrounding punctuation.
function normalizePhrase(value: string) {
  return value.normalize("NFKC").replace(/[’]/g, "'").replace(/\s+/g, " ").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase().slice(0, 120);
}

type LibraryPayload = {
  action?: "create-article" | "save-selection";
  shortTitle?: string;
  title?: string;
  content?: string;
  type?: "word" | "phrase" | "sentence";
  text?: string;
  translation?: string;
  context?: string;
  articleId?: number;
  articleTitle?: string;
};

export async function GET(request: Request) {
  try {
    const owner = ownerId(request);
    const db = database();
    const [articles, words, sentences] = await Promise.all([
      db.prepare("SELECT id, title, short_title AS shortTitle, content, translation_status AS translationStatus, translation_provider AS translationProvider, translation_error AS translationError, translated_at AS translatedAt, created_at AS createdAt FROM articles WHERE owner_id = ? ORDER BY created_at DESC, id DESC").bind(owner).all(),
      db.prepare(`SELECT w.id, w.article_id AS articleId, w.text, w.translation, w.context, w.article_title AS articleTitle,
        w.maimemo_voc_id AS maimemoVocId, w.sync_status AS syncStatus, w.sync_error AS syncError,
        w.synced_at AS syncedAt, w.created_at AS createdAt, w.reviewed_at AS reviewedAt, w.review_count AS reviewCount, w.srs_stability AS srsStability, w.srs_difficulty AS srsDifficulty, e.similar_json AS similarJson, e.lookalike_json AS lookalikeJson
        FROM saved_words w LEFT JOIN word_ai_enrichments e ON e.owner_id = w.owner_id AND e.word = w.text
        WHERE w.owner_id = ? ORDER BY w.sort_order DESC, w.created_at DESC, w.id DESC`).bind(owner).all(),
      db.prepare("SELECT id, article_id AS articleId, text, translation, article_title AS articleTitle, created_at AS createdAt FROM saved_sentences WHERE owner_id = ? ORDER BY created_at DESC, id DESC").bind(owner).all(),
    ]);
    return Response.json({ articles: articles.results, words: words.results, sentences: sentences.results });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const db = database();
    const payload = await request.json() as LibraryPayload;
    if (payload.action === "create-article") {
      const title = payload.title?.trim().slice(0, 180) || "";
      const content = payload.content?.trim().slice(0, 200000) || "";
      if (!title || !content) return Response.json({ error: "标题和正文不能为空" }, { status: 400 });
      const created = await db.prepare("INSERT INTO articles (owner_id, title, short_title, content, translation_provider) VALUES (?, ?, ?, ?, 'deepseek') RETURNING id, title, short_title AS shortTitle, content, translation_status AS translationStatus, translation_provider AS translationProvider, translation_error AS translationError, translated_at AS translatedAt, created_at AS createdAt").bind(owner, title, cleanShortTitle(payload.shortTitle), content).first();
      return Response.json({ article: created }, { status: 201 });
    }
    if (payload.action === "save-selection") {
      const text = payload.text?.trim().slice(0, 1200) || "";
      const translation = payload.translation?.trim().slice(0, 2400) || "";
      const articleTitle = payload.articleTitle?.trim().slice(0, 180) || "未命名文章";
      const articleId = payload.articleId && payload.articleId > 0 ? payload.articleId : null;
      if (!text || !translation || !payload.type) return Response.json({ error: "收藏内容不完整" }, { status: 400 });
      if (payload.type === "word" || payload.type === "phrase") {
        const context = payload.context?.trim().slice(0, 700) || "";
        const lemma = payload.type === "phrase" ? normalizePhrase(text) : lemmatizeEnglishWord(text);
        if (!lemma) return Response.json({ error: "没有识别到有效的英文单词" }, { status: 400 });
        const item = await db.prepare("INSERT INTO saved_words (owner_id, article_id, article_title, text, translation, context, sort_order) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM saved_words WHERE owner_id = ?)) ON CONFLICT(owner_id, text, context) DO UPDATE SET translation = excluded.translation, article_title = excluded.article_title, article_id = excluded.article_id, sort_order = excluded.sort_order RETURNING id, article_id AS articleId, text, translation, context, article_title AS articleTitle, created_at AS createdAt").bind(owner, articleId, articleTitle, lemma, translation, context, owner).first();
        return Response.json({ item }, { status: 201 });
      }
      const item = await db.prepare("INSERT INTO saved_sentences (owner_id, article_id, article_title, text, translation) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, text) DO UPDATE SET translation = excluded.translation, article_title = excluded.article_title, article_id = excluded.article_id RETURNING id, article_id AS articleId, text, translation, article_title AS articleTitle, created_at AS createdAt").bind(owner, articleId, articleTitle, text, translation).first();
      return Response.json({ item }, { status: 201 });
    }
    return Response.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const owner = ownerId(request);
    const body = await request.json() as { id?: number; action?: string; shortTitle?: string; grade?: string };
    const { id } = body;
    if (!Number.isInteger(id) || !id || id < 1) return Response.json({ error: "编号无效" }, { status: 400 });
    const db = database();
    if (body.action === "short-title") {
      const shortTitle = cleanShortTitle(body.shortTitle);
      const updated = await db.prepare("UPDATE articles SET short_title = ? WHERE owner_id = ? AND id = ? RETURNING short_title AS shortTitle").bind(shortTitle, owner, id).first();
      if (!updated) return Response.json({ error: "没有找到文章" }, { status: 404 });
      return Response.json(updated);
    }
    if (body.action === "review") {
      const grade: Grade = body.grade === "again" ? "again" : "good";
      const current = await db.prepare("SELECT srs_stability AS stability, srs_difficulty AS difficulty, reviewed_at AS reviewedAt FROM saved_words WHERE owner_id = ? AND id = ?").bind(owner, id).first<SrsState>();
      if (!current) return Response.json({ error: "没有找到这个单词" }, { status: 404 });
      const next = nextState(current, grade);
      const reviewed = await db.prepare("UPDATE saved_words SET srs_stability = ?, srs_difficulty = ?, srs_lapses = srs_lapses + ?, reviewed_at = CURRENT_TIMESTAMP, review_count = review_count + 1 WHERE owner_id = ? AND id = ? RETURNING reviewed_at AS reviewedAt, review_count AS reviewCount, srs_stability AS srsStability, srs_difficulty AS srsDifficulty").bind(next.stability, next.difficulty, grade === "again" ? 1 : 0, owner, id).first();
      return Response.json(reviewed);
    }
    const result = await db.prepare("UPDATE saved_words SET sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM saved_words WHERE owner_id = ?) WHERE owner_id = ? AND id = ? RETURNING id").bind(owner, owner, id).first();
    if (!result) return Response.json({ error: "没有找到这个单词" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const owner = ownerId(request);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    if (kind === "words") {
      const payload = await request.json().catch(() => null) as { ids?: unknown[] } | null;
      const ids = payload?.ids;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
        return Response.json({ error: "请选择有效的单词" }, { status: 400 });
      }
      const result = await database().prepare(
        "DELETE FROM saved_words WHERE owner_id = ? AND id IN (SELECT value FROM json_each(?))",
      ).bind(owner, JSON.stringify(ids)).run();
      return Response.json({ deleted: result.meta.changes });
    }
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1 || (kind !== "word" && kind !== "sentence" && kind !== "article")) return Response.json({ error: "参数无效" }, { status: 400 });
    if (kind === "article") {
      const article = await database().prepare("SELECT id FROM articles WHERE id = ? AND owner_id = ?").bind(id, owner).first();
      if (!article) return Response.json({ error: "没有找到文章" }, { status: 404 });
      await database().batch([
        database().prepare("DELETE FROM article_translations WHERE article_id = ? AND owner_id = ?").bind(id, owner),
        database().prepare("DELETE FROM articles WHERE id = ? AND owner_id = ?").bind(id, owner),
      ]);
      return Response.json({ ok: true });
    }
    const table = kind === "word" ? "saved_words" : "saved_sentences";
    await database().prepare(`DELETE FROM ${table} WHERE id = ? AND owner_id = ?`).bind(id, owner).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
