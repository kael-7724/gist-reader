import { translateParagraphWithDeepSeek } from "@/lib/deepseek";
import { database, message, ownerId } from "@/lib/site-data";

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// POST {articleId, text, previous?} → {translation}. Cached per article so a second read is instant.
export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const payload = await request.json() as { text?: string; previous?: string; articleId?: number };
    const text = payload.text?.trim().slice(0, 6000) || "";
    const articleId = Number(payload.articleId);
    if (!text || !Number.isInteger(articleId)) return Response.json({ error: "翻译参数不完整" }, { status: 400 });
    const cached = articleId > 0;
    if (cached) {
      const article = await database().prepare("SELECT id FROM articles WHERE id = ? AND owner_id = ?").bind(articleId, owner).first();
      if (!article) return Response.json({ error: "没有找到文章" }, { status: 404 });
      const row = await database().prepare("SELECT translation FROM article_translations WHERE owner_id = ? AND article_id = ? AND kind = 'paragraph' AND normalized_source = ?").bind(owner, articleId, normalize(text)).first<{ translation: string }>();
      if (row) return Response.json({ translation: row.translation, cached: true });
    }
    const translation = await translateParagraphWithDeepSeek(request, owner, text, payload.previous || "");
    if (cached) {
      await database().prepare("INSERT OR IGNORE INTO article_translations (owner_id, article_id, kind, source_text, normalized_source, translation) VALUES (?, ?, 'paragraph', ?, ?, ?)").bind(owner, articleId, text, normalize(text), translation).run();
    }
    return Response.json({ translation });
  } catch (error) {
    console.error("Paragraph translation failed", message(error));
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
