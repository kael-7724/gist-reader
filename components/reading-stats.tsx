"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

const TICK_SECONDS = 5;
const IDLE_LIMIT_MS = 3 * 60 * 1000;
const FLUSH_AT_SECONDS = 30;

// Counts reading time while the reader is open, the page is visible, and the reader has scrolled, moved the mouse,
// typed or selected text within the last three minutes. Time is sent to the server in small increments.
export function useReadingTimer(articleId: number, reading: boolean) {
  const lastActivity = useRef(0);
  const pending = useRef(0);
  const articleRef = useRef(articleId);

  const flush = useCallback((id: number) => {
    const seconds = Math.floor(pending.current);
    pending.current = 0;
    if (seconds < 1 || id < 1) return;
    fetch("/api/stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ articleId: id, seconds }), keepalive: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    lastActivity.current = Date.now();
    const mark = () => { lastActivity.current = Date.now(); };
    const events = ["scroll", "wheel", "mousemove", "keydown", "pointerdown", "touchstart", "selectionchange"];
    events.forEach((name) => document.addEventListener(name, mark, { passive: true, capture: true }));
    return () => events.forEach((name) => document.removeEventListener(name, mark, { capture: true }));
  }, []);

  useEffect(() => {
    if (articleRef.current !== articleId) {
      flush(articleRef.current);
      articleRef.current = articleId;
      lastActivity.current = Date.now();
    }
  }, [articleId, flush]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (reading && document.visibilityState === "visible" && Date.now() - lastActivity.current < IDLE_LIMIT_MS) pending.current += TICK_SECONDS;
      if (pending.current >= FLUSH_AT_SECONDS) flush(articleRef.current);
    }, TICK_SECONDS * 1000);
    const onHide = () => { if (document.visibilityState === "hidden") flush(articleRef.current); };
    const onLeave = () => flush(articleRef.current);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      flush(articleRef.current);
    };
  }, [reading, flush]);
}

type StatsDay = { day: string; seconds: number; articlesRead: number; words: number; sentences: number; imported: number };
type Stats = { today: string; days: StatsDay[]; streak: number; todaySeconds: number; weekSeconds: number; totalSeconds: number; totalDays: number; topArticles: Array<{ id: number; title: string; shortTitle?: string; seconds: number }> };

function minutes(seconds: number) {
  return Math.floor(seconds / 60);
}

function formatDuration(seconds: number) {
  const total = minutes(seconds);
  if (seconds > 0 && total === 0) return { value: "<1", unit: "分钟" };
  if (total < 60) return { value: String(total), unit: "分钟" };
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return { value: rest ? `${hours}:${String(rest).padStart(2, "0")}` : String(hours), unit: rest ? "小时:分" : "小时" };
}

function durationText(seconds: number) {
  const total = minutes(seconds);
  if (seconds > 0 && total === 0) return "不到 1 分钟";
  if (total < 60) return `${total} 分钟`;
  return `${Math.floor(total / 60)} 小时${total % 60 ? ` ${total % 60} 分钟` : ""}`;
}

function dayLabel(day: string, today: string) {
  if (day === today) return "今天";
  const [, month, date] = day.split("-").map(Number);
  return `${month}月${date}日`;
}

