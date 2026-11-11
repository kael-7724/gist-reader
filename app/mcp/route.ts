import { z } from "zod";
import { database, message } from "@/lib/site-data";
import { PICKS_PER_DAY, POOL_OWNER, taipeiToday } from "@/lib/daily-picks";

const toolName = "import_daily_article";
const fields = {
  title: { type: "string", description: "The article's original headline exactly as published. No date prefix, no site name suffix (e.g. no \" | The Guardian\"), no translation." },
  content: { type: "string", description: "Clean body text only, copied verbatim in order, one blank line between paragraphs. Keep section subheadings as their own lines. Remove photo captions and credits, \"View image in fullscreen\", bylines, author bios, related/recommended/read-more links, newsletter or subscription prompts, ads, share buttons and republishing notes. Do not summarise, rewrite or translate. If the article is very long, send consecutive complete paragraphs from the start and stop at a paragraph end." },
  shortTitle: { type: "string", description: "A short Chinese name for the article, at most 5 characters, naming its core topic so the reader recognises it at a glance (e.g. 粉色噪音, 臭氧空洞, 技能退化, 银牌之痛, 中期选举). Chinese only (a common acronym like AI is allowed), no punctuation, no dates, not a translation of the whole headline." },
  publisher: { type: "string", description: "The publication's own name, e.g. The Guardian, The Economist, Scientific American, The Atlantic, The Conversation, NASA Earth Observatory." },
  publishedDate: { type: "string", description: "The article's original publication date, YYYY-MM-DD (not today's date)." },
  sourceUrl: { type: "string", description: "Canonical HTTPS URL of the article page, without tracking parameters." },
};
const articleInput = z.object({
  title: z.string().trim().min(1).max(180),
  shortTitle: z.string().trim().refine((value) => { const length = [...value.replace(/\s/g, "")].length; return length >= 2 && length <= 5; }, "shortTitle must be 2-5 characters, e.g. 粉色噪音"),
  content: z.string().trim().min(1).max(20000),
  publisher: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/),
  publishedDate: z.string().date(),
  sourceUrl: z.string().trim().max(2048).url().refine((url) => url.startsWith("https://")),
}).strict();

type RpcRequest = { id?: string | number | null; method?: string; params?: { name?: string; arguments?: unknown } };
type ArticleReceipt = { id: number; title: string };

function toolResult(result: object, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(result) }], isError };
}

function cleanSource(sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (url.username || url.password) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|cmp$|CMP$|ref$|src$)/.test(key)) url.searchParams.delete(key);
  }
  return url;
}

async function addPick(args: unknown) {
  const article = articleInput.parse(args);
  const url = cleanSource(article.sourceUrl);
  if (!url) return toolResult({ error: "Use an article URL without credentials." }, true);
  const today = taipeiToday();
  const sourceMarker = `\n${url.href}`;
  const content = `${article.content}\n\n${article.publisher} | ${article.publishedDate}${sourceMarker}`;
  const db = database();
  const duplicate = "lower(title) = lower(?) OR substr(content, -length(?)) = ?";
  const inserted = await db.prepare(`
    INSERT INTO daily_picks (pick_date, title, short_title, content)
    SELECT ?, ?, ?, ?
    WHERE (SELECT count(*) FROM daily_picks WHERE pick_date = ?) < ${PICKS_PER_DAY}
      AND NOT EXISTS (SELECT 1 FROM daily_picks WHERE ${duplicate})
    RETURNING id, title
  `).bind(today, article.title, article.shortTitle.replace(/\s/g, ""), content, today, article.title, sourceMarker, sourceMarker).first<ArticleReceipt>();
  const count = await db.prepare("SELECT count(*) AS n FROM daily_picks WHERE pick_date = ?").bind(today).first<{ n: number }>();
  const remaining = Math.max(0, PICKS_PER_DAY - (count?.n ?? 0));
  if (inserted) return toolResult({ status: "added", article: inserted, remainingToday: remaining });
  const existing = await db.prepare(`SELECT id, title FROM daily_picks WHERE ${duplicate} LIMIT 1`).bind(article.title, sourceMarker, sourceMarker).first<ArticleReceipt>();
  if (existing) return toolResult({ status: "duplicate_article", article: existing, remainingToday: remaining });
  return toolResult({ status: "list_full_today", remainingToday: 0 });
}

