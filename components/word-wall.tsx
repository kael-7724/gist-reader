"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";

export type WallWord = { id: number; text: string; translation: string };

type Phase = "flip" | "fall" | "play" | "deal" | "rebuild";
type Box = { left: number; top: number; width: number; height: number };
type Spot = { x: number; y: number; r: number; s: number };
type Lifted = { id: number; zh: boolean } | null;
type Side = "back" | "front";
// A card's look on screen: centre, rotation, scale, and its visible height and corner radius in px.
type Pose = { x: number; y: number; r: number; s: number; h: number; rad: number; o: number };

const W0 = 280;
const H0 = 180;
const TABLE_RADIUS = 22;
const P = "perspective(720px) rotateY(";
const EASE_IN = "cubic-bezier(.55,0,.9,.55)";
const EASE_OUT = "cubic-bezier(.12,.6,.3,1)";
const GLIDE = "cubic-bezier(.22,1,.36,1)";

const tf = (x: number, y: number, r: number, s: number) => `translate3d(${(x - W0 / 2).toFixed(2)}px, ${(y - H0 / 2).toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function animate(el: Element | undefined | null, frames: Keyframe[], options: KeyframeAnimationOptions, commit = true) {
  if (!el) return Promise.resolve();
  el.getAnimations().forEach((running) => { try { running.commitStyles(); } catch { /* detached */ } running.cancel(); });
  const animation = el.animate(frames, { fill: "forwards", ...options });
  return animation.finished.then(() => {
    if (!commit) return;
    try { animation.commitStyles(); } catch { /* detached */ }
    animation.cancel();
  }).catch(() => undefined);
}

function setInstant(el: HTMLElement, transform: string) {
  el.style.transition = "none";
  el.style.transform = transform;
  void el.offsetWidth;
  el.style.transition = "";
}

// The card is always scaled uniformly; its face height, edge and corners are set in base px so they look the same at any scale.
function applyPose(el: HTMLElement, pose: Pose) {
  el.style.transform = tf(pose.x, pose.y, pose.r, pose.s);
  el.style.setProperty("--fh", `${(pose.h / pose.s).toFixed(2)}px`);
  el.style.setProperty("--edge", `${(1 / pose.s).toFixed(3)}px`);
  el.style.setProperty("--rad", `${(pose.rad / pose.s).toFixed(2)}px`);
  el.style.opacity = String(pose.o);
}

const mix = (a: Pose, b: Pose, t: number): Pose => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), r: lerp(a.r, b.r, t), s: lerp(a.s, b.s, t), h: lerp(a.h, b.h, t), rad: lerp(a.rad, b.rad, t), o: lerp(a.o, b.o, t) });
const tablePose = (x: number, y: number, r: number, s: number, o = 1): Pose => ({ x, y, r, s, h: H0 * s, rad: TABLE_RADIUS * s, o });

const gridCard = (id: number) => document.querySelector<HTMLElement>(`.word-grid [data-word-card-id="${id}"]`);

function measureStage(): Box {
  const content = document.querySelector(".content")?.getBoundingClientRect();
  return content ? { left: content.left, top: content.top, width: content.width, height: content.height } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function wallPose(id: number, stage: Box): Pose | null {
  const card = gridCard(id);
  const rect = card?.getBoundingClientRect();
  if (!card || !rect || rect.width === 0 || rect.bottom < stage.top + 4 || rect.top > stage.top + stage.height - 4) return null;
  const s = rect.width / W0;
  return { x: rect.left - stage.left + rect.width / 2, y: rect.top - stage.top + rect.height / 2, r: 0, s, h: rect.height, rad: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 14, o: 1 };
}

function scatter(count: number, stage: Box): Spot[] {
  const s = stage.width < 640 ? 0.33 : 0.42;
  const w = W0 * s;
  const h = H0 * s;
  const pad = 14;
  const top = 66;
  const areaW = Math.max(w, stage.width - pad * 2 - w);
  const areaH = Math.max(h, stage.height - top - pad - h);
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * areaW / areaH)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => {
    const cell = cells[i];
    const cw = areaW / cols;
    const ch = areaH / rows;
    return { x: pad + w / 2 + (cell % cols + 0.5 + rand(-0.4, 0.4)) * cw, y: top + h / 2 + (Math.floor(cell / cols) + 0.5 + rand(-0.4, 0.4)) * ch, r: rand(-24, 24), s };
  });
}

// Runs many card tweens in one animation frame loop.
function tweenAll(items: { el: HTMLElement; from: Pose; to: Pose; delay: number; duration: number; ease: (t: number) => number; done?: () => void }[]) {
  return new Promise<void>((resolve) => {
    const begin = performance.now();
    const finished = new Set<number>();
    const step = (now: number) => {
      const t = now - begin;
      items.forEach((item, i) => {
        if (finished.has(i) || t < item.delay) return;
        const k = Math.min(1, (t - item.delay) / item.duration);
        applyPose(item.el, mix(item.from, item.to, item.ease(k)));
        if (k >= 1) { finished.add(i); item.done?.(); }
      });
      if (finished.size < items.length) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function WordWall({ words, onClose }: { words: WallWord[]; onClose: () => void }) {
  const [stage] = useState(measureStage);
  const [walls] = useState(() => { const box = measureStage(); return new Map(words.map((word) => [word.id, wallPose(word.id, box)] as const)); });
  const [phase, setPhase] = useState<Phase>("flip");
  const [gone, setGone] = useState<Set<number>>(() => new Set());
  const [passed, setPassed] = useState(0);
  const [lifted, setLifted] = useState<Lifted>(null);
  const [hint, setHint] = useState(true);
  const counterRef = useRef<HTMLSpanElement | null>(null);
  const tokens = useRef(new Map<number, HTMLButtonElement>());
  const backs = useRef(new Map<number, HTMLSpanElement>());
  const fronts = useRef(new Map<number, HTMLSpanElement>());
  const sides = useRef(new Map<number, Side>());
  const spots = useRef(new Map<number, Spot>());
  const zTop = useRef(words.length + 10);
  const busy = useRef(true);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const frozen = useRef(new Set<number>());
  const blow = useRef<{ x: number; y: number; on: boolean; puff: number } | null>(null);
  const motion = useRef(new Map<number, { vx: number; vy: number; w: number }>());
  const windLoop = useRef(0);
  const reduce = useRef(false);
  const ms = (value: number) => (reduce.current ? 1 : value);

  const pilePoint = useCallback(() => {
    const box = counterRef.current?.getBoundingClientRect();
    return box ? { x: box.left - stage.left + box.width / 2, y: box.top - stage.top + box.height / 2 } : { x: stage.width - 40, y: 28 };
  }, [stage]);

  // A card turns over in two halves: the visible face swings away edge-on, then the other face swings in.
  const turn = useCallback((id: number, to: Side, delay = 0) => {
    if ((sides.current.get(id) ?? "back") === to) return Promise.resolve();
    sides.current.set(id, to);
    const out = to === "front" ? backs.current.get(id) : fronts.current.get(id);
    const into = to === "front" ? fronts.current.get(id) : backs.current.get(id);
    return animate(out, [{ transform: `${P}0deg)` }, { transform: `${P}90deg)` }], { duration: ms(190), delay: ms(delay), easing: EASE_IN })
      .then(() => animate(into, [{ transform: `${P}-90deg)` }, { transform: `${P}0deg)` }], { duration: ms(300), easing: EASE_OUT }));
  }, []);

  // 1. Each card in the wall swings edge-on and its blank back swings in, in a diagonal wave.
  useLayoutEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    words.forEach((word) => {
      const el = tokens.current.get(word.id);
      const back = backs.current.get(word.id);
      const wall = walls.get(word.id);
      sides.current.set(word.id, "back");
      if (!el || !back) return;
      if (wall) { applyPose(el, wall); back.style.transform = `${P}-90deg)`; }
      else applyPose(el, tablePose(rand(0, stage.width), -200, 0, 0.4, 0));
    });
    let cancelled = false;
    const jobs = words.map((word) => {
      const wall = walls.get(word.id);
      if (!wall) return Promise.resolve();
      const wave = (wall.x / stage.width) * 0.4 + (wall.y / stage.height) * 0.6;
      return animate(gridCard(word.id), [{ transform: `${P}0deg)` }, { transform: `${P}90deg)` }], { duration: ms(210), delay: ms(wave * 480), easing: EASE_IN }, false)
        .then(() => animate(backs.current.get(word.id), [{ transform: `${P}-90deg)` }, { transform: `${P}0deg)` }], { duration: ms(320), easing: EASE_OUT }));
    });
    void Promise.all(jobs).then(() => {
      if (cancelled) return;
      document.body.classList.add("ww-active");
      words.forEach((word) => gridCard(word.id)?.getAnimations().forEach((animation) => animation.cancel()));
      window.setTimeout(() => { if (!cancelled) setPhase("fall"); }, ms(120));
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    document.body.classList.remove("ww-active");
    document.querySelectorAll<HTMLElement>(".word-grid [data-word-card-id]").forEach((card) => { card.getAnimations().forEach((animation) => animation.cancel()); setInstant(card, ""); });
  }, []);

  // Glide cards from their current pose to their spot on the table.
  const spread = useCallback((from: Map<number, Pose>, order: "random" | "deal") => {
    let index = 0;
    const items = words.flatMap((word) => {
      const el = tokens.current.get(word.id);
      const start = from.get(word.id);
      const spot = spots.current.get(word.id);
      if (!el || !start || !spot) return [];
      return [{ el, from: start, to: tablePose(spot.x, spot.y, spot.r, spot.s), delay: ms(order === "deal" ? index++ * 14 : rand(0, 160)), duration: ms(order === "deal" ? 560 : rand(640, 840)), ease: easeOutCubic }];
    });
    return tweenAll(items);
  }, [words]);

  // 2. One strong gust from a random direction sweeps across the table. Each card is caught as the
  //    front reaches it, slides downwind (some far, some barely), turns a little and comes to rest.
  useEffect(() => {
    if (phase !== "fall") return;
    const s = scatter(1, stage)[0]?.s ?? 0.4;
    const table = tablePose(0, 0, 0, s);
    const angle = rand(0, Math.PI * 2);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const perp = { x: -dir.y, y: dir.x };
    const span = Math.hypot(stage.width, stage.height);
    const half = { w: W0 * s / 2 + 8, h: H0 * s / 2 + 8 };
    const box = { x0: half.w, x1: stage.width - half.w, y0: 64 + half.h, y1: stage.height - half.h };
    const centre = { x: stage.width / 2, y: stage.height / 2 };
    const proj = (x: number, y: number) => (x - centre.x) * dir.x + (y - centre.y) * dir.y;
    const front0 = -span / 2;
    const frontSpeed = 1500;
    // How far a card at (x, y) can travel along (dx, dy) before leaving the table.
    const room = (x: number, y: number, dx: number, dy: number) => {
      let t = Infinity;
      if (dx > 1e-6) t = Math.min(t, (box.x1 - x) / dx); else if (dx < -1e-6) t = Math.min(t, (box.x0 - x) / dx);
      if (dy > 1e-6) t = Math.min(t, (box.y1 - y) / dy); else if (dy < -1e-6) t = Math.min(t, (box.y0 - y) / dy);
      return Math.max(0, t);
    };
    const bodies = words.map((word) => {
      const wall = walls.get(word.id);
      const el = tokens.current.get(word.id);
      if (el) el.style.zIndex = String(1 + Math.floor(Math.random() * words.length));
      let start: Pose;
      let hit: number;
      if (wall) {
        start = wall;
        hit = (proj(wall.x, wall.y) - front0) / frontSpeed * 1000 + rand(0, 90);
      } else {
        // Cards that were off screen are carried in from the upwind side.
        start = tablePose(centre.x - dir.x * span * 0.62 + perp.x * rand(-0.45, 0.45) * span, centre.y - dir.y * span * 0.62 + perp.y * rand(-0.45, 0.45) * span, rand(-20, 20), s);
        hit = rand(0, 380);
      }
      const sx = clamp(start.x, box.x0, box.x1);
      const sy = clamp(start.y, box.y0, box.y1);
      const entry = wall ? 0 : Math.hypot(sx - start.x, sy - start.y);
      const want = entry + span * 0.62 * Math.random() ** 1.5 + 24;
      const sideways = rand(-0.22, 0.22) * want;
      const along = Math.min(want, wall ? room(start.x, start.y, dir.x, dir.y) : entry + room(sx, sy, dir.x, dir.y) * Math.random());
      const ex = start.x + dir.x * along;
      const ey = start.y + dir.y * along;
      const side = clamp(sideways, -room(ex, ey, -perp.x, -perp.y), room(ex, ey, perp.x, perp.y));
      const end = { x: clamp(ex + perp.x * side, box.x0, box.x1), y: clamp(ey + perp.y * side, box.y0, box.y1) };
      const turnBy = (Math.random() < 0.5 ? -1 : 1) * clamp(Math.hypot(end.x - start.x, end.y - start.y) / span * rand(40, 110), 4, 48);
      return {
        id: word.id, el, start, end, hit,
        r0: start.r, r1: clamp(start.r + turnBy, -50, 50),
        lambda: rand(4.2, 5.6),
        wobble: { amp: rand(4, 12), freq: rand(2.2, 3.4), phase: rand(0, Math.PI * 2) },
      };
    });
    const finalSpot = (body: (typeof bodies)[number]) => ({ x: body.end.x, y: body.end.y, r: body.r1, s });
    if (reduce.current) {
      bodies.forEach((body) => { const spot = finalSpot(body); spots.current.set(body.id, spot); if (body.el) applyPose(body.el, tablePose(spot.x, spot.y, spot.r, s)); });
      queueMicrotask(() => { busy.current = false; setPhase("play"); });
      return;
    }
    const smooth = (t: number) => { const k = clamp(t, 0, 1); return k * k * (3 - 2 * k); };
    let frame = 0;
    const begin = performance.now();
    const step = (now: number) => {
      const t = now - begin;
      let done = true;
      for (const body of bodies) {
        if (!body.el) continue;
        const u = Math.max(0, (t - body.hit) / 1000);
        // Starts from rest, speeds up as the gust gets under the card, then friction slows it to a stop.
        const travel = u <= 0 ? 0 : 1 - (1 + body.lambda * u) * Math.exp(-body.lambda * u);
        const flutter = u <= 0 ? 0 : body.wobble.amp * Math.sin(u * body.wobble.freq * Math.PI * 2 + body.wobble.phase) * Math.exp(-3.2 * u) * (1 - Math.exp(-10 * u));
        const shape = mix(body.start, table, smooth(u / 0.35));
        const lift = 1 + 0.07 * Math.sin(Math.PI * clamp(u / 0.7, 0, 1));
        applyPose(body.el, {
          ...shape,
          s: shape.s * lift, h: shape.h * lift, rad: shape.rad * lift,
          x: lerp(body.start.x, body.end.x, travel) + perp.x * flutter,
          y: lerp(body.start.y, body.end.y, travel) + perp.y * flutter,
          r: lerp(body.r0, body.r1, travel) + flutter * 0.25,
        });
        if (u < 1.5) done = false;
      }
      if (!done) { frame = requestAnimationFrame(step); return; }
      bodies.forEach((body) => {
        const spot = finalSpot(body);
        spots.current.set(body.id, spot);
        if (body.el) applyPose(body.el, tablePose(spot.x, spot.y, spot.r, s));
      });
      busy.current = false;
      setPhase("play");
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const center = useCallback((boost = 1) => {
    const s = Math.min(1.22, (stage.width - 40) / W0, (stage.height - 230) / H0) * boost;
    return tf(stage.width / 2, stage.height / 2 - 14, 0, s);
  }, [stage]);

  const lift = useCallback((id: number) => {
    const el = tokens.current.get(id);
    if (!el) return;
    busy.current = true;
    setHint(false);
    el.style.zIndex = "9001";
    frozen.current.add(id);
    setLifted({ id, zh: false });
    void animate(el, [{ transform: el.style.transform }, { transform: center() }], { duration: ms(560), easing: GLIDE });
    void turn(id, "front", 70).then(() => { busy.current = false; });
  }, [center, turn]);

  const putBack = useCallback((id: number) => {
    const el = tokens.current.get(id);
    const spot = spots.current.get(id);
    if (!el || !spot) return;
    busy.current = true;
    setLifted(null);
    el.style.zIndex = String(++zTop.current);
    void turn(id, "back");
    void animate(el, [{ transform: el.style.transform }, { transform: tf(spot.x, spot.y, spot.r, spot.s) }], { duration: ms(540), easing: GLIDE }).then(() => { busy.current = false; frozen.current.delete(id); });
  }, [turn]);

  const toPile = useCallback((id: number) => {
    const el = tokens.current.get(id);
    if (!el) return;
    busy.current = true;
    frozen.current.add(id);
    setLifted(null);
    const pile = pilePoint();
    void animate(el, [
      { transform: el.style.transform, opacity: 1 },
      { offset: 0.3, transform: center(1.05), opacity: 1, easing: "cubic-bezier(.6,0,.8,.3)" },
      { transform: tf(pile.x, pile.y, -12, 0.06), opacity: 0 },
    ], { duration: ms(600) }).then(() => {
      setGone((current) => new Set(current).add(id));
      busy.current = false;
    });
  }, [center, pilePoint]);

  function tap(id: number) {
    if (phase !== "play" || busy.current) return;
    if (!lifted) { lift(id); return; }
    if (lifted.id !== id) return;
    if (!lifted.zh) { setLifted({ id, zh: true }); return; }
    setPassed((n) => n + 1);
    toPile(id);
  }

  function tapBackdrop() {
    if (!lifted || busy.current) return;
    putBack(lifted.id);
  }

  function onDown(event: ReactPointerEvent<HTMLButtonElement>, id: number) {
    if (phase !== "play" || lifted || busy.current) return;
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    const spot = state ? spots.current.get(state.id) : undefined;
    if (!state || !spot) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 7) return;
    if (!state.moved) {
      state.moved = true;
      event.currentTarget.style.zIndex = String(++zTop.current);
      event.currentTarget.getAnimations().forEach((animation) => animation.cancel());
    }
    event.currentTarget.style.transform = tf(spot.x + dx, spot.y + dy, spot.r * 0.5, spot.s * 1.08);
  }
  function onUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) return;
    suppressClick.current = true;
    const spot = spots.current.get(state.id);
    if (!spot) return;
    const half = W0 * spot.s / 2;
    spot.x = clamp(spot.x + event.clientX - state.x, half, stage.width - half);
    spot.y = clamp(spot.y + event.clientY - state.y, 70, stage.height - 20);
    spot.r = spot.r * 0.5 + rand(-6, 6);
    void animate(event.currentTarget, [{ transform: event.currentTarget.style.transform }, { transform: tf(spot.x, spot.y, spot.r, spot.s) }], { duration: ms(380), easing: "cubic-bezier(.34,1.4,.64,1)" });
  }

  // Holding down on an empty part of the table blows a gust outward from that point.
  function runWind() {
    if (windLoop.current) return;
    let last = performance.now();
    const radius = stage.width < 640 ? 170 : 250;
    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const source = blow.current;
      let moving = false;
      words.forEach((word) => {
        const id = word.id;
        if (frozen.current.has(id) || drag.current?.id === id) return;
        const el = tokens.current.get(id);
        const spot = spots.current.get(id);
        if (!el || !spot || !el.isConnected) return;
        const m = motion.current.get(id) ?? { vx: 0, vy: 0, w: 0 };
        if (source && (source.on || source.puff > 0)) {
          const dx = spot.x - source.x;
          const dy = spot.y - source.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          if (d < radius) {
            const falloff = (1 - d / radius) ** 2;
            const force = (source.on ? 5200 : 0) * falloff + source.puff * falloff;
            const nx = dx / d;
            const ny = dy / d;
            const swirl = ((id % 7) / 7 - 0.5) * 0.9;
            m.vx += (nx - ny * swirl) * force * dt;
            m.vy += (ny + nx * swirl) * force * dt;
            if (!motion.current.has(id)) el.getAnimations().forEach((animation) => animation.cancel());
          }
        }
        const decay = Math.exp(-3.4 * dt);
        m.vx *= decay;
        m.vy *= decay;
        m.w += ((m.vx * 0.55 - m.vy * 0.35) * 0.3 - m.w * 3) * dt;
        const speed = Math.hypot(m.vx, m.vy);
        if (speed < 3 && Math.abs(m.w) < 3 && !motion.current.has(id)) return;
        spot.x += m.vx * dt;
        spot.y += m.vy * dt;
        spot.r = ((spot.r + m.w * dt + 540) % 360) - 180;
        const half = W0 * spot.s / 2;
        if (spot.x < half) { spot.x = half; m.vx = Math.abs(m.vx) * 0.45; }
        if (spot.x > stage.width - half) { spot.x = stage.width - half; m.vx = -Math.abs(m.vx) * 0.45; }
        if (spot.y < 70) { spot.y = 70; m.vy = Math.abs(m.vy) * 0.45; }
        if (spot.y > stage.height - 24) { spot.y = stage.height - 24; m.vy = -Math.abs(m.vy) * 0.45; }
        el.style.transform = tf(spot.x, spot.y, spot.r, spot.s * (1 + Math.min(0.1, speed / 8000)));
        if (speed > 3 || Math.abs(m.w) > 3) { moving = true; motion.current.set(id, m); }
        else { motion.current.delete(id); el.style.transform = tf(spot.x, spot.y, spot.r, spot.s); }
      });
      if (source) source.puff = Math.max(0, source.puff - 90000 * dt);
      if (moving || source?.on || (source?.puff ?? 0) > 0) windLoop.current = requestAnimationFrame(step);
      else { windLoop.current = 0; motion.current.clear(); }
    };
    windLoop.current = requestAnimationFrame(step);
  }

  function onStageDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || phase !== "play" || lifted) return;
    const x = event.clientX - stage.left;
    const y = event.clientY - stage.top;
    blow.current = { x, y, on: true, puff: 14000 };
    event.currentTarget.setPointerCapture(event.pointerId);
    setHint(false);
    runWind();
  }
  function onStageMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!blow.current?.on) return;
    blow.current.x = event.clientX - stage.left;
    blow.current.y = event.clientY - stage.top;
  }
  function onStageUp() {
    if (!blow.current) return;
    blow.current.on = false;
  }

  useEffect(() => () => cancelAnimationFrame(windLoop.current), []);

  // Deal a fresh round out of the pile.
  useLayoutEffect(() => {
    if (phase !== "deal") return;
    const pile = pilePoint();
    const placed = scatter(words.length, stage);
    const from = new Map<number, Pose>();
    words.forEach((word, i) => {
      spots.current.set(word.id, placed[i]);
      sides.current.set(word.id, "back");
      const el = tokens.current.get(word.id);
      const front = fronts.current.get(word.id);
      const back = backs.current.get(word.id);
      if (front) front.style.transform = `${P}-90deg)`;
      if (back) back.style.transform = `${P}0deg)`;
      const start = tablePose(pile.x, pile.y, -12, 0.06, 0);
      if (el) { el.style.zIndex = String(i + 1); applyPose(el, start); }
      from.set(word.id, start);
    });
    let cancelled = false;
    void spread(from, "deal").then(() => { if (!cancelled) { busy.current = false; setPhase("play"); } });
    return () => { cancelled = true; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function reshuffle() {
    busy.current = true;
    setGone(new Set());
    setPassed(0);
    setPhase("deal");
  }

  function exit() {
    if (phase === "rebuild") return;
    busy.current = true;
    setLifted(null);
    setPhase("rebuild");
  }

  // 3. Leaving: the cards fly back into the wall, bottom row first, and each turns face up again.
  useLayoutEffect(() => {
    if (phase !== "rebuild") return;
    const pile = pilePoint();
    const targets = new Map(words.map((word) => [word.id, wallPose(word.id, stage)] as const));
    targets.forEach((wall, id) => { const card = wall ? gridCard(id) : null; if (card) setInstant(card, `${P}-90deg)`); });
    document.body.classList.remove("ww-active");
    const items = words.flatMap((word) => {
      const el = tokens.current.get(word.id);
      const spot = spots.current.get(word.id);
      if (!el) return [];
      el.getAnimations().forEach((animation) => animation.cancel());
      let from: Pose;
      if (gone.has(word.id) || !spot) from = tablePose(pile.x, pile.y, -12, 0.06, 0);
      else {
        const lifted = (sides.current.get(word.id) ?? "back") === "front";
        from = lifted ? tablePose(stage.width / 2, stage.height / 2 - 14, 0, Math.min(1.22, (stage.width - 40) / W0, (stage.height - 230) / H0)) : tablePose(spot.x, spot.y, spot.r, spot.s);
      }
      if ((sides.current.get(word.id) ?? "back") === "front") {
        sides.current.set(word.id, "back");
        const front = fronts.current.get(word.id);
        const back = backs.current.get(word.id);
        void animate(front, [{ transform: `${P}0deg)` }, { transform: `${P}90deg)` }], { duration: ms(160), easing: EASE_IN })
          .then(() => animate(back, [{ transform: `${P}-90deg)` }, { transform: `${P}0deg)` }], { duration: ms(220), easing: EASE_OUT }));
      }
      applyPose(el, from);
      const wall = targets.get(word.id);
      const to = wall ?? tablePose(rand(0, stage.width), stage.height + 200, rand(-20, 20), 0.3, 0);
      const done = () => {
        if (!wall) return;
        void animate(backs.current.get(word.id), [{ transform: `${P}0deg)` }, { transform: `${P}90deg)` }], { duration: ms(200), easing: EASE_IN })
          .then(() => {
            const card = gridCard(word.id);
            return animate(card, [{ transform: `${P}-90deg)` }, { transform: `${P}0deg)` }], { duration: ms(320), easing: EASE_OUT }, false)
              .then(() => { if (card) { card.getAnimations().forEach((animation) => animation.cancel()); setInstant(card, ""); } });
          });
      };
      return [{ el, from, to, delay: ms(wall ? (1 - wall.y / stage.height) * 320 + rand(0, 90) : rand(0, 160)), duration: ms(rand(560, 680)), ease: easeInOutCubic, done }];
    });
    let cancelled = false;
    void tweenAll(items).then(() => new Promise((resolve) => window.setTimeout(resolve, ms(560)))).then(() => { if (!cancelled) onClose(); });
    return () => { cancelled = true; };
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

  const allDone = phase === "play" && gone.size === words.length;

  return createPortal(
    <div className="ww-stage" style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }} role="dialog" aria-modal="true" aria-label="翻卡" onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}>
      {words.map((word, index) => (phase !== "rebuild" && phase !== "deal" && gone.has(word.id)) ? null : (
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
          <span className="ww-face ww-back" ref={(el) => { if (el) backs.current.set(word.id, el); else backs.current.delete(word.id); }} />
          <span className={`ww-face ww-front${lifted?.id === word.id && lifted.zh ? " show-zh" : ""}`} ref={(el) => { if (el) fronts.current.set(word.id, el); else fronts.current.delete(word.id); }}>
            <span className="ww-en" lang="en">{word.text}</span>
            <span className="ww-zh">{word.translation}</span>
          </span>
        </button>
      ))}

      <div className={`ww-backdrop${lifted ? " is-shown" : ""}`} onClick={tapBackdrop} aria-hidden="true" />

      <div className={`ww-bar${phase === "play" || phase === "fall" || phase === "deal" ? " is-shown" : ""}`}>
        <button type="button" className="ww-chip" onClick={exit}><X className="size-4" />收起</button>
        <span className="ww-count" aria-live="polite" aria-label={`已过关 ${passed} / ${words.length}`}><strong key={passed} ref={counterRef}>{passed}</strong> / {words.length}</span>
      </div>

      <p className={`ww-hint${phase === "play" && hint ? " is-shown" : ""}`}>点牌翻开</p>
      <p className={`ww-hint${lifted && !lifted.zh ? " is-shown" : ""}`}>再点看中文</p>

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
