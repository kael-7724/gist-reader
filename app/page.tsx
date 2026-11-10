"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookOpen, Bookmark, Check, Highlighter, Cloud, CloudCheck, ExternalLink, Eye, EyeOff, FileText, Languages, Library, Loader2, Plus, Search, Settings2, Sparkles, Trash2, Unlink, Upload, Volume2, Type } from "lucide-react";
import { AnnotatedParagraph } from "@/components/annotated-paragraph";
import { formatImportDate, kaoyanVocab, splitArticle } from "@/lib/article-meta";
import { ReadingStats, useReadingTimer } from "@/components/reading-stats";
import { KaoyanCoverage } from "@/components/kaoyan-coverage";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
type Article = { id: number; title: string; shortTitle?: string; content: string; createdAt: string; translationStatus?: "pending" | "processing" | "ready" | "failed"; translationProvider?: string; translationError?: string | null; translatedAt?: string | null };
type RelatedWord = { word: string; translation: string };
type SavedWord = { id: number; articleId?: number | null; text: string; translation: string; context: string; articleTitle: string; createdAt: string; maimemoVocId?: string | null; syncStatus?: "pending" | "synced" | "failed"; syncError?: string | null; syncedAt?: string | null; similarJson?: string | null; lookalikeJson?: string | null };
type SavedSentence = { id: number; articleId?: number | null; text: string; translation: string; articleTitle: string; createdAt: string };
type SelectionKind = "word" | "phrase" | "sentence";
type SelectionDraft = { text: string; type: SelectionKind; context: string; translation: string; loading: boolean; error?: boolean };
type TranslationMode = "realtime";
type ReadingSettings = { fontSize: number; lineHeight: number; fontFamily: "serif" | "sans" | "georgia"; letterSpacing: number };
const defaultReadingSettings: ReadingSettings = { fontSize: 20, lineHeight: 1.95, fontFamily: "georgia", letterSpacing: 0 };

function articleLabel(article: Pick<Article, "title" | "shortTitle">) {
  return article.shortTitle?.trim() || article.title;
}

async function json<T>(response: Response) {
  return response.json() as Promise<T>;
}

const starterArticle: Article = {
  id: 0,
  title: "A Small Habit That Changes How We Learn",
  createdAt: "示例文章",
  content: "Learning a language is rarely the result of one dramatic breakthrough. More often, it grows from small moments of attention repeated every day.\n\nWhen you pause at an unfamiliar word, notice how it works inside a sentence, and return to it later, you are building a durable memory. The goal is not to collect as many words as possible, but to understand them in living contexts.\n\nA good reading habit turns curiosity into progress. Each sentence becomes a place to observe rhythm, meaning, and structure. Over time, what once felt difficult begins to feel familiar.",
};

const fallbackMeanings: Record<string, string> = {
  learning: "学习；获得知识或技能的过程", language: "语言", rarely: "很少；难得", dramatic: "显著的；戏剧性的",
  breakthrough: "突破；重大进展", attention: "注意；关注", unfamiliar: "不熟悉的", sentence: "句子",
  durable: "持久的；耐用的", memory: "记忆", context: "语境；上下文", curiosity: "好奇心",
  progress: "进步；进展", rhythm: "节奏", meaning: "含义；意义", structure: "结构", familiar: "熟悉的",
};

function tokenize(text: string) {
  return text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g).filter(Boolean);
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

