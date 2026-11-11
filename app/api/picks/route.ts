import { database, message, ownerId } from "@/lib/site-data";
import { kaoyanVocab, splitArticle } from "@/lib/article-meta";
import { englishLemmaCandidates } from "@/lib/english-lemma";
import { addPick, articleInput, POOL_OWNER, taipeiToday } from "@/lib/daily-picks";
import { suggestShortTitle } from "@/lib/deepseek";

type PickRow = { id: number; pickDate: string; title: string; shortTitle: string | null; content: string; articleId: number | null };

const articleColumns = "id, title, short_title AS shortTitle, content, translation_status AS translationStatus, translation_provider AS translationProvider, translation_error AS translationError, translated_at AS translatedAt, created_at AS createdAt";

function describe(row: PickRow) {
  const { body, source } = splitArticle(row.content);
  const tokens = body.toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [];
  const kaoyan = new Set<string>();
  for (const token of tokens) {
    const hit = englishLemmaCandidates(token).find((candidate) => kaoyanVocab.has(candidate));
    if (hit) kaoyan.add(hit);
  }
  const excerpt = body.split(/\n{2,}/).find((paragraph) => paragraph.trim().length > 60)?.trim().slice(0, 220) ?? "";
  return { id: row.id, title: row.title, shortTitle: row.shortTitle ?? "", publisher: source?.publisher ?? "", publishedDate: source?.publishedDate ?? "", words: tokens.length, kaoyan: kaoyan.size, excerpt, articleId: row.articleId };
}

// Today's shared list (or the latest one, until today's arrives) and which of it this account already added.
export async function GET(request: Request) {
  try {
    const owner = ownerId(request);
    const db = database();
    const latest = await db.prepare("SELECT max(pick_date) AS date FROM daily_picks WHERE pick_date <= ?").bind(taipeiToday()).first<{ date: string | null }>();
    if (!latest?.date) return Response.json({ date: null, picks: [], canAdd: owner === POOL_OWNER });
    const { results } = await db.prepare(`
      SELECT p.id, p.pick_date AS pickDate, p.title, p.short_title AS shortTitle, p.content,
        (SELECT a.id FROM articles a WHERE a.owner_id = ? AND lower(a.title) = lower(p.title) ORDER BY a.id DESC LIMIT 1) AS articleId
      FROM daily_picks p WHERE p.pick_date = ? ORDER BY p.id
    `).bind(owner, latest.date).all<PickRow>();
    return Response.json({ date: latest.date, picks: results.map(describe), canAdd: owner === POOL_OWNER });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

// Copy one article from the shared list into this account's library.
export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const db = database();
    const payload = await request.json() as { id?: number; action?: "add" | "short-title"; article?: unknown; title?: string; excerpt?: string };
    // The site owner's clip button: name an article, then add it to today's list.
    if (payload.action === "short-title" || payload.action === "add") {
      if (owner !== POOL_OWNER) return Response.json({ error: "只有管理员可以往今日精选里加文章" }, { status: 403 });
      if (payload.action === "short-title") {
        const shortTitle = await suggestShortTitle(request, owner, String(payload.title ?? "").slice(0, 300), String(payload.excerpt ?? ""));
        return Response.json({ shortTitle });
      }
      const parsed = articleInput.safeParse(payload.article);
      if (!parsed.success) return Response.json({ error: "文章信息不完整：" + parsed.error.issues.map((issue) => issue.path.join(".")).join("、") }, { status: 400 });
      const result = await addPick(parsed.data);
      return Response.json(result, { status: "error" in result ? 400 : 200 });
    }
    const { id } = payload;
    if (!Number.isInteger(id)) return Response.json({ error: "缺少文章" }, { status: 400 });
    const existing = await db.prepare(`SELECT ${articleColumns} FROM articles WHERE owner_id = ? AND lower(title) = (SELECT lower(title) FROM daily_picks WHERE id = ?) ORDER BY id DESC LIMIT 1`).bind(owner, id).first();
    if (existing) return Response.json({ article: existing });
    const article = await db.prepare(`
      INSERT INTO articles (owner_id, title, short_title, content, translation_provider)
      SELECT ?, title, short_title, content, 'deepseek' FROM daily_picks WHERE id = ?
      RETURNING ${articleColumns}
    `).bind(owner, id).first();
    if (!article) return Response.json({ error: "这篇已经不在今日精选里了" }, { status: 404 });
    return Response.json({ article }, { status: 201 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
