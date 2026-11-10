import { translateWithDeepSeek } from "@/lib/deepseek";
import { database, message, ownerId } from "@/lib/site-data";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const owner = ownerId(request);
    const word = url.searchParams.get("word")?.toLowerCase().replace(/[^a-z'-]/g, "").slice(0, 80) || "";
    const articleId = Number(url.searchParams.get("articleId"));
    if (!word) return Response.json({ error: "释义参数不完整" }, { status: 400 });
    if (url.searchParams.get("mode") === "realtime") {
      return Response.json({ translation: await translateWithDeepSeek(request, owner, word, "word"), source: "deepseek-realtime" });
    }
    if (!Number.isInteger(articleId) || articleId < 1) return Response.json({ error: "释义参数不完整" }, { status: 400 });
    const article = await database().prepare("SELECT translation_status, translation_provider FROM articles WHERE owner_id = ? AND id = ?").bind(owner, articleId).first<{ translation_status: string; translation_provider: string }>();
    if (!article || article.translation_status !== "ready" || article.translation_provider !== "deepseek") return Response.json({ error: "这篇文章尚未完成 DeepSeek 预翻译" }, { status: 409 });
    const row = await database().prepare("SELECT translation FROM article_translations WHERE owner_id = ? AND article_id = ? AND kind = 'word' AND normalized_source = ?").bind(owner, articleId, word).first<{ translation: string }>();
    if (!row) return Response.json({ error: "没有找到这个单词的预翻译" }, { status: 404 });
    return Response.json({ translation: row.translation });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