function WordHover({ word, articleId, known, mode }: { word: string; articleId?: number | null; known?: string; mode: TranslationMode }) {
  const clean = word.toLowerCase().replace(/[^a-z'-]/g, "");
  const [meaning, setMeaning] = useState(known || fallbackMeanings[clean] || "");
  const [lookupError, setLookupError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadMeaning() {
    if (!clean || meaning || loading) return;
    setLoading(true);
    setLookupError("");
    try {
      const response = await fetch(`/api/define?word=${encodeURIComponent(clean)}&articleId=${articleId ?? 0}&mode=${mode}`);
      const data = await json<{ translation?: string; error?: string }>(response);
      if (response.ok && data.translation) setMeaning(data.translation);
      else setLookupError(data.error || "暂时没有找到释义");
    } catch {
      setLookupError("释义暂时不可用");
    } finally {
      setLoading(false);
    }
  }

  return (
    <HoverCard openDelay={180} closeDelay={80} onOpenChange={(open) => open && loadMeaning()}>
      <HoverCardTrigger className="sentence-word" asChild><button type="button">{word}</button></HoverCardTrigger>
      <HoverCardContent className="w-72 rounded-2xl border-slate-200 p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-lg font-semibold text-foreground">{clean}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{loading ? "正在查询释义…" : meaning || lookupError || "悬停后查询释义"}</p></div>
          <Button variant="ghost" size="icon" onClick={() => speak(clean)} aria-label={`朗读 ${clean}`}><Volume2 className="size-4" /></Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default function Home() {
  const [tab, setTab] = useState("read");
  const [articles, setArticles] = useState<Article[]>([starterArticle]);
  const [activeArticleId, setActiveArticleId] = useState(0);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [sentences, setSentences] = useState<SavedSentence[]>([]);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [query, setLibraryQuery] = useState("");
  const [selectedWordIds, setSelectedWordIds] = useState<Set<number> | null>(null);
  const [deletingWords, setDeletingWords] = useState(false);
  const [confirmWordDeletion, setConfirmWordDeletion] = useState(false);
  const setQuery = useCallback((value: string) => {
    setLibraryQuery(value);
    setSelectedWordIds((ids) => ids === null ? null : new Set());
  }, []);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [articleDockOpen, setArticleDockOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftShort, setDraftShort] = useState("");
  const [editingShort, setEditingShort] = useState<string | null>(null);
  const dockListRef = useRef<HTMLDivElement | null>(null);

  // In the article bar, a normal vertical mouse wheel scrolls the list sideways (no Shift needed).
  useEffect(() => {
    const list = dockListRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const step = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaMode === 2 ? event.deltaY * list.clientWidth : event.deltaY;
      list.scrollLeft += step;
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maimemoConnected, setMaimemoConnected] = useState(false);
  const [maimemoToken, setMaimemoToken] = useState("");
  const [maimemoLoading, setMaimemoLoading] = useState(false);
  const [syncingIds, setSyncingIds] = useState<number[]>([]);
  const translationFloatRef = useRef<HTMLElement | null>(null);
  const translationRequestRef = useRef(0);
  const translationMode: TranslationMode = "realtime";
  const [readingOpen, setReadingOpen] = useState(false);
  const [readingSettings, setReadingSettings] = useState<ReadingSettings>(defaultReadingSettings);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiConnected, setAiConnected] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState("https://api.deepseek.com/chat/completions");
  const [aiModel, setAiModel] = useState("deepseek-flash");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiThinkingMode, setAiThinkingMode] = useState<"disabled" | "enabled">("disabled");
  const [aiLoading, setAiLoading] = useState(false);
  const [enrichingIds, setEnrichingIds] = useState<number[]>([]);
  const [wordColumnCount, setWordColumnCount] = useState(3);
  const [wordGridElement, setWordGridElement] = useState<HTMLDivElement | null>(null);
  const initialPixelRatioRef = useRef<number | null>(null);
  const [expandedWordId, setExpandedWordId] = useState<number | null>(null);
  const [pinnedWordId, setPinnedWordId] = useState<number | null>(null);
  const [translationsHidden, setTranslationsHidden] = useState(false);
  const [revealedWordIds, setRevealedWordIds] = useState<number[]>([]);
  const [kaoyanOn, setKaoyanOn] = useState(true);
  const wordMoveRectsRef = useRef<Map<number, DOMRect> | null>(null);
  const movingWordRef = useRef(false);

  const activeArticle = articles.find((item) => item.id === activeArticleId) || articles[0];
  const filteredWords = words.filter((item) => `${item.text} ${item.translation}`.toLowerCase().includes(query.toLowerCase()));
  const allFilteredWordsSelected = filteredWords.length > 0 && filteredWords.every((word) => selectedWordIds?.has(word.id));
  const filteredSentences = sentences.filter((item) => `${item.text} ${item.translation}`.toLowerCase().includes(query.toLowerCase()));
  const savedWordSet = useMemo(() => new Set(words.map((item) => item.text.toLowerCase())), [words]);
  const savedSentenceTexts = useMemo(() => sentences.map((item) => item.text), [sentences]);
  const savedPhraseTexts = useMemo(() => words.filter((item) => item.text.includes(" ")).map((item) => item.text), [words]);
  useReadingTimer(activeArticle?.id ?? 0, tab === "read");
  const savedWordTexts = useMemo(() => words.map((item) => item.text), [words]);
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);
  const sourceLabel = (articleId: number | null | undefined, fallback: string) => {
    const article = articleId ? articleById.get(articleId) : undefined;
    return article ? articleLabel(article) : fallback;
  };
  const articleParts = useMemo(() => splitArticle(activeArticle?.content || ""), [activeArticle?.content]);
  const deepseekConnected = aiConnected && aiEndpoint === "https://api.deepseek.com/chat/completions" && aiModel === "deepseek-flash";
  const wordColumns = Array.from({ length: wordColumnCount }, () => [] as SavedWord[]);
  filteredWords.forEach((word, index) => wordColumns[index % wordColumnCount].push(word));
  const expandedIndex = filteredWords.findIndex((word) => word.id === expandedWordId);
  const expandedColumn = expandedIndex < 0 ? -1 : expandedIndex % wordColumnCount;
  const wordColumnWidths = Array.from({ length: wordColumnCount }, (_, index) => {
    if (expandedColumn < 0 || wordColumnCount === 1) return "minmax(0, 1fr)";
    const activeWidth = wordColumnCount === 2 ? 1.15 : 1.2;
    return `minmax(0, ${index === expandedColumn ? activeWidth : (wordColumnCount - activeWidth) / (wordColumnCount - 1)}fr)`;
  }).join(" ");

  useLayoutEffect(() => {
    const previousRects = wordMoveRectsRef.current;
    if (!previousRects) return;
    wordMoveRectsRef.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll<HTMLElement>("[data-word-card-id]").forEach((card) => {
      const id = Number(card.dataset.wordCardId);
      const previous = previousRects.get(id);
      if (!previous) return;
      const next = card.getBoundingClientRect();
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const moved = id === words[0]?.id;
      if (moved) card.style.zIndex = "3";
      const animation = card.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ], { duration: moved ? 520 : 440, easing: "cubic-bezier(.2,.8,.2,1)" });
      animation.onfinish = animation.oncancel = () => { if (moved) card.style.zIndex = ""; };
    });
  }, [words]);

  useEffect(() => {
    if (!wordGridElement) return;
    const grid = wordGridElement;
    if (initialPixelRatioRef.current === null) initialPixelRatioRef.current = window.devicePixelRatio || 1;
    const update = () => {
      const width = grid.getBoundingClientRect().width;
      const zoom = Math.max(0.5, Math.min(3, (window.devicePixelRatio || 1) / (initialPixelRatioRef.current || 1) * (window.visualViewport?.scale || 1)));
      const availableColumns = (width + 8) / (188 * zoom);
      const widthCap = Math.floor((width + 8) / 160);
      if (width > 0) setWordColumnCount(Math.max(1, Math.min(10, widthCap, zoom < 0.99 ? Math.ceil(availableColumns) : Math.floor(availableColumns))));
    };
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    update();
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, [wordGridElement]);

  useEffect(() => {
    if (pinnedWordId === null) return;
    const dismiss = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.("[data-word-card-id]");
      if (card?.getAttribute("data-word-card-id") === String(pinnedWordId)) return;
      setPinnedWordId(null);
      setExpandedWordId(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pinnedWordId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("lexitrace-reading-settings") || "null") as Partial<ReadingSettings> | null;
      if (saved) queueMicrotask(() => setReadingSettings({
        fontSize: typeof saved.fontSize === "number" ? Math.min(32, Math.max(14, saved.fontSize)) : 20,
        lineHeight: typeof saved.lineHeight === "number" ? Math.min(2.6, Math.max(1.3, saved.lineHeight)) : 1.95,
        fontFamily: saved.fontFamily === "serif" || saved.fontFamily === "sans" || saved.fontFamily === "georgia" ? saved.fontFamily : "georgia",
        letterSpacing: typeof saved.letterSpacing === "number" ? Math.min(2, Math.max(0, saved.letterSpacing)) : 0,
      }));
    } catch { /* Ignore invalid device-local preferences. */ }
  }, []);

  useEffect(() => {
    try { if (localStorage.getItem("gist-kaoyan-highlight") === "off") queueMicrotask(() => setKaoyanOn(false)); } catch { /* Device preference only. */ }
  }, []);

  function toggleKaoyan() {
    setKaoyanOn((on) => {
      try { localStorage.setItem("gist-kaoyan-highlight", on ? "off" : "on"); } catch { /* Device preference only. */ }
      return !on;
    });
  }

  function updateReadingSettings(next: ReadingSettings) {
    setReadingSettings(next);
    localStorage.setItem("lexitrace-reading-settings", JSON.stringify(next));
  }

  useEffect(() => {
    fetch("/api/library").then((response) => { if (response.status === 401) { window.location.href = "/login?next=/"; } return response; }).then((response) => response.ok ? json<{ articles?: Article[]; words?: SavedWord[]; sentences?: SavedSentence[] }>(response) : Promise.reject()).then((data) => {
      const loadedArticles = Array.isArray(data.articles) ? data.articles : [];
      if (loadedArticles.length) { setArticles(loadedArticles); setActiveArticleId(loadedArticles[0].id); }
      setWords(Array.isArray(data.words) ? data.words : []); setSentences(Array.isArray(data.sentences) ? data.sentences : []);
    }).catch(() => undefined);
    fetch("/api/maimemo/connection").then((response) => response.ok ? json<{ connected: boolean }>(response) : Promise.reject()).then((data) => setMaimemoConnected(Boolean(data.connected))).catch(() => undefined);
    fetch("/api/ai/connection").then((response) => response.ok ? json<{ connected: boolean; endpoint?: string; model?: string; thinkingMode?: string }>(response) : Promise.reject()).then((data) => { setAiConnected(Boolean(data.connected)); if (data.endpoint) setAiEndpoint(data.endpoint); if (data.model) setAiModel(data.model); if (data.thinkingMode === "enabled") setAiThinkingMode("enabled"); }).catch(() => undefined);
  }, []);

  async function translateSelection(text: string, type: SelectionKind, context: string) {
    const requestId = ++translationRequestRef.current;
    setSelection({ text, type, context, translation: "", loading: true });
    try {
      if (!activeArticle || activeArticle.id < 1) throw new Error("请先添加自己的文章");
      const response = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, type, context, articleId: activeArticle.id, mode: translationMode }) });
      const data = await json<{ translation?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "实时翻译失败");
      if (translationRequestRef.current === requestId) setSelection({ text, type, context, translation: data.translation || "暂时没有获取到翻译", loading: false, error: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "翻译暂时不可用";
      if (translationRequestRef.current === requestId) setSelection({ text, type, context, translation: message, loading: false, error: true });
      if (message.includes("DeepSeek")) setAiOpen(true);
    }
  }

  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: PointerEvent) => {
      if (translationFloatRef.current?.contains(event.target as Node)) return;
      translationRequestRef.current += 1;
      setSelection(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [selection]);

  function handleSelection() {
    const selected = window.getSelection()?.toString().trim().replace(/\s+/g, " ") || "";
    if (!selected || selected.length > 700) return;
    const core = selected.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    const wordCount = core.split(" ").filter(Boolean).length;
    // One word goes to the word book; 2–4 plain words (e.g. "take over", "on the contrary") are a phrase, which also goes to the word book; anything longer is a sentence.
    const type: SelectionKind = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(selected) ? "word" : wordCount >= 2 && wordCount <= 4 && /^[A-Za-z'’ -]+$/.test(core) ? "phrase" : "sentence";
    const fullText = activeArticle.content.replace(/\s+/g, " ");
    const at = fullText.indexOf(selected);
    const context = at >= 0 ? fullText.slice(Math.max(0, at - 90), Math.min(fullText.length, at + selected.length + 90)) : selected;
    void translateSelection(selected, type, context);
    window.getSelection()?.removeAllRanges();
  }

  async function saveSelection() {
    if (!selection || !activeArticle) return;
    setSaving(true);
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-selection", ...selection, articleId: activeArticle.id, articleTitle: activeArticle.title }) });
      const data = await json<{ error?: string; item: SavedWord | SavedSentence }>(response);
      if (!response.ok) throw new Error(data.error);
      if (selection.type !== "sentence") { const item = data.item as SavedWord; setWords((items) => [item, ...items.filter((x) => x.id !== item.id)]); if (selection.type === "phrase") toast.success("词组已加入单词本"); else if (item.text.toLowerCase() !== selection.text.toLowerCase()) toast.success(`已还原为 ${item.text} 并加入单词本`); else toast.success("已加入单词本"); if (aiConnected) void enrichWord(item.id); }
      else { const item = data.item as SavedSentence; setSentences((items) => [item, ...items.filter((x) => x.id !== item.id)]); }
      if (selection.type === "sentence") toast.success("已加入句子本"); setSelection(null);
    } catch { toast.error("保存失败，请稍后重试"); } finally { setSaving(false); }
  }

  async function importFile(file: File) {
    const isDocx = file.name.toLowerCase().endsWith(".docx");
    if (!isDocx && !file.name.toLowerCase().endsWith(".txt")) { toast.error("第一版支持 TXT 和 DOCX 文件"); return; }
    setDraftTitle(file.name.replace(/\.(txt|docx)$/i, ""));
    if (isDocx) {
      const mammoth = await import("mammoth/mammoth.browser");
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      setDraftText(result.value.trim());
    } else setDraftText(await file.text());
  }

  async function addArticle() {
    if (!draftTitle.trim() || !draftText.trim()) { toast.error("请填写标题和文章内容"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-article", title: draftTitle, shortTitle: draftShort, content: draftText }) });
      const data = await json<{ error?: string; article: Article }>(response);
      if (!response.ok) throw new Error(data.error);
      setArticles((items) => [data.article, ...items.filter((item) => item.id !== 0)]); setActiveArticleId(data.article.id);
      setDraftTitle(""); setDraftText(""); setDraftShort(""); setUploadOpen(false); setTab("read");
      if (!deepseekConnected) { toast.success("文章已保存，请先连接 DeepSeek"); setAiOpen(true); }
      else toast.success("文章已保存，划词或划句时会实时翻译");
    } catch { toast.error("文章保存失败，请稍后重试"); } finally { setSaving(false); }
  }

  async function removeItem(kind: "word" | "sentence", id: number) {
    const response = await fetch(`/api/library?kind=${kind}&id=${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error("删除失败");
    if (kind === "word") removeWordsFromView(new Set([id]));
    else setSentences((items) => items.filter((item) => item.id !== id));
    toast.success("已删除");
  }

  function removeWordsFromView(ids: Set<number>) {
    setWords((items) => items.filter((item) => !ids.has(item.id)));
    setExpandedWordId((id) => id !== null && ids.has(id) ? null : id);
    setPinnedWordId((id) => id !== null && ids.has(id) ? null : id);
    setRevealedWordIds((items) => items.filter((id) => !ids.has(id)));
    setSelectedWordIds((selected) => selected === null ? null : new Set([...selected].filter((id) => !ids.has(id))));
  }

  function startWordSelection() {
    if (movingWordRef.current) {
      toast.error("正在保存单词顺序，请稍后重试");
      return;
    }
    setExpandedWordId(null);
    setPinnedWordId(null);
    setSelectedWordIds(new Set());
  }

  function toggleWordSelection(id: number) {
    setSelectedWordIds((ids) => {
      if (ids === null) return null;
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelectedWords() {
    if (!selectedWordIds?.size || deletingWords) return;
    const ids = selectedWordIds;
    setDeletingWords(true);
    try {
      const response = await fetch("/api/library?kind=words", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...ids] }),
      });
      if (!response.ok) throw new Error("删除失败");
      const { deleted } = await json<{ deleted: number }>(response);
      removeWordsFromView(ids);
      setConfirmWordDeletion(false);
      setSelectedWordIds(null);
      toast.success(deleted ? `已删除 ${deleted} 个单词` : "所选单词已不在单词本中");
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setDeletingWords(false);
    }
  }

  function captureWordRects() {
    return new Map(Array.from(document.querySelectorAll<HTMLElement>("[data-word-card-id]"), (card) => [Number(card.dataset.wordCardId), card.getBoundingClientRect()] as const));
  }

  async function moveWordFirst(id: number) {
    if (movingWordRef.current || words[0]?.id === id) return;
    const word = words.find((item) => item.id === id);
    if (!word) return;
    movingWordRef.current = true;
    const previousWords = words;
    wordMoveRectsRef.current = captureWordRects();
    setPinnedWordId(null);
    setExpandedWordId(null);
    setWords((items) => [word, ...items.filter((item) => item.id !== id)]);
    try {
      const response = await fetch("/api/library", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("无法保存单词顺序");
    } catch {
      wordMoveRectsRef.current = captureWordRects();
      setWords(previousWords);
      toast.error("置顶失败，已恢复原来的顺序");
    } finally {
      movingWordRef.current = false;
    }
  }

  async function saveShortTitle(id: number, value: string) {
    setEditingShort(null);
    const shortTitle = [...value.replace(/\s/g, "")].slice(0, 5).join("");
    try {
      const response = await fetch("/api/library", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "short-title", shortTitle }) });
      const data = await json<{ shortTitle?: string; error?: string }>(response);
      if (!response.ok) throw new Error(data.error);
      setArticles((items) => items.map((article) => article.id === id ? { ...article, shortTitle: data.shortTitle ?? shortTitle } : article));
    } catch { toast.error("简称保存失败，请重试"); }
  }

  async function removeArticle(id: number) {
    const response = await fetch(`/api/library?kind=article&id=${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error("文章删除失败");
    setArticles((items) => {
      const remaining = items.filter((article) => article.id !== id);
      if (!remaining.length) {
        setActiveArticleId(0);
        return [starterArticle];
      }
      if (activeArticleId === id) setActiveArticleId(remaining[0].id);
      return remaining;
    });
    setSelection(null);
    toast.success("文章已删除，收藏的词句已保留");
  }

  async function connectAi() {
    if (!deepseekConnected && !aiApiKey.trim()) return toast.error("请填写 DeepSeek API Key");
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai/connection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", apiKey: aiApiKey, thinkingMode: aiThinkingMode }) });
      const data = await json<{ error?: string; endpoint?: string; model?: string }>(response);
      if (!response.ok) throw new Error(data.error || "保存 AI 连接失败");
      setAiConnected(true); setAiEndpoint(data.endpoint || aiEndpoint); setAiModel(data.model || aiModel); setAiApiKey("");
      toast.success("DeepSeek 已连接，可以翻译和生成词汇联想");
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存 AI 连接失败"); }
    finally { setAiLoading(false); }
  }

  async function disconnectAi() {
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai/connection", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setAiConnected(false); setAiApiKey(""); toast.success("已断开 AI 接口，已生成的词汇联想仍会保留");
    } catch { toast.error("断开 AI 接口失败"); }
    finally { setAiLoading(false); }
  }

  async function enrichWord(id: number, refresh = false) {
    if (!deepseekConnected) { setAiOpen(true); toast.info("请先连接 DeepSeek API"); return false; }
    setEnrichingIds((items) => [...new Set([...items, id])]);
    try {
      const response = await fetch("/api/ai/enrich", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, refresh }) });
      const data = await json<{ error?: string; similar?: RelatedWord[]; lookalike?: RelatedWord[] }>(response);
      if (!response.ok || !data.similar || !data.lookalike) throw new Error(data.error || "生成失败");
      setWords((items) => items.map((item) => item.id === id ? { ...item, similarJson: JSON.stringify(data.similar), lookalikeJson: JSON.stringify(data.lookalike) } : item));
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "生成失败"); return false; }
    finally { setEnrichingIds((items) => items.filter((item) => item !== id)); }
  }

  async function enrichMissingWords() {
    if (!deepseekConnected) { setAiOpen(true); toast.info("请先连接 DeepSeek API"); return; }
    const batch = words.filter((word) => !word.similarJson && !enrichingIds.includes(word.id)).slice(0, 10);
    if (!batch.length) return toast.info("所有单词都已生成词汇联想");
    let completed = 0;
    for (const word of batch) if (await enrichWord(word.id)) completed += 1;
    if (completed) toast.success(`本次已生成 ${completed} 个单词的词汇联想`);
  }

  async function connectMaimemo() {
    if (!maimemoToken.trim()) return toast.error("请输入墨墨开放 API 凭证");
    setMaimemoLoading(true);
    try {
      const response = await fetch("/api/maimemo/connection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: maimemoToken }) });
      const data = await json<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "连接失败");
      setMaimemoConnected(true); setMaimemoToken(""); toast.success("墨墨背单词已连接");
    } catch (error) { toast.error(error instanceof Error ? error.message : "连接失败"); }
    finally { setMaimemoLoading(false); }
  }

  async function disconnectMaimemo() {
    setMaimemoLoading(true);
    try {
      const response = await fetch("/api/maimemo/connection", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setMaimemoConnected(false); setMaimemoToken(""); toast.success("已断开墨墨连接");
    } catch { toast.error("断开连接失败"); }
    finally { setMaimemoLoading(false); }
  }

  async function syncWords(ids: number[]) {
    if (!maimemoConnected) { setSettingsOpen(true); toast.info("请先连接墨墨背单词"); return; }
    const batch = ids.filter((id) => !syncingIds.includes(id)).slice(0, 30);
    if (!batch.length) return toast.info("没有需要同步的单词");
    setSyncingIds((items) => [...new Set([...items, ...batch])]);
    try {
      const response = await fetch("/api/maimemo/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: batch }) });
      const data = await json<{ error?: string; results?: Array<{ id: number; status: "synced" | "failed"; error?: string; warning?: string }>; synced?: number; failed?: number; warnings?: number }>(response);
      if (!response.ok) throw new Error(data.error || "同步失败");
      if (!Array.isArray(data.results)) throw new Error("墨墨返回的数据格式异常，请稍后重试");
      const resultMap = new Map<number, { status: "synced" | "failed"; error?: string }>(data.results.map((item) => [item.id, item]));
      setWords((items) => items.map((word) => { const result = resultMap.get(word.id); return result ? { ...word, syncStatus: result.status, syncError: result.error || null, syncedAt: result.status === "synced" ? new Date().toISOString() : word.syncedAt } : word; }));
      if (data.synced) toast.success(`已同步 ${data.synced} 个单词到墨墨`);
      if (data.failed) toast.error(`${data.failed} 个单词同步失败，可单独重试`);
      if (data.warnings) toast.info(`${data.warnings} 个单词已同步，但墨墨没有接受对应例句`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "同步失败"); }
    finally { setSyncingIds((items) => items.filter((id) => !batch.includes(id))); }
  }

  useEffect(() => {
    const page = document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } };
    if (!page.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await page.modelContext?.registerTool({
        name: "open_library_view",
        title: "打开学习页面",
        description: "在阅读、单词本和句子本之间切换当前可见页面。",
        inputSchema: { type: "object", properties: { view: { type: "string", enum: ["read", "words", "sentences"] } }, required: ["view"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input: unknown) {
          const view = (input as { view?: string }).view;
          if (!view || !["read", "words", "sentences"].includes(view)) throw new Error("无效页面");
          setTab(view);
          return { visibleView: view };
        },
      }, { signal: lifecycle.signal });
      await page.modelContext?.registerTool({
        name: "search_saved_language",
        title: "搜索收藏",
        description: "在单词本或句子本中搜索英文内容和中文翻译。",
        inputSchema: { type: "object", properties: { query: { type: "string" }, kind: { type: "string", enum: ["words", "sentences"] } }, required: ["query", "kind"], additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input: unknown) {
          const data = input as { query?: string; kind?: string };
          if (!data.query || !data.kind || !["words", "sentences"].includes(data.kind)) throw new Error("搜索参数无效");
          setQuery(data.query); setTab(data.kind);
          const source = data.kind === "words" ? words : sentences;
          const matches = source.filter((item) => `${item.text} ${item.translation}`.toLowerCase().includes(data.query!.toLowerCase())).length;
          return { visibleView: data.kind, query: data.query, matches };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [words, sentences, setQuery]);

  const wordMap = useMemo(() => Object.fromEntries(words.map((item) => [item.text.toLowerCase(), item.translation])), [words]);

  return (
    <main className="app-shell">
      <Toaster position="top-center" theme="dark" />
      <Tabs value={tab} onValueChange={setTab} className="workspace">
        <header className="topbar">
          <TabsList className="reader-tabs" aria-label="页面导航">
            <TabsTrigger value="read" className="reader-tab" aria-label="阅读" title="阅读"><BookOpen /><span className="reader-tab-label">阅读</span></TabsTrigger>
            <TabsTrigger value="words" className="reader-tab" aria-label="单词本" title="单词本"><Bookmark /><span className="reader-tab-label">单词本</span><span className="reader-tab-count">{words.length}</span></TabsTrigger>
            <TabsTrigger value="sentences" className="reader-tab" aria-label="句子本" title="句子本"><Library /><span className="reader-tab-label">句子本</span><span className="reader-tab-count">{sentences.length}</span></TabsTrigger>
            <TabsTrigger value="stats" className="reader-tab" aria-label="统计" title="阅读统计"><BarChart3 /><span className="reader-tab-label">统计</span></TabsTrigger>
          </TabsList>
          <div className="topbar-actions">
            <Button variant={kaoyanOn ? "default" : "outline"} className="rounded-xl" aria-pressed={kaoyanOn} onClick={toggleKaoyan} aria-label={kaoyanOn ? "隐藏考研词标记" : "显示考研词标记"} title="在文章中用虚线标出考研词汇"><Highlighter className="size-4" /><span className="button-label">考研词</span></Button>
            <Dialog open={readingOpen} onOpenChange={setReadingOpen}><DialogTrigger asChild><Button variant="outline" className="rounded-xl" aria-label="阅读设置" title="阅读排版"><Type className="size-4" /><span className="button-label">阅读设置</span></Button></DialogTrigger>
              <DialogContent className="rounded-xl sm:max-w-md"><DialogHeader><DialogTitle className="text-2xl">阅读设置</DialogTitle><DialogDescription>调整文章的字号、行距、字距和字体。设置仅保存在当前设备。</DialogDescription></DialogHeader>
                <div className="reading-controls"><label>字号 <strong>{readingSettings.fontSize}px</strong><input type="range" min="14" max="32" step="1" value={readingSettings.fontSize} onChange={(event) => updateReadingSettings({ ...readingSettings, fontSize: Number(event.target.value) })} /></label>
                  <label>行距 <strong>{readingSettings.lineHeight.toFixed(2)}</strong><input type="range" min="1.3" max="2.6" step="0.05" value={readingSettings.lineHeight} onChange={(event) => updateReadingSettings({ ...readingSettings, lineHeight: Number(event.target.value) })} /></label>
                  <label>字距 <strong>{readingSettings.letterSpacing.toFixed(1)}px</strong><input type="range" min="0" max="2" step="0.1" value={readingSettings.letterSpacing} onChange={(event) => updateReadingSettings({ ...readingSettings, letterSpacing: Number(event.target.value) })} /></label>
                  <label>字体 <select value={readingSettings.fontFamily} onChange={(event) => updateReadingSettings({ ...readingSettings, fontFamily: event.target.value as ReadingSettings["fontFamily"] })}><option value="georgia">Georgia 衬线</option><option value="serif">系统衬线</option><option value="sans">系统无衬线</option></select></label>
                  <Button variant="outline" className="rounded-xl" onClick={() => updateReadingSettings(defaultReadingSettings)}>恢复默认</Button></div>
              </DialogContent></Dialog>
            <Dialog open={aiOpen} onOpenChange={setAiOpen}><DialogTrigger asChild><Button variant="outline" className="rounded-xl" aria-label="DeepSeek 翻译与词汇联想" title="DeepSeek 翻译与词汇联想"><Sparkles className="size-4" /><span className="button-label">DeepSeek</span>{deepseekConnected && <span className="connection-dot" />}</Button></DialogTrigger>
              <DialogContent className="rounded-xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">DeepSeek</DialogTitle><DialogDescription className="sr-only">翻译与词汇联想</DialogDescription></DialogHeader>
                {deepseekConnected && <div className="connection-panel connected"><span className="connection-icon"><CloudCheck /></span><div><h3>已连接</h3></div></div>}
                {aiConnected && !deepseekConnected && <p className="security-note">请重新填写 API Key</p>}
                <label className="ai-field">联想模式<select className="ai-mode-select" value={aiThinkingMode} onChange={(event) => setAiThinkingMode(event.target.value as "disabled" | "enabled")}><option value="disabled">快速</option><option value="enabled">深度思考</option></select></label>
                <label className="ai-field">API Key<Input type="password" autoComplete="off" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder={deepseekConnected ? "留空则不变" : "粘贴 API Key"} className="mt-1 h-11 rounded-xl" /></label>
                <Button className="rounded-xl" disabled={aiLoading} onClick={() => void connectAi()}>{aiLoading && <Loader2 className="size-4 animate-spin" />}保存</Button>
                {aiConnected && <Button variant="outline" className="rounded-xl text-destructive" disabled={aiLoading} onClick={() => void disconnectAi()}><Unlink className="size-4" />断开</Button>}
              </DialogContent></Dialog>
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogTrigger asChild><Button variant="outline" className="rounded-xl" aria-label="墨墨连接"><Settings2 className="size-4" /><span className="button-label">墨墨连接</span>{maimemoConnected && <span className="connection-dot" />}</Button></DialogTrigger>
              <DialogContent className="rounded-xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">墨墨背单词</DialogTitle><DialogDescription className="sr-only">同步单词到墨墨</DialogDescription></DialogHeader>
                {maimemoConnected ? <div className="connection-panel connected"><span className="connection-icon"><CloudCheck /></span><div><h3>已连接</h3></div></div> : <><a className="token-link" href="https://open.maimemo.com/open/api/v1/tokens/openapi" target="_blank" rel="noreferrer">获取凭证 <ExternalLink className="size-4" /></a><Input type="password" autoComplete="off" value={maimemoToken} onChange={(event) => setMaimemoToken(event.target.value)} placeholder="粘贴凭证" className="h-12 rounded-xl" /><Button className="h-11 rounded-xl" onClick={() => void connectMaimemo()} disabled={maimemoLoading}>{maimemoLoading && <Loader2 className="size-4 animate-spin" />}连接</Button></>}
                {maimemoConnected && <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="rounded-xl text-destructive"><Unlink className="size-4" />断开</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>断开墨墨连接？</AlertDialogTitle><AlertDialogDescription>已同步的单词不受影响。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void disconnectMaimemo()}>断开</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
              </DialogContent></Dialog>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogTrigger asChild><Button className="rounded-xl px-4" aria-label="添加文章"><Plus className="size-4" /><span className="button-label">添加文章</span></Button></DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto rounded-xl sm:max-w-2xl"><DialogHeader><DialogTitle className="text-2xl">添加英语文章</DialogTitle><DialogDescription>上传 TXT、DOCX，或者直接粘贴文章内容。</DialogDescription></DialogHeader>
                <label className="upload-zone"><Upload className="size-6 text-foreground" /><span className="font-medium">选择 TXT 或 DOCX 文件</span><span className="text-sm text-muted-foreground">文件只用于提取文字</span><input className="sr-only" type="file" accept=".txt,.docx" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} /></label>
                <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="文章标题" className="h-11 rounded-xl" />
                <Input value={draftShort} onChange={(event) => setDraftShort([...event.target.value].slice(0, 5).join(""))} placeholder="简称，最多 5 个字（如：粉色噪音）" className="h-11 rounded-xl" />
                <Textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="在这里粘贴英语文章……" className="min-h-56 rounded-xl leading-7" />
                <Button className="h-11 rounded-xl" onClick={() => void addArticle()} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}保存并开始阅读</Button>
              </DialogContent></Dialog>
          </div>
        </header>

        <section className="content"><TabsContent value="read" className="h-full"><div className="reader-layout"><article className="reader-panel"><div className="reader-heading"><div><div className="reader-meta-row"><p className="eyebrow">{activeArticle && activeArticle.id > 0 ? `导入于 ${formatImportDate(activeArticle.createdAt)}` : "示例文章"}</p>{activeArticle && activeArticle.id > 0 && (editingShort !== null
    ? <input className="short-title-input" autoFocus value={editingShort} maxLength={8} placeholder="最多 5 个字" aria-label="文章简称" onChange={(event) => setEditingShort([...event.target.value].slice(0, 5).join(""))} onBlur={() => void saveShortTitle(activeArticle.id, editingShort)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditingShort(null); }} />
    : <button type="button" className="short-title-chip" title="点击修改简称" onClick={() => setEditingShort(activeArticle.shortTitle || "")}>{activeArticle.shortTitle || "添加简称"}</button>)}</div><h1>{activeArticle?.title}</h1>{articleParts.source && <p className="article-source">{articleParts.source.publisher} · 发表于 {articleParts.source.publishedDate} · <a href={articleParts.source.url} target="_blank" rel="noreferrer">原文链接</a></p>}</div></div><div className="article-body" style={{ fontSize: readingSettings.fontSize, lineHeight: readingSettings.lineHeight, letterSpacing: readingSettings.letterSpacing, fontFamily: readingSettings.fontFamily === "georgia" ? 'Georgia, "Times New Roman", serif' : readingSettings.fontFamily === "serif" ? '"Times New Roman", "Noto Serif", serif' : 'Arial, "Noto Sans", sans-serif' }} onMouseUp={handleSelection}>{articleParts.body.split(/\n{2,}/).map((paragraph, index) => <AnnotatedParagraph key={index} text={paragraph} savedWords={savedWordSet} savedPhrases={savedPhraseTexts} savedSentences={savedSentenceTexts} vocab={kaoyanOn ? kaoyanVocab : null} />)}</div></article>
          <aside ref={translationFloatRef} className="translation-float" hidden={!selection} aria-live="polite">{selection ? <div className="selection-card"><div className="selection-type"><Languages className="size-4" />{selection.type === "word" ? "单词" : selection.type === "phrase" ? "词组 · 存到单词本" : "句子 · 存到句子本"}{selection.type === "phrase" && <button type="button" className="selection-switch" onClick={() => setSelection((current) => current && { ...current, type: "sentence" })}>改存句子本</button>}{selection.type === "sentence" && selection.text.split(" ").length <= 8 && <button type="button" className="selection-switch" onClick={() => setSelection((current) => current && { ...current, type: "phrase" })}>改存为词组</button>}</div><p className="selected-text">{selection.text}</p><div className="translation-box"><span>中文释义</span>{selection.loading ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在实时翻译…</p> : <p>{selection.translation}</p>}</div><Button className="w-full rounded-xl" disabled={selection.loading || selection.error || saving} onClick={() => void saveSelection()}>{saving && <Loader2 className="size-4 animate-spin" />}收藏</Button></div> : null}</aside></div></TabsContent>

          <TabsContent value="words" className="library-page">
            <LibraryHeader
              title="单词本"
              subtitle={selectedWordIds === null ? undefined : "选择要删除的单词"}
              query={query}
              setQuery={setQuery}
              count={words.length}
              action={selectedWordIds === null ? (
                <>
                    <Button variant="outline" className="rounded-xl" aria-pressed={translationsHidden} onClick={() => { setTranslationsHidden((hidden) => !hidden); setRevealedWordIds([]); setPinnedWordId(null); setExpandedWordId(null); }}>{translationsHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{translationsHidden ? "显示全部释义" : "隐藏全部释义"}</Button>
                    <Button variant="outline" className="rounded-xl" disabled={!words.some((word) => !word.similarJson) || enrichingIds.length > 0} onClick={() => void enrichMissingWords()}><Sparkles className="size-4" />生成词汇联想{words.filter((word) => !word.similarJson).length > 10 ? "（前10词）" : ""}</Button>
                    <Button variant="outline" className="rounded-xl" disabled={!words.some((word) => word.syncStatus !== "synced" && !word.text.includes(" ")) || syncingIds.length > 0} onClick={() => void syncWords(words.filter((word) => word.syncStatus !== "synced" && !word.text.includes(" ")).map((word) => word.id))}>{syncingIds.length > 0 ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}批量同步{words.filter((word) => word.syncStatus !== "synced" && !word.text.includes(" ")).length > 30 ? "前30词" : ""}</Button>
                  <Button variant="outline" className="rounded-xl" disabled={!filteredWords.length} onClick={startWordSelection}><Trash2 className="size-4" />批量删除</Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground" role="status">已选 {selectedWordIds.size} 个</span>
                  <Button variant="outline" className="rounded-xl" disabled={deletingWords || !filteredWords.length} onClick={() => setSelectedWordIds(new Set(allFilteredWordsSelected ? [] : filteredWords.map((word) => word.id)))}>
                    {allFilteredWordsSelected ? "取消全选" : "全选当前结果"}
                  </Button>
                  <Button variant="outline" className="rounded-xl" disabled={deletingWords} onClick={() => setSelectedWordIds(null)}>退出多选</Button>
                  <AlertDialog open={confirmWordDeletion} onOpenChange={(open) => { if (!deletingWords) setConfirmWordDeletion(open); }}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="rounded-xl text-destructive" disabled={!selectedWordIds.size || deletingWords}><Trash2 className="size-4" />删除所选</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onEscapeKeyDown={(event) => { if (deletingWords) event.preventDefault(); }}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除选中的 {selectedWordIds.size} 个单词？</AlertDialogTitle>
                        <AlertDialogDescription>这些单词将从 Gist 单词本中移除，删除后无法撤销。</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deletingWords}>取消</AlertDialogCancel>
                        <Button className="bg-destructive text-black hover:bg-destructive/85" disabled={!selectedWordIds.size || deletingWords} onClick={() => void deleteSelectedWords()}>
                          {deletingWords ? <><Loader2 className="size-4 animate-spin" />正在删除</> : "确认删除"}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            />
            {filteredWords.length ? <div ref={setWordGridElement} className={`word-grid ${expandedColumn >= 0 ? "has-expanded" : ""} ${translationsHidden ? "translations-hidden" : ""}`} style={{ gridTemplateColumns: wordColumnWidths }}>
            {wordColumns.map((column, columnIndex) => <div className="word-column" key={columnIndex}>{column.map((word) => selectedWordIds === null ? <SavedWordCard key={word.id} word={word} open={expandedWordId === word.id} translationVisible={!translationsHidden || revealedWordIds.includes(word.id)} aiConnected={deepseekConnected} enriching={enrichingIds.includes(word.id)} syncing={syncingIds.includes(word.id)}
                onHoverStart={() => { if (!translationsHidden && (pinnedWordId === null || pinnedWordId === word.id)) setExpandedWordId(word.id); }}
                onHoverEnd={() => { if (pinnedWordId !== word.id) setExpandedWordId((current) => current === word.id ? null : current); }}
                onToggle={() => { if (translationsHidden) { setRevealedWordIds((ids) => ids.includes(word.id) ? ids.filter((id) => id !== word.id) : [...ids, word.id]); return; } const next = pinnedWordId === word.id ? null : word.id; setPinnedWordId(next); setExpandedWordId(next); }}
                onMoveFirst={() => void moveWordFirst(word.id)}
                onDismiss={() => { setPinnedWordId(null); setExpandedWordId(null); }}
                onEnrich={() => void enrichWord(word.id, Boolean(word.similarJson))} onSync={() => void syncWords([word.id])} onDelete={() => void removeItem("word", word.id)} /> : (
                  <label key={word.id} className="word-card word-row">
                    <span className="word-row-trigger word-selection">
                      <input type="checkbox" aria-label={`选择 ${word.text}`} checked={selectedWordIds.has(word.id)} disabled={deletingWords} onChange={() => toggleWordSelection(word.id)} />
                      <span>
                        <span className="word-row-text">{word.text}</span>
                        {(!translationsHidden || revealedWordIds.includes(word.id)) && <span className="word-row-translation">{word.translation}</span>}
                      </span>
                    </span>
                  </label>
                ))}</div>)}
            </div> : <EmptyLibrary icon={<Bookmark />} text={words.length ? "没有符合搜索条件的单词。" : "划选文章中的单词，它会出现在这里。"} setTab={setTab} />}
          </TabsContent>

          <TabsContent value="sentences" className="library-page"><LibraryHeader title="句子本" query={query} setQuery={setQuery} count={sentences.length} />{filteredSentences.length ? <div className="sentence-list">{filteredSentences.map((sentence) => <section className="sentence-card" key={sentence.id}><div className="sentence-english">{tokenize(sentence.text).map((token, index) => /^[A-Za-z]/.test(token) ? <WordHover key={`${token}-${index}`} word={token} articleId={sentence.articleId} known={wordMap[token.toLowerCase()]} mode={translationMode} /> : <span key={`${token}-${index}`}>{token}</span>)}</div><p className="sentence-translation">{sentence.translation}</p><div className="sentence-meta"><span>来自《{sourceLabel(sentence.articleId, sentence.articleTitle)}》</span><Button variant="ghost" size="icon" onClick={() => void removeItem("sentence", sentence.id)} aria-label="删除"><Trash2 /></Button></div></section>)}</div> : <EmptyLibrary icon={<Library />} text="划选文章中的句子，它会出现在这里。" setTab={setTab} />}</TabsContent>
          <TabsContent value="stats" className="library-page"><ReadingStats active={tab === "stats"} onOpenArticle={(id) => { setActiveArticleId(id); setTab("read"); }}>{tab === "stats" && <KaoyanCoverage articles={articles} savedWords={savedWordTexts} />}</ReadingStats></TabsContent>
        </section>

        <div className={`article-dock ${articleDockOpen ? "open" : ""}`} onMouseEnter={() => setArticleDockOpen(true)} onMouseLeave={() => setArticleDockOpen(false)} onFocusCapture={() => setArticleDockOpen(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setArticleDockOpen(false); }}>
          <button type="button" className="article-dock-trigger" onClick={() => setArticleDockOpen((open) => !open)} aria-expanded={articleDockOpen} aria-label="选择文章"><FileText className="size-5" /><span>{activeArticle ? articleLabel(activeArticle) : ""}</span></button>
          <div className="article-dock-list" ref={dockListRef}>{articles.map((article) => <div className={`dock-article ${activeArticleId === article.id ? "active" : ""}`} key={article.id}><button type="button" className="dock-article-button" tabIndex={articleDockOpen ? 0 : -1} onClick={() => { setActiveArticleId(article.id); setTab("read"); setArticleDockOpen(false); }}><FileText className="size-4" /><span title={article.title}>{articleLabel(article)}</span>{article.id > 0 && <small className="dock-date">{formatImportDate(article.createdAt, true)}</small>}</button>{article.id > 0 && <AlertDialog><AlertDialogTrigger asChild><button type="button" tabIndex={articleDockOpen ? 0 : -1} className="dock-delete" aria-label={`删除《${articleLabel(article)}》`}><Trash2 className="size-3.5" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除《{articleLabel(article)}》？</AlertDialogTitle><AlertDialogDescription>文章正文和预翻译缓存会被删除，已经收藏到单词本、句子本的内容会保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-black hover:bg-destructive/85" onClick={() => void removeArticle(article.id)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>)}</div>
        </div>
      </Tabs>
    </main>
  );
}

function LibraryHeader({ title, subtitle, query, setQuery, count, action }: { title: string; subtitle?: string; query: string; setQuery: (value: string) => void; count: number; action?: React.ReactNode }) {
  return <header className="library-header"><div><p className="eyebrow">{count} 条</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="library-actions">{action}<label className="search-box"><Search className="size-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label></div></header>;
}
function EmptyLibrary({ icon, text, setTab }: { icon: React.ReactNode; text: string; setTab: (value: string) => void }) {
  return <div className="empty-library"><span>{icon}</span><p>{text}</p><Button variant="outline" className="rounded-xl" onClick={() => setTab("read")}>去阅读文章</Button></div>;
}

function SavedWordCard({ word, open, translationVisible, aiConnected, enriching, syncing, onHoverStart, onHoverEnd, onToggle, onMoveFirst, onDismiss, onEnrich, onSync, onDelete }: {
  word: SavedWord; open: boolean; translationVisible: boolean; aiConnected: boolean; enriching: boolean; syncing: boolean;
  onHoverStart: () => void; onHoverEnd: () => void; onToggle: () => void; onMoveFirst: () => void; onDismiss: () => void;
  onEnrich: () => void; onSync: () => void; onDelete: () => void;
}) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); }, []);
  return <section className={`word-card word-row ${open ? "expanded" : ""}`} data-word-card-id={word.id}
    onMouseEnter={onHoverStart} onMouseLeave={onHoverEnd}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDismiss(); }}
    onKeyDown={(event) => { if (event.key === "Escape") onDismiss(); }}>
    <button type="button" className="word-row-trigger" onClick={() => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); clickTimerRef.current = setTimeout(onToggle, 230); }} onDoubleClick={() => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); clickTimerRef.current = null; onMoveFirst(); }} aria-expanded={open} aria-label={`${word.text}${translationVisible ? `，${word.translation}` : "，点击显示释义"}；双击置顶`}>
      <span className="word-row-text">{word.text}{word.text.includes(" ") && <span className="phrase-badge">词组</span>}</span>{translationVisible && <span className="word-row-translation">{word.translation}</span>}
    </button>
    <div className="word-row-reveal" aria-hidden={!open}><div className="word-row-reveal-inner">
      <div className="word-row-related">{word.similarJson && word.lookalikeJson ? <><RelatedWords title="意思相近" raw={word.similarJson} /><RelatedWords title="长得相像" raw={word.lookalikeJson} /></> : <div className="word-popover-pending">{enriching ? <><Loader2 className="size-4 animate-spin" />正在生成词汇联想…</> : aiConnected ? "尚未生成词汇联想" : "连接 AI 接口后可生成词汇联想"}</div>}</div>
      {word.syncStatus === "failed" && word.syncError && <p className="word-popover-error">墨墨同步失败：{word.syncError}</p>}
      <div className="word-popover-actions"><Button variant="outline" size="sm" disabled={enriching} tabIndex={open ? 0 : -1} onClick={onEnrich}>{enriching ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{word.similarJson ? "重新生成" : "生成联想"}</Button><Button variant="outline" size="sm" disabled={syncing || word.syncStatus === "synced" || word.text.includes(" ")} tabIndex={open ? 0 : -1} onClick={onSync}>{syncing ? <Loader2 className="size-3.5 animate-spin" /> : word.syncStatus === "synced" ? <CloudCheck className="size-3.5" /> : <Cloud className="size-3.5" />}{word.text.includes(" ") ? "词组不同步" : word.syncStatus === "synced" ? "已同步" : "同步墨墨"}</Button><Button variant="ghost" size="icon" tabIndex={open ? 0 : -1} onClick={() => speak(word.text)} aria-label={`朗读 ${word.text}`}><Volume2 className="size-4" /></Button><Button variant="ghost" size="icon" tabIndex={open ? 0 : -1} onClick={onDelete} aria-label={`删除 ${word.text}`}><Trash2 className="size-4" /></Button></div>
    </div></div>
  </section>;
}

function RelatedWords({ title, raw }: { title: string; raw: string }) {
  let entries: RelatedWord[] = [];
  try { const data: unknown = JSON.parse(raw); if (Array.isArray(data)) entries = data.filter((item) => item && typeof item.word === "string" && typeof item.translation === "string").slice(0, 5); }
  catch { return null; }
  return <div className="related-words"><h3>{title}</h3><div>{entries.map((item) => <span className="related-word" key={item.word}><strong>{item.word}</strong><small>{item.translation}</small></span>)}</div></div>;
}
