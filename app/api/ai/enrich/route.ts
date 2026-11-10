import { generateWordEnrichment, type WordEnrichment } from "@/lib/ai";
import { database, message, ownerId } from "@/lib/site-data";

export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const { id, refresh } = await request.json() as { id?: number; refresh?: boolean };
    if (!Number.isInteger(id) || !id || id < 1) return Response.json({ error: "单词编号无效" }, { status: 400 });
    const db = database();
    const word = await db.prepare("SELECT text, translation FROM saved_words WHERE owner_id = ? AND id = ?").bind(owner, id).first<{ text: string; translation: string }>();
    if (!word) return Response.json({ error: "没有找到这个单词" }, { status: 404 });
    const existing = await db.prepare("SELECT similar_json AS similarJson, lookalike_json AS lookalikeJson FROM word_ai_enrichments WHERE owner_id = ? AND word = ?")
      .bind(owner, word.text).first<{ similarJson: string; lookalikeJson: string }>();
    if (existing && !refresh) return Response.json({ id, similar: JSON.parse(existing.similarJson), lookalike: JSON.parse(existing.lookalikeJson), cached: true });
    const enrichment: WordEnrichment = await generateWordEnrichment(request, owner, word.text, word.translation);
    await db.prepare(`INSERT INTO word_ai_enrichments (owner_id, word, similar_json, lookalike_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id, word) DO UPDATE SET similar_json = excluded.similar_json,
      lookalike_json = excluded.lookalike_json, generated_at = CURRENT_TIMESTAMP`)
      .bind(owner, word.text, JSON.stringify(enrichment.similar), JSON.stringify(enrichment.lookalike)).run();
    return Response.json({ id, ...enrichment, cached: false });
  } catch (error) { return Response.json({ error: message(error) }, { status: 502 }); }
}