async function importArticle(request: Request, args: unknown) {
  const owner = request.headers.get("oai-authenticated-user-id");
  if (!owner) return toolResult({ error: "Sign in to Gist before importing an article." }, true);
  if (owner === POOL_OWNER) return addPick(args);

  const article = articleInput.parse(args);
  const url = cleanSource(article.sourceUrl);
  if (!url) return toolResult({ error: "Use an article URL without credentials." }, true);

  const today = taipeiToday();
  const dayMarker = `\n\nDaily reading | ${today}\n`;
  const sourceMarker = `\n${url.href}`;
  const content = `${article.content}${dayMarker}${article.publisher} | ${article.publishedDate}${sourceMarker}`;

  const sameDay = "instr(content, ?) > 0";
  const duplicate = `${sameDay} OR lower(title) = lower(?) OR substr(content, -length(?)) = ?`;
  const db = database();
  const inserted = await db.prepare(`
    INSERT INTO articles (owner_id, title, short_title, content, translation_provider)
    SELECT ?, ?, ?, ?, 'deepseek'
    WHERE NOT EXISTS (SELECT 1 FROM articles WHERE owner_id = ? AND (${duplicate}))
    RETURNING id, title
  `).bind(owner, article.title, article.shortTitle.replace(/\s/g, ""), content, owner, dayMarker, article.title, sourceMarker, sourceMarker).first<ArticleReceipt>();
  if (inserted) return toolResult({ status: "imported", article: inserted });

  const existing = await db.prepare(`
    SELECT id, title, ${sameDay} AS today
    FROM articles WHERE owner_id = ? AND (${duplicate})
    ORDER BY today DESC, id DESC LIMIT 1
  `).bind(dayMarker, owner, dayMarker, article.title, sourceMarker, sourceMarker).first<ArticleReceipt & { today: number }>();
  if (!existing) return toolResult({ error: "Import could not be verified. Retry the same article." }, true);
  return toolResult({
    status: existing.today ? "already_imported_today" : "duplicate_article",
    article: { id: existing.id, title: existing.title },
  });
}

export async function POST(request: Request) {
  const rpc = await request.json().catch(() => null) as RpcRequest | null;
  const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: rpc?.id ?? null, result });
  const error = (code: number, message: string) => Response.json({ jsonrpc: "2.0", id: rpc?.id ?? null, error: { code, message } });
  switch (rpc?.method) {
    case "server/discover":
      return reply({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
    case "tools/list":
      return reply({ tools: [{
        name: toolName,
        description: request.headers.get("oai-authenticated-user-id") === POOL_OWNER
          ? `Add one English article to today's shared Gist reading list. The list takes ${PICKS_PER_DAY} different articles a day and every reader picks the ones they want, so call this once per article, ${PICKS_PER_DAY} times. The title, publisher, date and URL are shown above the article, so they must be accurate. Returns added (with remainingToday), duplicate_article (choose a different article), or list_full_today (stop).`
          : "Save one English article (the day's reading) to the user's private Gist library. The title, publisher, date and URL are shown above the article, so they must be accurate. Returns the saved article ID, or already_imported_today / duplicate_article.",
        inputSchema: { type: "object", properties: fields, required: Object.keys(fields), additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }] });
    case "tools/call":
      if (rpc.params?.name !== toolName) return error(-32602, "Unknown tool");
      try {
        return reply(await importArticle(request, rpc.params.arguments));
      } catch (cause) {
        return reply(toolResult({ error: message(cause) }, true));
      }
    default:
      return error(-32601, "Method not found");
  }
}
