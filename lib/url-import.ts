import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

// Turns an article web page into Gist's plain format: paragraphs separated by blank lines,
// ending with "publisher | date" and the source URL so the reader can show where it came from.

export type ImportedPage = { title: string; publisher: string; publishedDate: string; sourceUrl: string; content: string; words: number };

type Part = { text: string; heading: boolean };
// linkedom's DOM is close enough to the browser's for what we touch here.
type Node = { tagName?: string; parentElement: Node | null; className?: unknown; textContent: string | null; firstElementChild: Node | null; firstChild: unknown; getAttribute(name: string): string | null; hasAttribute(name: string): boolean; querySelectorAll(selector: string): Iterable<Node>; querySelector(selector: string): Node | null; closest?(selector: string): Node | null; remove(): void };

const KNOWN: [string, string][] = [
  ["theguardian.com", "The Guardian"], ["economist.com", "The Economist"], ["theatlantic.com", "The Atlantic"],
  ["scientificamerican.com", "Scientific American"], ["theconversation.com", "The Conversation"], ["nytimes.com", "The New York Times"],
  ["washingtonpost.com", "The Washington Post"], ["bbc.com", "BBC"], ["bbc.co.uk", "BBC"], ["ft.com", "Financial Times"],
  ["newyorker.com", "The New Yorker"], ["wired.com", "WIRED"], ["nature.com", "Nature"], ["science.org", "Science"],
  ["aeon.co", "Aeon"], ["vox.com", "Vox"], ["time.com", "TIME"], ["nasa.gov", "NASA"], ["npr.org", "NPR"], ["reuters.com", "Reuters"],
];

const clean = (text: string | null | undefined) => (text || "").replace(/ /g, " ").replace(/[ \t\r\n]+/g, " ").trim();

export function checkUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("网址格式不对，请粘贴完整的文章链接（以 https:// 开头）"); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("只支持 http 或 https 网址");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) throw new Error("这个网址不能导入");
  url.hash = "";
  return url;
}

