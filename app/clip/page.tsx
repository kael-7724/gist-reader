"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Newspaper, X } from "lucide-react";
import { extractSource } from "@/lib/clip-extract";

type Clip = { title: string; publisher: string; publishedDate: string; sourceUrl: string; content: string };
type Phase = "idle" | "naming" | "adding" | "added" | "error";

const sites = ["The Guardian", "The Economist", "The Atlantic", "Scientific American", "The Conversation", "NASA Earth Observatory"];

function bookmarklet(origin: string) {
  const code = `(()=>{const gistExtract=${extractSource};const a=gistExtract();if(a.error){alert("Gist："+a.error);return}if(a.words<120){alert("Gist：没找到正文。等文章完全加载（需要的话先登录或订阅），再点一次。");return}let c=a.content;if(c.length>19500){c=c.slice(0,19500);c=c.slice(0,Math.max(c.lastIndexOf("\\n\\n"),0))}window.open(${JSON.stringify(`${origin}/clip`)}+"#"+encodeURIComponent(JSON.stringify({title:a.title,publisher:a.publisher,publishedDate:a.publishedDate,sourceUrl:a.sourceUrl,content:c})),"_blank")})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

function readClip(): Clip | null {
  if (!location.hash || location.hash.length < 10) return null;
  try {
    const data = JSON.parse(decodeURIComponent(location.hash.slice(1))) as Partial<Clip>;
    history.replaceState(null, "", location.pathname);
    if (!data.title || !data.content) return null;
    return { title: String(data.title), publisher: String(data.publisher ?? ""), publishedDate: String(data.publishedDate ?? ""), sourceUrl: String(data.sourceUrl ?? ""), content: String(data.content) };
  } catch {
    return null;
  }
}

async function post<T>(body: object) {
  const response = await fetch("/api/picks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  return { ok: response.ok, data };
}

export default function ClipPage() {
  const [clip, setClip] = useState<Clip | null>(null);
  const [ready, setReady] = useState(false);
  const [shortTitle, setShortTitle] = useState("");
  const [date, setDate] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const linkRef = useRef<HTMLAnchorElement>(null);
  const started = useRef(false);

  const add = useCallback(async (article: Clip, name: string, published: string) => {
    setPhase("adding");
    const { ok, data } = await post<{ status?: string; remainingToday?: number }>({ action: "add", article: { title: article.title, shortTitle: name, content: article.content, publisher: article.publisher, publishedDate: published, sourceUrl: article.sourceUrl } });
    if (ok && data.status === "added") { setPhase("added"); setNote(data.remainingToday ? `今天还能再加 ${data.remainingToday} 篇` : "今天的 5 篇已经满了"); return; }
    setPhase("error");
    setNote(data.status === "duplicate_article" ? "这篇已经在精选里了" : data.status === "list_full_today" ? "今天的 5 篇已经满了，明天再加" : data.error || "没加进去，再试一次");
  }, []);

  useEffect(() => {
    // React does not render javascript: links, so the bookmarklet is set on the element directly.
    linkRef.current?.setAttribute("href", bookmarklet(location.origin));
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const article = readClip();
    queueMicrotask(() => { setClip(article); setReady(true); });
    if (!article) return;
    const published = /^\d{4}-\d{2}-\d{2}$/.test(article.publishedDate) ? article.publishedDate : "";
    queueMicrotask(() => { setDate(published); setPhase("naming"); });
    (async () => {
      const excerpt = article.content.split("\n\n").slice(0, 3).join("\n\n");
      const { ok, data } = await post<{ shortTitle?: string }>({ action: "short-title", title: article.title, excerpt });
      if (!ok) { setPhase("error"); setNote(data.error || "简称没生成出来，自己填一个"); return; }
      const name = data.shortTitle ?? "";
      setShortTitle(name);
      if (name && published) await add(article, name, published);
      else { setPhase("error"); setNote(!published ? "没找到发表日期，补一下" : "简称没生成出来，自己填一个"); }
    })();
  }, [add]);

  const words = clip ? clip.content.split(/\s+/).length : 0;
  const nameOk = [...shortTitle.replace(/\s/g, "")].length >= 2 && [...shortTitle.replace(/\s/g, "")].length <= 5;

  return (
    <main className="clip-page">
      {!ready ? null : clip ? (
        <section className="clip-card">
          <p className="clip-meta">{[clip.publisher, date || "日期未知", `${words} 词`].join(" · ")}</p>
          <h1>{clip.title}</h1>
          <p className="clip-excerpt">{clip.content.slice(0, 280)}…</p>
          <div className="clip-fields">
            <input value={shortTitle} onChange={(event) => setShortTitle([...event.target.value].slice(0, 5).join(""))} placeholder="简称（2–5 字）" aria-label="简称" disabled={phase === "naming" || phase === "adding" || phase === "added"} />
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="发表日期" disabled={phase === "naming" || phase === "adding" || phase === "added"} />
          </div>
          <div className={`clip-status is-${phase}`} role="status">
            {phase === "naming" && <><Loader2 className="size-4 animate-spin" />正在起简称</>}
            {phase === "adding" && <><Loader2 className="size-4 animate-spin" />正在加入今日精选</>}
            {phase === "added" && <><Check className="size-4" />已加入今日精选<small>{note}</small></>}
            {phase === "error" && <><X className="size-4" />{note}</>}
          </div>
          <div className="clip-actions">
            {phase === "error" && <button type="button" className="clip-primary" disabled={!nameOk || !date} onClick={() => void add(clip, shortTitle.replace(/\s/g, ""), date)}>加入今日精选</button>}
            {phase === "added" && <button type="button" className="clip-primary" onClick={() => window.close()}>回到文章</button>}
            <Link className="clip-secondary" href="/">打开 Gist</Link>
          </div>
        </section>
      ) : (
        <section className="clip-card">
          <p className="clip-meta"><Newspaper className="size-4" />今日精选 · 一键导入</p>
          <h1>把正在读的外刊，一键放进今日精选</h1>
          <ol className="clip-steps">
            <li>把下面这个按钮<b>拖到浏览器的书签栏</b>（书签栏没显示的话按 Ctrl/⌘ + Shift + B）。</li>
            <li>打开一篇外刊文章，等正文加载完，点书签栏里的「→ Gist 精选」。</li>
            <li>会弹出一个新标签页，自动起简称并加入今日精选，每天最多 5 篇。</li>
          </ol>
          <a ref={linkRef} className="clip-bookmarklet" onClick={(event) => event.preventDefault()} draggable>→ Gist 精选</a>
          <p className="clip-sites">支持：{sites.join("、")}</p>
          <p className="clip-note">只有管理员账号能往精选里加文章；简称用你连接的 DeepSeek 生成。</p>
        </section>
      )}
    </main>
  );
}
