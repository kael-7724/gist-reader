"use client";

import { useEffect, useMemo, useState } from "react";
import { englishLemmaCandidates } from "@/lib/english-lemma";
import { splitArticle } from "@/lib/article-meta";

// Each entry: [spellings, isCore (1 = 必考词, 0 = 基础词), times it appears in past exam papers].
type Entry = [string[], 0 | 1, number];
type CoverageArticle = { id: number; title: string; shortTitle?: string; content: string; createdAt: string };

function percent(part: number, whole: number) {
  if (!whole) return "0%";
  const value = (part / whole) * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function Meter({ label, value, total, large = false }: { label: string; value: number; total: number; large?: boolean }) {
  return (
    <div className={`coverage-meter ${large ? "large" : ""}`}>
      <div className="coverage-meter-head">
        <span>{label}</span>
        <strong>{value.toLocaleString()}<small> / {total.toLocaleString()} · {percent(value, total)}</small></strong>
      </div>
      <div className="coverage-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
        <span style={{ width: `${total ? Math.max(value ? 0.6 : 0, (value / total) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

export function KaoyanCoverage({ articles, savedWords }: { articles: CoverageArticle[]; savedWords: string[] }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/kaoyan-vocab-meta.json").then((module) => {
      const data = (module.default ?? module) as { entries: Entry[] };
      if (!cancelled) setEntries(data.entries);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const coverage = useMemo(() => {
    if (!entries) return null;
    const bySpelling = new Map<string, number>();
    entries.forEach(([spellings], index) => spellings.forEach((spelling) => bySpelling.set(spelling, index)));

    const lemmaCache = new Map<string, number[]>();
    const entriesFor = (token: string) => {
      const key = token.toLowerCase();
      let found = lemmaCache.get(key);
      if (!found) {
        found = [...new Set(englishLemmaCandidates(key).map((candidate) => bySpelling.get(candidate)).filter((value): value is number => value !== undefined))];
        lemmaCache.set(key, found);
      }
      return found;
    };

    // Walk articles oldest first so each word is credited to the article where it first appeared.
    const ordered = articles.filter((article) => article.id > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    const met = new Set<number>();
    const newByArticle = new Map<number, number[]>();
    for (const article of ordered) {
      const fresh: number[] = [];
      for (const match of splitArticle(article.content).body.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)) {
        for (const index of entriesFor(match[0])) {
          if (!met.has(index)) { met.add(index); fresh.push(index); }
        }
      }
      newByArticle.set(article.id, fresh);
    }

    const saved = new Set<number>();
    for (const word of savedWords) if (!word.includes(" ")) entriesFor(word).forEach((index) => saved.add(index));

    const coreTotal = entries.filter((entry) => entry[1] === 1).length;
    const count = (set: Set<number>, core: 0 | 1) => [...set].filter((index) => entries[index][1] === core).length;
    const latest = ordered[ordered.length - 1];
    const unseen = entries.map((entry, index) => ({ entry, index })).filter(({ index }) => !met.has(index)).slice(0, 14);

    return {
      total: entries.length, coreTotal, basicTotal: entries.length - coreTotal,
      met: met.size, metCore: count(met, 1), metBasic: count(met, 0),
      saved: saved.size, savedCore: count(saved, 1), savedBasic: count(saved, 0),
      savedSet: saved,
      latest: latest ? { article: latest, fresh: (newByArticle.get(latest.id) ?? []).sort((a, b) => entries[b][2] - entries[a][2]) } : null,
      unseen,
    };
  }, [entries, articles, savedWords]);

  if (!coverage || !entries) return null;
  const latestName = coverage.latest ? (coverage.latest.article.shortTitle?.trim() || coverage.latest.article.title) : "";

  return (
    <section className="stats-section coverage">
      <div className="stats-section-head"><h2>考研词覆盖</h2><span>共 {coverage.total.toLocaleString()} 词</span></div>
      <div className="coverage-main">
        <Meter label="遇到过" value={coverage.met} total={coverage.total} large />
        <Meter label="已收藏" value={coverage.saved} total={coverage.total} large />
      </div>
      <div className="coverage-blocks">
        <Meter label="必考词 · 遇到" value={coverage.metCore} total={coverage.coreTotal} />
        <Meter label="基础词 · 遇到" value={coverage.metBasic} total={coverage.basicTotal} />
      </div>

      {coverage.latest && (
        <div className="coverage-list">
          <h3>《{latestName}》新遇到 {coverage.latest.fresh.length} 个</h3>
          {coverage.latest.fresh.length ? <div className="coverage-chips">{coverage.latest.fresh.slice(0, 30).map((index) => (
            <span key={index} className={coverage.savedSet.has(index) ? "saved" : undefined} title={`真题出现 ${entries[index][2]} 次`}>{entries[index][0][0]}</span>
          ))}{coverage.latest.fresh.length > 30 && <span className="more">+{coverage.latest.fresh.length - 30}</span>}</div> : <p className="stats-empty">这篇里的考研词之前都遇到过了。</p>}
        </div>
      )}

      <div className="coverage-list">
        <h3>常考但还没遇到</h3>
        <div className="coverage-chips">{coverage.unseen.map(({ entry, index }) => (
          <span key={index} title={`真题出现 ${entry[2]} 次`}>{entry[0][0]}<small>{entry[2]}</small></span>
        ))}</div>
      </div>
    </section>
  );
}
