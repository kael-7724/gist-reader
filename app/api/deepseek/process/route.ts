import { translateManyWithDeepSeek } from "@/lib/deepseek";
import { database, message, ownerId } from "@/lib/site-data";

type ArticleRow = { id: number; content: string };

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractSentences(content: string) {
  return [...new Set((content.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((item) => item.trim()).filter(Boolean))];
}

function extractWords(content: string) {
  return [...new Set((content.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).map((item) => item.toLowerCase()))];
}

async function insertTranslations(owner: string, articleId: number, kind: "word" | "sentence", items: Array<{ source: string; translation: string }>) {
  const db = database();
  for (let at = 0; at < items.length; at += 50) {
    await db.batch(items.slice(at, at + 50).map((item) => db.prepare(`INSERT INTO article_translations
      (owner_id, article_id, kind, source_text, normalized_source, translation)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, article_id, kind, normalized_source) DO UPDATE SET translation = excluded.translation, source_text = excluded.source_text`)
      .bind(owner, articleId, kind, item.source, normalize(item.source), item.translation)));
  }
}

export async function POST(request: Request) {
  let owner = "";
  let articleId = 0;
  try {
    owner = ownerId(request);
    const payload = await request.json() as { articleId?: number };
    articleId = Number(payload.articleId);
    if (!Number.isInteger(articleId) || articleId < 1) return Response.json({ error: "文章参数无效" }, { status: 400 });
    const db = database();
    const article = await db.prepare("SELECT id, content FROM articles WHERE id = ? AND owner_id = ?").bind(articleId, owner).first<ArticleRow>();
    if (!article) return Response.json({ error: "没有找到文章" }, { status: 404 });
    await db.prepare("UPDATE articles SET translation_status = 'processing', translation_error = NULL WHERE id = ? AND owner_id = ?").bind(articleId, owner).run();
    const sentences = extractSentences(article.content);
    const words = extractWords(article.content);
    const [sentenceTranslations, wordTranslations] = await Promise.all([
      translateManyWithDeepSeek(request, owner, sentences, "sentence"),
      translateManyWithDeepSeek(request, owner, words, "word"),
    ]);
    await db.prepare("DELETE FROM article_translations WHERE owner_id = ? AND article_id = ?").bind(owner, articleId).run();
    await insertTranslations(owner, articleId, "sentence", sentenceTranslations);
    await insertTranslations(owner, articleId, "word", wordTranslations);
    await db.prepare("UPDATE articles SET translation_status = 'ready', translation_provider = 'deepseek', translation_error = NULL, translated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?").bind(articleId, owner).run();
    return Response.json({ status: "ready", sentences: sentenceTranslations.length, words: wordTranslations.length });
  } catch (error) {
    const errorText = message(error).slice(0, 300);
    if (owner && Number.isInteger(articleId) && articleId > 0) {
      try { await database().prepare("UPDATE articles SET translation_status = 'failed', translation_error = ? WHERE id = ? AND owner_id = ?").bind(errorText, articleId, owner).run(); } catch { /* Best effort status update. */ }
    }
    return Response.json({ error: errorText, status: "failed" }, { status: 400 });
  }
}
