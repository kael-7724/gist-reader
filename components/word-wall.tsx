"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw, Undo2, X } from "lucide-react";

export type WallWord = { id: number; text: string; translation: string };

type Phase = "flip" | "fall" | "play" | "rebuild" | "unflip";
type Box = { left: number; top: number; width: number; height: number };
type Spot = { x: number; y: number; r: number; s: number };
type Lifted = { id: number; zh: boolean } | null;

// Every card is drawn at this size and scaled with transforms, so a picked-up card is crisp.
const W0 = 280;
const H0 = 180;
const FLIP = "perspective(1000px) rotateY(";

const tf = (x: number, y: number, r: number, sx: number, sy = sx) => `translate3d(${x - W0 / 2}px, ${y - H0 / 2}px, 0) rotate(${r}deg) scale(${sx}, ${sy})`;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function animate(el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
  el.getAnimations().forEach((running) => { try { running.commitStyles(); } catch { /* detached */ } running.cancel(); });
  const animation = el.animate(frames, { fill: "forwards", ...options });
  return animation.finished.then(() => { try { animation.commitStyles(); } catch { /* detached */ } animation.cancel(); }).catch(() => undefined);
}

function gridCard(id: number) {
  return document.querySelector<HTMLElement>(`.word-grid [data-word-card-id="${id}"]`);
}

function measureStage(): Box {
  const content = document.querySelector(".content")?.getBoundingClientRect();
  return content ? { left: content.left, top: content.top, width: content.width, height: content.height } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function visibleRect(id: number, stage: Box) {
  const rect = gridCard(id)?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.bottom < stage.top || rect.top > stage.top + stage.height) return null;
  return rect;
}

// Spread the cards over the table: a jittered grid, so most of each card stays visible.
function scatter(count: number, stage: Box): Spot[] {
  const s = stage.width < 640 ? 0.33 : 0.42;
  const w = W0 * s;
  const h = H0 * s;
  const pad = 14;
  const top = 64;
  const areaW = Math.max(w, stage.width - pad * 2 - w);
  const areaH = Math.max(h, stage.height - top - pad - h);
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * areaW / areaH)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => {
    const cell = cells[i];
    const cw = areaW / cols;
    const ch = areaH / rows;
    return {
      x: pad + w / 2 + (cell % cols + 0.5) * cw + rand(-0.42, 0.42) * cw,
      y: top + h / 2 + (Math.floor(cell / cols) + 0.5) * ch + rand(-0.42, 0.42) * ch,
      r: rand(-26, 26),
      s,
    };
  });
}

