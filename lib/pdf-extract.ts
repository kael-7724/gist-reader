// Turns a PDF article into Gist's plain format in the browser: one paragraph per block of text,
// with running headers, footers and page numbers removed. Loaded only when a PDF is picked.
import { publisherFor } from "./publishers";

export type PdfArticle = { title: string; content: string; publisher: string; publishedDate: string; sourceUrl: string; words: number; pages: number };

type Item = { str: string; x: number; y: number; w: number; size: number; bold: boolean };
type Line = { text: string; x: number; y: number; right: number; size: number; bold: boolean; page: number; top: boolean; bottom: boolean };

const median = (values: number[]) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const terminal = /[.!?:"”’)\]]$/;

function pdfDate(value: unknown) {
  const match = /^D?:?(\d{4})(\d{2})(\d{2})/.exec(String(value || ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

// Group text items into lines; a page with a clear gutter is read column by column.
function pageLines(items: Item[], width: number, height: number, page: number): Line[] {
  const mid = width / 2;
  const crossing = items.filter((item) => item.x < mid - 10 && item.x + item.w > mid + 10).length;
  const right = items.filter((item) => item.x >= mid).length;
  const columns = items.length > 30 && crossing < items.length * 0.05 && right > items.length * 0.25 ? [items.filter((item) => item.x < mid), items.filter((item) => item.x >= mid)] : [items];
  const lines: Line[] = [];
  for (const column of columns) {
    const sorted = [...column].sort((a, b) => b.y - a.y || a.x - b.x);
    let current: Item[] = [];
    const flush = () => {
      if (!current.length) return;
      current.sort((a, b) => a.x - b.x);
      let text = "";
      let end = -Infinity;
      for (const item of current) {
        const gap = item.x - end;
        if (text && gap > item.size * 0.18 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
        text += item.str;
        end = item.x + item.w;
      }
      text = text.replace(/­/g, "").replace(/\s+/g, " ").trim();
      if (text) {
        const size = median(current.map((item) => item.size));
        const y = current[0].y;
        lines.push({ text, x: current[0].x, y, right: end, size, bold: current.every((item) => item.bold), page, top: y > height * 0.93, bottom: y < height * 0.07 });
      }
      current = [];
    };
    for (const item of sorted) {
      if (current.length && Math.abs(item.y - current[0].y) > Math.max(2, current[0].size * 0.45)) flush();
      current.push(item);
    }
    flush();
  }
  return lines;
}

export async function extractPdf(file: File): Promise<PdfArticle> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as Record<string, unknown>;

  const lines: Line[] = [];
  for (let number = 1; number <= Math.min(doc.numPages, 80); number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }>;
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const [a, b, , d, e, f] = raw.transform as number[];
      const size = Math.hypot(a, b) || Math.abs(d) || raw.height || 10;
      const font = `${raw.fontName} ${styles[raw.fontName]?.fontFamily ?? ""}`;
      items.push({ str: raw.str, x: e, y: f, w: raw.width, size, bold: /bold|black|heavy|semibold/i.test(font) });
    }
    lines.push(...pageLines(items, viewport.width, viewport.height, number));
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.destroy();
  if (!lines.some((line) => /[A-Za-z]{3}/.test(line.text))) throw new Error("这个 PDF 里没有可以提取的文字（可能是扫描图片）");

  // Running headers and footers repeat on most pages (digits aside); browsers' "save as PDF" puts the
  // date and title at the top and the URL and page count at the bottom. Keep the URL and date as the source.
  const shape = (text: string) => text.replace(/\d+/g, "#").toLowerCase();
  const edgeCounts = new Map<string, Set<number>>();
  for (const line of lines) if (line.top || line.bottom) { const key = shape(line.text); if (!edgeCounts.has(key)) edgeCounts.set(key, new Set()); edgeCounts.get(key)!.add(line.page); }
  let sourceUrl = ""; let headerDate = "";
  const body = lines.filter((line) => {
    const pageNumber = /^(page\s*)?\d{1,3}(\s*(\/|of)\s*\d{1,3})?$/i.test(line.text);
    const repeated = (line.top || line.bottom) && pages > 1 && (edgeCounts.get(shape(line.text))?.size ?? 0) >= Math.max(2, pages * 0.5);
    if (!(pageNumber || repeated)) return true;
    sourceUrl ||= /https?:\/\/[^\s]+/.exec(line.text)?.[0] ?? "";
    const date = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(line.text);
    if (date && !headerDate) { const year = date[3].length === 2 ? `20${date[3]}` : date[3]; headerDate = `${year}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`; }
    return false;
  });

  const bodySize = median(body.filter((line) => line.text.length > 40).map((line) => line.size)) || median(body.map((line) => line.size));
  const left = median(body.filter((line) => Math.abs(line.size - bodySize) < 0.5).map((line) => line.x));
  const width = median(body.filter((line) => Math.abs(line.size - bodySize) < 0.5 && line.text.length > 40).map((line) => line.right - line.x));
  const gaps: number[] = [];
  for (let index = 1; index < body.length; index++) {
    const previous = body[index - 1]; const line = body[index];
    if (line.page === previous.page && Math.abs(line.size - bodySize) < 0.5 && Math.abs(previous.size - bodySize) < 0.5 && previous.y > line.y) gaps.push(previous.y - line.y);
  }
  const lineGap = median(gaps) || bodySize * 1.3;

  // The title is the largest text near the top of the first page.
  const firstPage = body.filter((line) => line.page === 1);
  const biggest = Math.max(...firstPage.map((line) => line.size), 0);
  let title = "";
  const titleLines = biggest >= bodySize * 1.35 ? firstPage.filter((line) => line.size >= biggest - 0.5).slice(0, 4) : [];
  if (titleLines.length) title = titleLines.map((line) => line.text).join(" ");
  const metaTitle = typeof info.Title === "string" ? info.Title.trim() : "";
  if (!title && metaTitle && !/^(untitled|microsoft word|document)/i.test(metaTitle)) title = metaTitle;
  if (!title) title = file.name.replace(/\.pdf$/i, "");

  const blocks: { text: string; heading: boolean }[] = [];
  let previous: Line | null = null;
  for (const line of body) {
    if (titleLines.includes(line)) { previous = null; continue; }
    const heading = line.text.length <= 120 && !terminal.test(line.text) && (line.size >= bodySize * 1.15 || (line.bold && line.size >= bodySize - 0.5 && line.text.length < 90));
    const block = blocks[blocks.length - 1];
    let starts = !block || heading || block.heading;
    if (!starts && previous) {
      if (line.page !== previous.page) starts = terminal.test(previous.text) && previous.right - previous.x < width * 0.8;
      else {
        const gap = previous.y - line.y;
        starts = gap > lineGap * 1.45 || gap < 0 // a jump back up means a new column of a new block
          || line.x > left + bodySize * 0.8 && Math.abs(line.x - previous.x) > bodySize * 0.5 // first-line indent
          || (terminal.test(previous.text) && previous.right - previous.x < width * 0.75) // short last line
          || Math.abs(line.size - previous.size) > 1.2;
      }
    }
    if (starts) blocks.push({ text: line.text, heading });
    else if (/[A-Za-z]-$/.test(block.text) && /^[a-z]/.test(line.text)) block.text = block.text.slice(0, -1) + line.text;
    else block.text += " " + line.text;
    previous = line;
  }

  const kept: string[] = [];
  for (const block of blocks) {
    const text = block.text.replace(/\s+/g, " ").trim();
    if (block.heading && /^(references|bibliography|works cited|notes|acknowledg(e)?ments|about the authors?|related (stories|articles)|more from|read more)$/i.test(text)) break;
    if (!block.heading && text.length < 25 && !terminal.test(text)) continue;
    if (/^(advertisement|sign up|subscribe)/i.test(text)) continue;
    // A byline before the first real paragraph ("By Jane Doe · 10 November 2026").
    if (!kept.some((item) => item.length > 120) && text.length < 120 && /^(by|words by|written by)\s+[A-Z]/i.test(text)) continue;
    kept.push(text);
  }
  while (kept.length && kept[kept.length - 1].length < 120 && !terminal.test(kept[kept.length - 1])) kept.pop();
  const content = kept.join("\n\n");
  const words = (content.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
  let publisher = "";
  if (sourceUrl) { try { const host = new URL(sourceUrl).hostname; publisher = publisherFor(host) || host.replace(/^www\./, ""); } catch { sourceUrl = ""; } }
  const publishedDate = headerDate || pdfDate(info.CreationDate) || pdfDate(info.ModDate);
  return { title: title.slice(0, 180), content, publisher, publishedDate, sourceUrl, words, pages };
}
