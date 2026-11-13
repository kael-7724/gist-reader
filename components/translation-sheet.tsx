"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";

type Kind = "word" | "phrase" | "sentence";
export type SheetSelection = { text: string; type: Kind; translation: string; loading: boolean; error?: boolean; saved?: boolean; phrase?: { text: string; translation: string } };

type Props = {
  selection: SheetSelection | null;
  saving: boolean;
  alreadySaved: boolean;
  onSave: () => void;
  onClose: () => void;
  onSwitchType: (type: Kind) => void;
  onOpenPhrase?: (phrase: { text: string; translation: string }) => void;
  sheetRef: Ref<HTMLElement>;
};

const kindLabel: Record<Kind, string> = { word: "单词", phrase: "词组 · 词组本", sentence: "句子 · 句子本" };

// A compact sheet pinned to the bottom of the screen: it never covers the line being read,
// grows and shrinks smoothly with its content, and can be swiped down on touch screens.
export function TranslationSheet({ selection, saving, alreadySaved, onSave, onClose, onSwitchType, onOpenPhrase, sheetRef }: Props) {
  const [view, setView] = useState<SheetSelection | null>(selection);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ y: number; t: number } | null>(null);

  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);

  useEffect(() => {
    if (selection) {
      queueMicrotask(() => setView(selection));
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
      return () => cancelAnimationFrame(frame);
    }
    queueMicrotask(() => { setOpen(false); setDrag(0); setDragging(false); });
  }, [selection]);

  // Animate the sheet's height whenever its content changes (loading → translation, word → sentence).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      setHeight(body.offsetHeight);
      const scroller = scrollRef.current;
      setScrollable(Boolean(scroller && scroller.scrollHeight > scroller.clientHeight + 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [view !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection, onClose]);

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse") return;
    const target = event.target as Element;
    if (target.closest("button")) return;
    if (scrollable && scrollRef.current?.contains(target) && scrollRef.current.scrollTop > 0) return;
    dragStart.current = { y: event.clientY, t: performance.now() };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragStart.current) return;
    const dy = event.clientY - dragStart.current.y;
    setDrag(dy > 0 ? dy : dy * 0.15);
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragStart.current) return;
    const dy = event.clientY - dragStart.current.y;
    const velocity = dy / Math.max(1, performance.now() - dragStart.current.t);
    dragStart.current = null;
    setDragging(false);
    if (dy > 64 || (dy > 16 && velocity > 0.5)) onClose();
    else setDrag(0);
  }

  if (!mounted || !view) return null;
  const saved = Boolean(view.saved || alreadySaved);
  const transform = open ? `translate3d(-50%, ${drag}px, 0)` : "translate3d(-50%, calc(100% + 48px), 0)";
  const canSwitchToPhrase = view.type === "sentence" && view.text.split(" ").length <= 8;

  return createPortal(
    <section
      ref={sheetRef}
      className={`tsheet${open ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
      style={{ transform }}
      aria-label="划词翻译"
      onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === "transform" && !open) { setView(null); setHeight(null); } }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="tsheet-grip" aria-hidden="true" />
      <div className="tsheet-viewport" style={height === null ? undefined : { height }}>
        <div ref={bodyRef} className={`tsheet-body kind-${view.type}`}>
          <div ref={scrollRef} className={`tsheet-scroll${scrollable ? " is-scrollable" : ""}`}>
            <div className="tsheet-row">
              <div className="tsheet-text" aria-live="polite">
                <p className="tsheet-source" lang="en">{view.text}</p>
                {view.loading
                  ? <span className="tsheet-shimmer" role="status" aria-label="正在翻译" />
                  : <p key={view.translation} className={`tsheet-translation${view.error ? " is-error" : ""}`}>{view.translation}</p>}
                {!view.loading && view.phrase && <button type="button" className="tsheet-phrase" onClick={() => view.phrase && onOpenPhrase?.(view.phrase)} title="查看并收藏这个搭配">
                  <span className="tsheet-phrase-label">搭配</span><span className="tsheet-phrase-en" lang="en">{view.phrase.text}</span><span className="tsheet-phrase-zh">{view.phrase.translation}</span></button>}
              </div>
              <button
                type="button"
                className={`tsheet-save${saved ? " is-saved" : ""}`}
                disabled={view.loading || view.error || saving || saved}
                onClick={onSave}
                aria-label={saved ? "已收藏" : "收藏"}
                title={saved ? "已收藏" : "收藏"}
              >
                {saving ? <Loader2 className="animate-spin" /> : saved ? <BookmarkCheck /> : <Bookmark />}
              </button>
            </div>
          </div>
          <div className="tsheet-meta">
            <span>{kindLabel[view.type]}</span>
            {view.type === "phrase" && !saved && <button type="button" onClick={() => onSwitchType("sentence")}>改存句子本</button>}
            {canSwitchToPhrase && !saved && <button type="button" onClick={() => onSwitchType("phrase")}>改存为词组</button>}
          </div>
        </div>
      </div>
    </section>,
    document.body,
  );
}