function weekday(day: string) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${day}T00:00:00Z`).getUTCDay()];
}

function niceMax(maxMinutes: number) {
  for (const step of [10, 15, 20, 30, 45, 60, 90, 120, 180, 240]) if (maxMinutes <= step) return step;
  return Math.ceil(maxMinutes / 60) * 60;
}

export function ReadingStats({ active, onOpenArticle, children }: { active: boolean; onOpenArticle: (id: number) => void; children?: React.ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/stats").then((response) => response.ok ? response.json() as Promise<Stats> : Promise.reject(new Error()))
      .then((data) => { if (!cancelled) { setStats(data); setError(""); } })
      .catch(() => { if (!cancelled) setError("统计数据暂时无法读取，请稍后再试"); });
    return () => { cancelled = true; };
  }, [active]);

  if (error && !stats) return <div className="stats-page"><p className="stats-empty">{error}</p></div>;
  if (!stats) return <div className="stats-page"><p className="stats-empty"><Loader2 className="size-4 animate-spin" /></p></div>;

  const scaleMax = niceMax(Math.max(...stats.days.map((day) => minutes(day.seconds)), 5));
  const recent = [...stats.days].reverse().slice(0, 14);
  const today = formatDuration(stats.todaySeconds);
  const week = formatDuration(stats.weekSeconds);
  const total = formatDuration(stats.totalSeconds);
  const hoveredDay = hovered === null ? null : stats.days[hovered];

  return (
    <div className="stats-page">
      <header className="library-header"><div><h1>统计</h1></div></header>

      <section className="stats-tiles" aria-label="概览">
        <div className="stats-tile"><span>今天</span><strong>{today.value}<small>{today.unit}</small></strong></div>
        <div className="stats-tile"><span>最近 7 天</span><strong>{week.value}<small>{week.unit}</small></strong></div>
        <div className="stats-tile"><span>连续阅读</span><strong>{stats.streak}<small>天</small></strong></div>
        <div className="stats-tile"><span>累计 · {stats.totalDays} 天</span><strong>{total.value}<small>{total.unit}</small></strong></div>
      </section>

      <section className="stats-section">
        <div className="stats-section-head"><h2>近 30 天</h2><span>分钟</span></div>
        <div className="stats-chart" onMouseLeave={() => setHovered(null)}>
          <div className="stats-gridline" style={{ bottom: "100%" }}><span>{scaleMax}</span></div>
          <div className="stats-gridline" style={{ bottom: "50%" }}><span>{scaleMax / 2}</span></div>
          <div className="stats-gridline baseline" style={{ bottom: 0 }}><span>0</span></div>
          <div className="stats-bars">
            {stats.days.map((day, index) => {
              const value = minutes(day.seconds);
              const height = value ? Math.max(1.5, (value / scaleMax) * 100) : 0;
              return (
                <button type="button" key={day.day} className={`stats-bar ${day.day === stats.today ? "today" : ""} ${hovered === index ? "hovered" : ""}`}
                  onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}
                  aria-label={`${dayLabel(day.day, stats.today)}，阅读 ${durationText(day.seconds)}，收藏 ${day.words} 个单词、${day.sentences} 个句子`}>
                  <span className="stats-bar-fill" style={{ height: `${height}%`, animationDelay: `${index * 14}ms` }} />
                </button>
              );
            })}
          </div>
          {hoveredDay && hovered !== null && (
            <div className="stats-tooltip" style={{ left: `${((hovered + 0.5) / stats.days.length) * 100}%` }} role="status">
              <strong>{dayLabel(hoveredDay.day, stats.today)} · {weekday(hoveredDay.day)}</strong>
              <span>阅读 {hoveredDay.seconds ? durationText(hoveredDay.seconds) : "无记录"}</span>
              {(hoveredDay.words > 0 || hoveredDay.sentences > 0) && <span>收藏 {hoveredDay.words} 词 · {hoveredDay.sentences} 句</span>}
            </div>
          )}
        </div>
        <div className="stats-axis">{stats.days.map((day, index) => <span key={day.day}>{day.day === stats.today ? "今天" : index % 5 === 0 ? dayLabel(day.day, stats.today) : ""}</span>)}</div>
      </section>

      {children}

      <div className="stats-columns">
        <section className="stats-section">
          <div className="stats-section-head"><h2>每日记录</h2><span>最近 14 天</span></div>
          <div className="stats-table-wrap"><table className="stats-table">
            <thead><tr><th>日期</th><th>阅读</th><th>读过</th><th>单词</th><th>句子</th><th>导入</th></tr></thead>
            <tbody>{recent.map((day) => (
              <tr key={day.day} className={day.day === stats.today ? "today" : ""}>
                <td>{dayLabel(day.day, stats.today)}<small>{weekday(day.day)}</small></td>
                <td>{day.seconds ? durationText(day.seconds) : "—"}</td>
                <td>{day.articlesRead ? `${day.articlesRead} 篇` : "—"}</td>
                <td>{day.words || "—"}</td>
                <td>{day.sentences || "—"}</td>
                <td>{day.imported ? `${day.imported} 篇` : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="stats-section">
          <div className="stats-section-head"><h2>读得最久的文章</h2><span>最近 30 天</span></div>
          {stats.topArticles.length ? <ol className="stats-top">{stats.topArticles.map((article) => (
            <li key={article.id}><button type="button" onClick={() => onOpenArticle(article.id)}><span title={article.title}>{article.shortTitle || article.title}</span><small>{durationText(article.seconds)}</small></button></li>
          ))}</ol> : <p className="stats-empty">还没有记录</p>}
        </section>
      </div>
    </div>
  );
}