export function WordWall({ words, onClose }: { words: WallWord[]; onClose: () => void }) {
  const [stage] = useState(measureStage);
  const [rects, setRects] = useState(() => { const box = measureStage(); return new Map(words.map((word) => [word.id, visibleRect(word.id, box)] as const)); });
  const [phase, setPhase] = useState<Phase>("flip");
  const [gone, setGone] = useState<Set<number>>(() => new Set());
  const [passed, setPassed] = useState(0);
  const [lifted, setLifted] = useState<Lifted>(null);
  const [hint, setHint] = useState(true);
  const [mounted, setMounted] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const counterRef = useRef<HTMLSpanElement | null>(null);
  const tokens = useRef(new Map<number, HTMLButtonElement>());
  const flips = useRef(new Map<number, HTMLSpanElement>());
  const angles = useRef(new Map<number, number>());
  const clones = useRef(new Map<number, HTMLDivElement>());
  const spots = useRef(new Map<number, Spot>());
  const zTop = useRef(words.length + 1);
  const busy = useRef(true);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const reduce = useRef(false);
  const ms = (value: number) => (reduce.current ? 1 : value);

  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);

  // 1. The visible cards turn face down, wave by wave.
  useLayoutEffect(() => {
    if (phase !== "flip" && phase !== "unflip") return;
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const entering = phase === "flip";
    if (entering) document.body.classList.add("ww-active");
    const jobs: Promise<unknown>[] = [];
    clones.current.forEach((inner, id) => {
      const rect = rects.get(id);
      if (!rect) return;
      const wave = ((rect.left - stage.left) / stage.width + (rect.top - stage.top) / stage.height) / 2;
      const from = entering ? 0 : 180;
      inner.style.transform = `rotateY(${from}deg)`;
      jobs.push(animate(inner, [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${180 - from}deg)` }], { duration: ms(560), delay: ms(wave * 460), easing: "cubic-bezier(.45,0,.2,1)" }));
    });
    let cancelled = false;
    void Promise.all(jobs).then(() => wait(ms(entering ? 140 : 60))).then(() => {
      if (cancelled) return;
      if (entering) setPhase("fall");
      else onClose();
    });
    return () => { cancelled = true; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => document.body.classList.remove("ww-active"), []);

  // 2. The wall gives way: bottom rows first, every card tumbles to a spot on the table.
  useLayoutEffect(() => {
    if (phase !== "fall") return;
    const placed = scatter(words.length, stage);
    let longest = 0;
    void stageRef.current?.animate([
      { transform: "translate(0,0)" }, { transform: "translate(-2px,1px)" }, { transform: "translate(2px,-1px)" },
      { transform: "translate(-1px,0)" }, { transform: "translate(0,0)" },
    ], { duration: ms(260) });
    words.forEach((word, i) => {
      const el = tokens.current.get(word.id);
      const flip = flips.current.get(word.id);
      if (!el || !flip) return;
      const spot = placed[i];
      spots.current.set(word.id, spot);
      angles.current.set(word.id, 180);
      flip.style.transform = `${FLIP}180deg)`;
      el.style.zIndex = String(1 + Math.floor(Math.random() * words.length));
      const end = tf(spot.x, spot.y, spot.r, spot.s);
      const bounce = Math.sign(spot.r || 1);
      const rect = rects.get(word.id);
      let frames: Keyframe[];
      let delay: number;
      if (rect) {
        const cx = rect.left - stage.left + rect.width / 2;
        const cy = rect.top - stage.top + rect.height / 2;
        const sx = rect.width / W0;
        const sy = rect.height / H0;
        const tilt = rand(-6, 6);
        frames = [
          { transform: tf(cx, cy, 0, sx, sy), easing: "cubic-bezier(.3,0,.6,1)" },
          { offset: 0.16, transform: tf(cx + rand(-5, 5), cy - 5, tilt, sx, sy), easing: "cubic-bezier(.55,0,.95,.45)" },
          { offset: 0.78, transform: tf(spot.x, spot.y + 7, spot.r + bounce * 8, spot.s), easing: "cubic-bezier(.2,.6,.3,1)" },
          { offset: 0.9, transform: tf(spot.x, spot.y - 5, spot.r - bounce * 2, spot.s), easing: "ease-in-out" },
          { transform: end },
        ];
        delay = 160 + (1 - cy / stage.height) * 420 + rand(0, 170);
      } else {
        const fromX = spot.x + rand(-80, 80);
        frames = [
          { transform: tf(fromX, -H0 * spot.s - rand(20, 260), rand(-30, 30), spot.s), easing: "cubic-bezier(.55,0,.95,.45)" },
          { offset: 0.8, transform: tf(spot.x, spot.y + 7, spot.r + bounce * 8, spot.s), easing: "cubic-bezier(.2,.6,.3,1)" },
          { offset: 0.92, transform: tf(spot.x, spot.y - 4, spot.r - bounce * 2, spot.s), easing: "ease-in-out" },
          { transform: end },
        ];
        delay = 420 + rand(0, 720);
      }
      el.style.transform = String(frames[0].transform);
      const duration = rand(900, 1180);
      longest = Math.max(longest, delay + duration);
      void animate(el, frames, { duration: ms(duration), delay: ms(delay) });
    });
    const timer = window.setTimeout(() => { busy.current = false; setPhase("play"); }, ms(longest + 40));
    return () => window.clearTimeout(timer);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const center = useCallback(() => {
    const s = Math.min(1.22, (stage.width - 40) / W0, (stage.height - 230) / H0);
    return tf(stage.width / 2, stage.height / 2 - 14, 0, s);
  }, [stage]);

  const flipTo = useCallback((id: number, delta: number, duration: number, delay = 0) => {
    const flip = flips.current.get(id);
    const from = angles.current.get(id) ?? 180;
    const to = from + delta;
    angles.current.set(id, to);
    if (!flip) return Promise.resolve();
    return animate(flip, [{ transform: `${FLIP}${from}deg)` }, { transform: `${FLIP}${to}deg)` }], { duration: ms(duration), delay: ms(delay), easing: "cubic-bezier(.45,0,.2,1)" });
  }, []);

  const lift = useCallback((id: number) => {
    const el = tokens.current.get(id);
    if (!el) return;
    busy.current = true;
    setHint(false);
    el.style.zIndex = "9001";
    setLifted({ id, zh: false });
    void animate(el, [{ transform: el.style.transform }, { transform: center() }], { duration: ms(560), easing: "cubic-bezier(.22,1,.36,1)" });
    void flipTo(id, 180, 620, 90).then(() => { busy.current = false; });
  }, [center, flipTo]);

  const putBack = useCallback((id: number) => {
    const el = tokens.current.get(id);
    const spot = spots.current.get(id);
    if (!el || !spot) return;
    busy.current = true;
    setLifted(null);
    el.style.zIndex = String(++zTop.current);
    void flipTo(id, 180, 480);
    void animate(el, [{ transform: el.style.transform }, { transform: tf(spot.x, spot.y, spot.r, spot.s) }], { duration: ms(520), easing: "cubic-bezier(.22,1,.36,1)" }).then(() => { busy.current = false; });
  }, [flipTo]);

  const toPile = useCallback((id: number) => {
    const el = tokens.current.get(id);
    const box = counterRef.current?.getBoundingClientRect();
    if (!el) return;
    busy.current = true;
    setLifted(null);
    const x = box ? box.left - stage.left + box.width / 2 : stage.width - 40;
    const y = box ? box.top - stage.top + box.height / 2 : 28;
    void animate(el, [
      { transform: el.style.transform, opacity: 1 },
      { offset: 0.35, transform: center().replace(/scale\(([^,]+), ([^)]+)\)/, (_, a) => `scale(${Number(a) * 1.04}, ${Number(a) * 1.04})`), opacity: 1 },
      { transform: tf(x, y, -14, 0.06), opacity: 0 },
    ], { duration: ms(620), easing: "cubic-bezier(.55,0,.75,.2)" }).then(() => {
      setGone((current) => new Set(current).add(id));
      busy.current = false;
    });
  }, [center, stage]);

  function tap(id: number) {
    if (phase !== "play" || busy.current) return;
    if (!lifted) { lift(id); return; }
    if (lifted.id !== id) return;
    if (!lifted.zh) { setLifted({ id, zh: true }); setPassed((n) => n + 1); return; }
    toPile(id);
  }

  function forget() {
    if (!lifted?.zh || busy.current) return;
    setPassed((n) => Math.max(0, n - 1));
    putBack(lifted.id);
  }

  function tapBackdrop() {
    if (!lifted || busy.current) return;
    if (lifted.zh) toPile(lifted.id);
    else putBack(lifted.id);
  }

  // Drag a face-down card around the table; a short press without moving picks it up.
  function onDown(event: ReactPointerEvent<HTMLButtonElement>, id: number) {
    if (phase !== "play" || lifted || busy.current) return;
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const spot = spots.current.get(state.id);
    if (!spot) return;
    if (!state.moved && Math.hypot(dx, dy) < 7) return;
    if (!state.moved) { state.moved = true; event.currentTarget.style.zIndex = String(++zTop.current); event.currentTarget.classList.add("is-dragging"); }
    event.currentTarget.style.transform = tf(spot.x + dx, spot.y + dy, spot.r * 0.6, spot.s * 1.08);
  }
  function onUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) return;
    suppressClick.current = true;
    event.currentTarget.classList.remove("is-dragging");
    const spot = spots.current.get(state.id);
    if (!spot) return;
    const w = W0 * spot.s / 2;
    spot.x = Math.min(stage.width - w, Math.max(w, spot.x + event.clientX - state.x));
    spot.y = Math.min(stage.height - 20, Math.max(70, spot.y + event.clientY - state.y));
    spot.r = spot.r * 0.6 + rand(-6, 6);
    void animate(event.currentTarget, [{ transform: event.currentTarget.style.transform }, { transform: tf(spot.x, spot.y, spot.r, spot.s) }], { duration: ms(360), easing: "cubic-bezier(.34,1.56,.64,1)" });
  }

  const remaining = words.length - gone.size;
  const allDone = phase === "play" && remaining === 0;

  function reshuffle() {
    const placed = scatter(words.length, stage);
    words.forEach((word, i) => spots.current.set(word.id, placed[i]));
    setGone(new Set());
    setPassed(0);
    busy.current = true;
    setPhase("fall");
  }

  // 3. Leaving: every card flies back into its place in the wall, then turns face up.
  function exit() {
    if (phase !== "play" && phase !== "fall") return;
    busy.current = true;
    setLifted(null);
    setPhase("rebuild");
  }

  useLayoutEffect(() => {
    if (phase !== "rebuild") return;
    const box = counterRef.current?.getBoundingClientRect();
    const pileX = box ? box.left - stage.left + box.width / 2 : stage.width - 40;
    const pileY = box ? box.top - stage.top + box.height / 2 : 28;
    let longest = 0;
    const next = new Map(words.map((word) => [word.id, visibleRect(word.id, stage)] as const));
    words.forEach((word) => {
      const el = tokens.current.get(word.id);
      if (!el) return;
      const rect = next.get(word.id);
      const angle = angles.current.get(word.id) ?? 180;
      if (Math.round(angle / 180) % 2 === 0) void flipTo(word.id, 180, 420);
      if (gone.has(word.id)) { el.style.transform = tf(pileX, pileY, -14, 0.06); el.style.opacity = "0"; }
      const from = el.style.transform;
      const target = rect
        ? tf(rect.left - stage.left + rect.width / 2, rect.top - stage.top + rect.height / 2, 0, rect.width / W0, rect.height / H0)
        : tf(stage.width / 2 + rand(-stage.width / 2, stage.width / 2), stage.height + 160, rand(-20, 20), 0.3);
      const delay = rect ? 60 + (1 - (rect.top - stage.top) / stage.height) * 360 + rand(0, 120) : rand(0, 200);
      const duration = rand(560, 720);
      longest = Math.max(longest, delay + duration);
      void animate(el, [{ transform: from, opacity: Number(el.style.opacity || 1) }, { transform: target, opacity: rect ? 1 : 0 }], { duration: ms(duration), delay: ms(delay), easing: "cubic-bezier(.65,0,.35,1)" });
    });
    const timer = window.setTimeout(() => { setRects(next); setGone(new Set()); setPhase("unflip"); }, ms(longest + 60));
    return () => window.clearTimeout(timer);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lifted) tapBackdrop();
      else exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!mounted) return null;
  const showTokens = phase === "fall" || phase === "play" || phase === "rebuild";
  const showClones = phase === "flip" || phase === "unflip";

  return createPortal(
    <div ref={stageRef} className="ww-stage" style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }} role="dialog" aria-modal="true" aria-label="翻卡练习">
      {showClones && words.map((word) => {
        const rect = rects.get(word.id);
        if (!rect) return null;
        return (
          <div key={word.id} className="ww-clone" style={{ left: rect.left - stage.left, top: rect.top - stage.top, width: rect.width, height: rect.height }} aria-hidden="true">
            <div className="ww-clone-inner" ref={(el) => { if (el) clones.current.set(word.id, el); else clones.current.delete(word.id); }}>
              <div className="ww-clone-front" inert ref={(el) => {
                if (!el || el.firstChild) return;
                const copy = gridCard(word.id)?.cloneNode(true) as HTMLElement | undefined;
                if (!copy) return;
                copy.removeAttribute("data-word-card-id");
                copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
                el.appendChild(copy);
              }} />
              <div className="ww-clone-back ww-back" />
            </div>
          </div>
        );
      })}

      {showTokens && words.map((word, index) => (phase !== "rebuild" && gone.has(word.id)) ? null : (
        <button
          key={word.id}
          type="button"
          className={`ww-token${lifted?.id === word.id ? " is-lifted" : ""}`}
          ref={(el) => { if (el) tokens.current.set(word.id, el); else tokens.current.delete(word.id); }}
          aria-label={lifted?.id === word.id ? (lifted.zh ? `${word.text}：${word.translation}` : word.text) : `第 ${index + 1} 张牌`}
          onPointerDown={(event) => onDown(event, word.id)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } tap(word.id); }}
        >
          <span className="ww-flip" ref={(el) => { if (el) flips.current.set(word.id, el); else flips.current.delete(word.id); }}>
            <span className={`ww-face ww-front${lifted?.id === word.id && lifted.zh ? " show-zh" : ""}`}>
              <span className="ww-en" lang="en">{word.text}</span>
              <span className="ww-zh">{word.translation || "（还没有释义）"}</span>
            </span>
            <span className="ww-face ww-back" />
          </span>
        </button>
      ))}

      <div className={`ww-backdrop${lifted ? " is-shown" : ""}`} onClick={tapBackdrop} aria-hidden="true" />

      <div className={`ww-bar${phase === "play" || phase === "fall" ? " is-shown" : ""}`}>
        <button type="button" className="ww-chip" onClick={exit}><X className="size-4" />收起</button>
        <span className="ww-count" aria-live="polite" aria-label={`已过关 ${passed} / ${words.length}`}><strong key={passed} ref={counterRef}>{passed}</strong> / {words.length}</span>
      </div>

      <p className={`ww-hint${phase === "play" && hint ? " is-shown" : ""}`}>点牌翻开</p>
      <p className={`ww-hint${lifted && !lifted.zh ? " is-shown" : ""}`}>再点看中文</p>
      <div className={`ww-actions${lifted?.zh ? " is-shown" : ""}`}>
        <button type="button" className="ww-chip" onClick={forget}><Undo2 className="size-4" />放回</button>
        <button type="button" className="ww-chip is-primary" onClick={() => lifted && toPile(lifted.id)}><Check className="size-4" />过关</button>
      </div>

      {allDone && (
        <div className="ww-done">
          <h2>全部过关</h2>
          <div>
            <button type="button" className="ww-chip" onClick={reshuffle}><RotateCcw className="size-4" />再来一次</button>
            <button type="button" className="ww-chip is-primary" onClick={exit}>收起</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