export function extractArticle(html: string, pageUrl: URL): ImportedPage {
  const { document } = parseHTML(html) as unknown as { document: Node & { title: string; body: Node; documentElement: Node; cloneNode(deep: boolean): unknown } };
  const readabilityCopy = parseHTML(html).document;
  for (const node of [...document.querySelectorAll("script:not([type='application/ld+json']), style, noscript, template, svg, iframe")]) node.remove();

  let ld: Record<string, unknown> = {};
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record["@graph"]) walk(record["@graph"]);
    if ([record["@type"]].flat().some((type) => /Article|Posting|Report/.test(String(type))) && !ld.headline) ld = record;
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(script.textContent || "")); } catch { /* not every block is valid JSON */ } }
  const meta = (name: string) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") || "";

  const host = pageUrl.hostname.replace(/^www\./, "");
  const ldPublisher = (ld.publisher && typeof ld.publisher === "object" ? (ld.publisher as Record<string, unknown>).name : "") as string;
  const publisher = clean(KNOWN.find(([domain]) => host === domain || host.endsWith("." + domain))?.[1] || meta("og:site_name") || ldPublisher || host).slice(0, 60);

  const escaped = publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const title = clean(document.querySelector("h1")?.textContent || (ld.headline as string) || meta("og:title") || document.title)
    .replace(new RegExp(`\\s+[|–—-]\\s+${escaped}.*$`, "i"), "").slice(0, 180);

  const rawDate = String(ld.datePublished || meta("article:published_time") || meta("date") || meta("dc.date") || meta("DC.date.issued") || document.querySelector("time[datetime]")?.getAttribute("datetime") || "");
  const parsed = new Date(rawDate);
  const publishedDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);

  let source: URL;
  try { source = new URL(document.querySelector('link[rel="canonical"]')?.getAttribute("href") || meta("og:url") || pageUrl.href, pageUrl); } catch { source = new URL(pageUrl.href); }
  source.hash = "";
  for (const key of [...source.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|cmp$|ref$|src$|giftLink|gift|share)/i.test(key)) source.searchParams.delete(key);

  const skipTag = /^(FIGURE|FIGCAPTION|ASIDE|NAV|FOOTER|HEADER|FORM|BUTTON|DIALOG|TABLE)$/;
  const skipClass = /newsletter|subscri|signup|sign-up|related|recirc|paywall|plea|caption|byline|author|share|social|advert|promo-|-promo$|^promo|header|standfirst|^dek|_dek|-dek|credit|comment|(^|[-_])ads?([-_]|$)/i;
  const skipped = (element: Node, root: Node, inBody = false) => {
    for (let node: Node | null = element; node && node !== root; node = node.parentElement) {
      if (skipTag.test(node.tagName || "") || node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" || node.getAttribute("aria-modal") === "true" || /dialog|alertdialog/.test(node.getAttribute("role") || "")) return true;
      // Inside the body, links, list items and nested articles are teaser cards, not prose.
      if (inBody && node !== element && /^(A|ARTICLE|LI)$/.test(node.tagName || "")) return true;
      if (typeof node.className === "string" && node.className.split(/\s+/).some((name) => skipClass.test(name))) return true;
      if (/related|newsletter|advert|^ad/i.test(node.getAttribute("data-component") || node.getAttribute("data-block") || "")) return true;
    }
    return false;
  };
  const collect = (root: Node) => {
    const parts: Part[] = [];
    for (const element of root.querySelectorAll("p, h2, h3, blockquote")) {
      if (skipped(element, root, true)) continue;
      // A quote is kept once: as its own paragraphs when it has them, otherwise as one block.
      if (element.tagName === "BLOCKQUOTE" && element.querySelector("p")) continue;
      let text = clean(element.textContent);
      // A drop cap is a separate element, so the text reads "T he first…".
      const lead = element.firstElementChild;
      const leadText = clean(lead?.textContent);
      if (lead && element.firstChild === lead && /^\S{1,2}$/.test(leadText) && text.startsWith(leadText + " ")) text = leadText + text.slice(leadText.length + 1);
      if (!text) continue;
      if (/^H[23]$/.test(element.tagName || "")) {
        if (/^(downloads?|references|related( stories| content| articles)?|more (from|on|stories).*|read more|you might also like|about the authors?|credits?|comments?|most (read|popular))$/i.test(text)) break;
        if (text.length <= 120 && !/^(sign up|newsletter|subscribe|advertisement)/i.test(text)) parts.push({ text, heading: true });
        continue;
      }
      if (text.length < 40 && !/[.!?"”’)]$/.test(text)) continue;
      if (/^(sign up|subscribe|read more|related:|advertisement|this article (was|is) (originally )?(published|republished)|(nasa earth observatory )?(images?|photographs?|story|video) by )/i.test(text)) continue;
      if (parts.length && parts[parts.length - 1].text === text) continue;
      parts.push({ text, heading: false });
    }
    while (parts.length && parts[parts.length - 1].heading) parts.pop();
    while (parts.length && parts[0].heading) parts.shift();
    return parts;
  };
  const count = (parts: Part[]) => parts.reduce((sum, part) => sum + (part.heading ? 0 : part.text.split(" ").length), 0);

  // The article body is the deepest element that holds most of the page's long paragraphs.
  const coverage = new Map<Node, number>();
  let total = 0;
  for (const paragraph of document.querySelectorAll("p")) {
    const length = clean(paragraph.textContent).length;
    if (length < 80 || skipped(paragraph, document.body)) continue;
    total += length;
    for (let node = paragraph.parentElement; node && node !== document.documentElement; node = node.parentElement) coverage.set(node, (coverage.get(node) || 0) + length);
  }
  const depth = (node: Node | null) => { let level = 0; for (; node; node = node.parentElement) level++; return level; };
  const dense = [...coverage].filter(([, covered]) => covered >= total * 0.75).sort((x, y) => depth(y[0]) - depth(x[0]))[0]?.[0];
  let best = dense ? collect(dense) : [];
  for (const selector of ['[itemprop="articleBody"]', "article", "main", '[role="main"]']) {
    if (count(best) >= 150) break;
    const root = document.querySelector(selector);
    if (root) { const parts = collect(root); if (count(parts) > count(best)) best = parts; }
  }
  // Last resort: Mozilla's Readability, the engine behind Firefox's reader view.
  if (count(best) < 150) {
    try {
      const article = new Readability(readabilityCopy as unknown as Document).parse();
      if (article?.content) {
        const { document: readable } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`) as unknown as { document: { body: Node } };
        const parts = collect(readable.body);
        if (count(parts) > count(best)) best = parts;
      }
    } catch { /* keep what we have */ }
  }
  const words = count(best);
  return { title, publisher, publishedDate, sourceUrl: source.href, content: best.map((part) => part.text).join("\n\n"), words };
}

export async function fetchPage(url: URL) {
  const response = await fetch(url.href, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  }).catch((error: unknown) => { throw new Error(error instanceof Error && error.name === "TimeoutError" ? "网站响应太慢，请稍后再试" : "打不开这个网址"); });
  if (response.status === 401 || response.status === 403 || response.status === 429) throw new Error(`这个网站拒绝了自动读取（${response.status}），可以复制正文粘贴到下面`);
  if (!response.ok) throw new Error(`网页打不开（${response.status}）`);
  const type = response.headers.get("content-type") || "";
  if (type && !/html|xml/i.test(type)) throw new Error("这个网址不是网页文章（可能是 PDF 或图片）");
  // Cap what we read: article pages are rarely over a few megabytes.
  const reader = response.body?.getReader();
  if (!reader) return { html: await response.text(), finalUrl: new URL(response.url || url.href) };
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength; chunks.push(value);
    if (size > 5_000_000) { await reader.cancel(); break; }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk.subarray(0, Math.min(chunk.byteLength, size - offset)), offset); offset += chunk.byteLength; if (offset >= size) break; }
  const charset = /charset=([\w-]+)/i.exec(type)?.[1] || "utf-8";
  let html: string;
  try { html = new TextDecoder(charset).decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
  return { html, finalUrl: new URL(response.url || url.href) };
}
