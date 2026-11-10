import { translateWithDeepSeek } from "@/lib/deepseek";
import { database, message, ownerId } from "@/lib/site-data";

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const payload = await request.json() as { text?: string; context?: string; articleId?: number; type?: "word" | "phrase" | "sentence"; mode?: "realtime" | "pretranslated" };
    const text = payload.text?.trim().slice(0, 2000) || "";
    const articleId = Number(payload.articleId);
    if (!text || !Number.isInteger(articleId) || articleId < 1 || !payload.type) return Response.json({ error: "翻译参数不完整" }, { status: 400 });
    const article = await database().prepare("SELECT translation_status, translation_error, translation_provider FROM articles WHERE id = ? AND owner_id = ?").bind(articleId, owner).first<{ translation_status: string; translation_error: string | null; translation_provider: string }>();
    if (!article) return Response.json({ error: "没有找到文章" }, { status: 404 });
    if (payload.mode === "realtime" || payload.type === "phrase") {
      return Response.json({ translation: await translateWithDeepSeek(request, owner, text, payload.type, payload.context || ""), source: "deepseek-realtime" });
    }
    if (article.translation_status === "pending" || article.translation_status === "processing") return Response.json({ error: "文章正在后台翻译，请稍后再试" }, { status: 409 });
    if (article.translation_status === "failed") return Response.json({ error: article.translation_error || "文章预翻译失败，请重试" }, { status: 409 });
    if (article.translation_provider !== "deepseek") return Response.json({ error: "旧文章尚未完成 DeepSeek 预翻译，请稍后再试" }, { status: 409 });
    let row = await database().prepare("SELECT translation FROM article_translations WHERE owner_id = ? AND article_id = ? AND kind = ? AND normalized_source = ?").bind(owner, articleId, payload.type, normalize(text)).first<{ translation: string }>();
    if (!row && payload.type === "sentence") {
      const target = normalize(text).replace(/[.!?]+$/, "");
      const candidates = await database().prepare("SELECT normalized_source, translation FROM article_translations WHERE owner_id = ? AND article_id = ? AND kind = 'sentence'").bind(owner, articleId).all<{ normalized_source: string; translation: string }>();
      const match = candidates.results.find((item) => item.normalized_source.replace(/[.!?]+$/, "") === target);
      if (match) row = { translation: match.translation };
    }
    if (!row) return Response.json({ error: payload.type === "sentence" ? "请划选一个完整句子" : "没有找到这个单词的预翻译" }, { status: 404 });
    return Response.json({ translation: row.translation });
  } catch (error) {
    console.error("Translation lookup failed", message(error));
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
