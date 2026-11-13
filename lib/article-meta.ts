import kaoyanWords from "./kaoyan-vocab.json";

export type ArticleSource = { publisher: string; publishedDate: string; url: string };

// Articles can end with an optional "Daily reading | date" line, then "publisher | date" and, optionally, the source URL.
// Show that as metadata under the title, not as text to read.
const sourceFooter = /\n+\s*(?:Daily reading \| \d{4}-\d{2}-\d{2}\s*\n\s*)?([^\n|]{1,80}?) \| (\d{4}-\d{2}-\d{2})(?:\s*\n\s*(https?:\/\/\S+))?\s*$/;

export function splitArticle(content: string): { body: string; source: ArticleSource | null } {
  const match = sourceFooter.exec(content);
  if (!match) return { body: content, source: null };
  return { body: content.slice(0, match.index).trimEnd(), source: { publisher: match[1].trim(), publishedDate: match[2], url: match[3] || "" } };
}

function parseStoredDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatImportDate(value: string, short = false) {
  const date = parseStoredDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("zh-CN", short
    ? { timeZone: "Asia/Taipei", month: "long", day: "numeric" }
    : { timeZone: "Asia/Taipei", year: "numeric", month: "long", day: "numeric" }).format(date);
}

export const kaoyanVocab = new Set<string>(kaoyanWords as string[]);
