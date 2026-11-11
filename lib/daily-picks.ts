import { z } from "zod";
import { database } from "@/lib/site-data";

// Articles sent through the site owner's connector go to a shared
// daily list, and every account picks the ones it wants to read.
export const POOL_OWNER = "gist-selfhost-owner";
export const PICKS_PER_DAY = 5;
export const taipeiToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

export const articleInput = z.object({
  title: z.string().trim().min(1).max(180),
  shortTitle: z.string().trim().refine((value) => { const length = [...value.replace(/\s/g, "")].length; return length >= 2 && length <= 5; }, "shortTitle must be 2-5 characters, e.g. 粉色噪音"),
  content: z.string().trim().min(1).max(20000),
  publisher: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/),
  publishedDate: z.string().date(),
  sourceUrl: z.string().trim().max(2048).url().refine((url) => url.startsWith("https://")),
}).strict();
export type ArticleInput = z.infer<typeof articleInput>;

export function cleanSource(sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (url.username || url.password) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|cmp$|CMP$|ref$|src$)/.test(key)) url.searchParams.delete(key);
  }
  return url;
}

type Receipt = { id: number; title: string };
export type PickResult =
  | { status: "added"; article: Receipt; remainingToday: number }
  | { status: "duplicate_article"; article: Receipt; remainingToday: number }
  | { status: "list_full_today"; remainingToday: 0 }
  | { error: string };

export async function addPick(article: ArticleInput): Promise<PickResult> {
  const url = cleanSource(article.sourceUrl);
  if (!url) return { error: "Use an article URL without credentials." };
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
  `).bind(today, article.title, article.shortTitle.replace(/\s/g, ""), content, today, article.title, sourceMarker, sourceMarker).first<Receipt>();
  const count = await db.prepare("SELECT count(*) AS n FROM daily_picks WHERE pick_date = ?").bind(today).first<{ n: number }>();
  const remaining = Math.max(0, PICKS_PER_DAY - (count?.n ?? 0));
  if (inserted) return { status: "added", article: inserted, remainingToday: remaining };
  const existing = await db.prepare(`SELECT id, title FROM daily_picks WHERE ${duplicate} LIMIT 1`).bind(article.title, sourceMarker, sourceMarker).first<Receipt>();
  if (existing) return { status: "duplicate_article", article: existing, remainingToday: remaining };
  return { status: "list_full_today", remainingToday: 0 };
}
