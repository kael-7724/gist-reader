// Runs on the article page through the bookmarklet (see app/clip/page.tsx); not imported anywhere.
/* eslint-disable @typescript-eslint/no-unused-vars */
function gistExtract() {
  const host = location.hostname.replace(/^www\./, "");
  const sites = [
    ["theguardian.com", "The Guardian", '[data-gu-name="body"], #maincontent, article'],
    ["economist.com", "The Economist", '[data-test-id="Article"], [data-body-id], article, main'],
    ["theatlantic.com", "The Atlantic", 'article [class*="ArticleBody"], article, main'],
    ["scientificamerican.com", "Scientific American", '[data-block="sciam/article"], article, main'],
    ["theconversation.com", "The Conversation", '[itemprop="articleBody"], .content-body, article'],
    ["earthobservatory.nasa.gov", "NASA Earth Observatory", "article, main"],
    ["science.nasa.gov", location.pathname.includes("earth-observatory") ? "NASA Earth Observatory" : "NASA Science", "article, main"],
  ];
  const site = sites.find(([domain]) => host === domain || host.endsWith("." + domain));
  if (!site) return { error: "这个网站不在支持列表里" };
  const [, publisher, selectors] = site;

  let ld = {};
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node["@graph"]) walk(node["@graph"]);
    if ([].concat(node["@type"] || []).some((type) => /Article|Posting|Report/.test(type)) && !ld.headline) ld = node;
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(script.textContent)); } catch { /* ignore */ } }
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") || "";
  const clean = (text) => (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const title = clean(document.querySelector("h1")?.innerText || ld.headline || meta("og:title") || document.title)
    .replace(/\s+[|–—-]\s+(The Guardian|The Economist|The Atlantic|Scientific American|The Conversation|NASA.*)$/i, "");
  const rawDate = ld.datePublished || meta("article:published_time") || meta("date") || meta("dc.date") || document.querySelector("time[datetime]")?.getAttribute("datetime") || "";
  const parsed = new Date(rawDate);
  const publishedDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);

  const source = new URL(document.querySelector('link[rel="canonical"]')?.href || meta("og:url") || location.href, location.href);
  source.hash = "";
  for (const key of [...source.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|cmp$|CMP$|ref$|src$|giftLink|gift)/i.test(key)) source.searchParams.delete(key);

  const skipTag = /^(FIGURE|FIGCAPTION|ASIDE|NAV|FOOTER|HEADER|FORM|BUTTON|DIALOG)$/;
  const skipClass = /newsletter|subscri|signup|sign-up|related|recirc|paywall|plea|caption|byline|author|share|social|advert|promo-|-promo$|^promo|header|standfirst|^dek|_dek|-dek|credit|(^|[-_])ads?([-_]|$)/i;
  const skipped = (element, root, inBody = false) => {
    for (let node = element; node && node !== root; node = node.parentElement) {
      if (skipTag.test(node.tagName) || node.hidden || node.getAttribute("aria-hidden") === "true" || node.getAttribute("aria-modal") === "true" || /dialog|alertdialog/.test(node.getAttribute("role") || "")) return true;
      // Inside the body, links, list items and nested articles are teaser cards, not prose.
      if (inBody && node !== element && /^(A|ARTICLE|LI)$/.test(node.tagName)) return true;
      if (typeof node.className === "string" && node.className.split(/\s+/).some((name) => skipClass.test(name))) return true;
      if (/related|newsletter|advert|^ad/i.test(node.getAttribute("data-component") || node.getAttribute("data-block") || "")) return true;
    }
    return false;
  };
  const collect = (root) => {
    const parts = [];
    for (const element of root.querySelectorAll("p, h2, h3, blockquote")) {
      if (skipped(element, root, true)) continue;
      if (element.tagName !== "BLOCKQUOTE" && element.parentElement?.closest("blockquote")) continue;
      if (element.tagName === "BLOCKQUOTE" && element.querySelector("p")) continue;
      const text = clean(element.innerText);
      if (!text) continue;
      if (/^H[23]$/.test(element.tagName)) {
        if (/^(downloads?|references|related( stories| content)?|more (from|on|stories).*|read more|you might also like|about the authors?|credits?)$/i.test(text)) break;
        if (text.length <= 120 && !/^(sign up|newsletter|subscribe)/i.test(text)) parts.push({ text, heading: true });
        continue;
      }
      if (text.length < 40 && !/[.!?"”’)]$/.test(text)) continue;
      if (/^(sign up|subscribe|read more|related:|this article (was|is) (originally )?(published|republished)|(nasa earth observatory )?(images?|photographs?|story|video) by )/i.test(text)) continue;
      if (parts.length && parts[parts.length - 1].text === text) continue;
      parts.push({ text, heading: false });
    }
    while (parts.length && parts[parts.length - 1].heading) parts.pop();
    return parts;
  };
  const words = (parts) => parts.reduce((sum, part) => sum + (part.heading ? 0 : part.text.split(" ").length), 0);
  // The article body is the deepest element that holds most of the page's long paragraphs.
  const coverage = new Map();
  let total = 0;
  for (const paragraph of document.querySelectorAll("p")) {
    const length = clean(paragraph.innerText).length;
    if (length < 80 || skipped(paragraph, document.body)) continue;
    total += length;
    for (let node = paragraph.parentElement; node && node !== document.documentElement; node = node.parentElement) coverage.set(node, (coverage.get(node) || 0) + length);
  }
  const depth = (node) => { let level = 0; for (; node; node = node.parentElement) level++; return level; };
  const dense = [...coverage].filter(([, covered]) => covered >= total * 0.75).sort((x, y) => depth(y[0]) - depth(x[0]))[0]?.[0];
  let best = dense ? collect(dense) : [];
  for (const selector of selectors.split(",")) {
    if (words(best) >= 150) break;
    const root = document.querySelector(selector.trim());
    if (root) { const parts = collect(root); if (words(parts) > words(best)) best = parts; }
  }
  const content = best.map((part) => part.text).join("\n\n");
  return { title, publisher, publishedDate, sourceUrl: source.href, content, words: words(best) };
}
