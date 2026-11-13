"use client";

import { flushSync } from "react-dom";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ALargeSmall, BarChart3, Columns2, Link2, RefreshCw, RotateCw, Moon, Settings, Shuffle, Sun, BookOpen, Bookmark, BookmarkPlus, Layers, Cloud, CloudCheck, ExternalLink, Eye, EyeOff, FileText, Languages, Library, Loader2, Plus, Search, Sparkles, Trash2, Unlink, Upload, Volume2 } from "lucide-react";
import { AnnotatedParagraph } from "@/components/annotated-paragraph";
import { formatImportDate, kaoyanVocab, splitArticle } from "@/lib/article-meta";
import { ReadingStats, useReadingTimer } from "@/components/reading-stats";
import { KaoyanCoverage } from "@/components/kaoyan-coverage";
import { TranslationSheet } from "@/components/translation-sheet";
import { WordWall } from "@/components/word-wall";
import { AccountSection } from "@/components/account-dialog";
import { DailyPicks } from "@/components/daily-picks";
import { englishLemmaCandidates } from "@/lib/english-lemma";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
type Article = { id: number; title: string; shortTitle?: string; content: string; createdAt: string; translationStatus?: "pending" | "processing" | "ready" | "failed"; translationProvider?: string; translationError?: string | null; translatedAt?: string | null };
type RelatedWord = { word: string; translation: string };
type SavedWord = { id: number; articleId?: number | null; text: string; translation: string; context: string; articleTitle: string; createdAt: string; maimemoVocId?: string | null; syncStatus?: "pending" | "synced" | "failed"; syncError?: string | null; syncedAt?: string | null; similarJson?: string | null; lookalikeJson?: string | null; reviewedAt?: string | null; reviewCount?: number; srsStability?: number | null; srsDifficulty?: number | null };
type SavedSentence = { id: number; articleId?: number | null; text: string; translation: string; articleTitle: string; createdAt: string };
type SelectionKind = "word" | "phrase" | "sentence";
type SelectionDraft = { text: string; type: SelectionKind; context: string; translation: string; loading: boolean; error?: boolean; saved?: boolean; phrase?: { text: string; translation: string } };
type TranslationMode = "realtime";
type ReadingSettings = { fontSize: number; lineHeight: number; fontFamily: "newsreader" | "serif" | "sans" | "georgia"; letterSpacing: number };
const defaultReadingSettings: ReadingSettings = { fontSize: 20, lineHeight: 1.85, fontFamily: "newsreader", letterSpacing: 0 };
const READING_FONTS: Record<ReadingSettings["fontFamily"], string> = {
  newsreader: '"Newsreader Variable", Georgia, "Noto Serif SC", serif',
  georgia: 'Georgia, "Times New Roman", "Noto Serif SC", serif',
  serif: '"Times New Roman", "Noto Serif", "Noto Serif SC", serif',
  sans: 'Arial, "Noto Sans", sans-serif',
};
const READING_SETTINGS_KEY = "gist-reading-settings-v2";

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

// OpenAI-compatible providers offered in Settings; model names are suggestions, any id the provider lists works.
const AI_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/chat/completions", models: ["deepseek-flash", "deepseek-v4-pro"], keyUrl: "https://platform.deepseek.com/api_keys", thinking: true },
  { id: "qwen", name: "通义千问", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", models: ["qwen-plus", "qwen-flash", "qwen-max"], keyUrl: "https://bailian.console.aliyun.com/", thinking: true },
  { id: "kimi", name: "Kimi", endpoint: "https://api.moonshot.cn/v1/chat/completions", models: ["kimi-k2.6", "kimi-k3"], keyUrl: "https://platform.moonshot.cn/console/api-keys", thinking: false },
  { id: "glm", name: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", models: ["glm-5.1", "glm-4-flash"], keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", thinking: true },
  { id: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions", models: ["gpt-5-mini", "gpt-5.5"], keyUrl: "https://platform.openai.com/api-keys", thinking: false },
  { id: "custom", name: "自定义", endpoint: "", models: [] as string[], keyUrl: "", thinking: false },
];
const providerFor = (endpoint: string) => AI_PROVIDERS.find((item) => item.endpoint && item.endpoint === endpoint) ?? AI_PROVIDERS[AI_PROVIDERS.length - 1];

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
  const [draftPublisher, setDraftPublisher] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
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
  const [retranslateOpen, setRetranslateOpen] = useState(false);
  const [retranslate, setRetranslate] = useState<{ running: boolean; done: number; total: number; failed: number; finished: boolean }>({ running: false, done: 0, total: 0, failed: 0, finished: false });
  const translationFloatRef = useRef<HTMLElement | null>(null);
  const translationRequestRef = useRef(0);
  const translationMode: TranslationMode = "realtime";
  const [readingOpen, setReadingOpen] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [readingSettings, setReadingSettings] = useState<ReadingSettings>(defaultReadingSettings);
  const [aiConnected, setAiConnected] = useState(false);
  const [aiShared, setAiShared] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState("https://api.deepseek.com/chat/completions");
  const [aiModel, setAiModel] = useState("deepseek-flash");
  const [aiApiKey, setAiApiKey] = useState("");
  const [formEndpoint, setFormEndpoint] = useState("https://api.deepseek.com/chat/completions");
  const [formModel, setFormModel] = useState("deepseek-flash");
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
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
  // 标记模式: selecting a word saves it straight to the book without showing its meaning.
  const [markMode, setMarkMode] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const readerPanelRef = useRef<HTMLElement | null>(null);
  const articleBodyRef = useRef<HTMLDivElement | null>(null);
  const lastPickRef = useRef({ text: "", at: 0 });
  const tempIdRef = useRef(-1);
  const wordMoveRectsRef = useRef<Map<number, DOMRect> | null>(null);
  const movingWordRef = useRef(false);

  const activeArticle = articles.find((item) => item.id === activeArticleId) || articles[0];
  const isPhraseBook = tab === "phrases";
  const unit = isPhraseBook ? "词组" : "单词";
  const singleWords = useMemo(() => words.filter((item) => !item.text.includes(" ")), [words]);
  const phrases = useMemo(() => words.filter((item) => item.text.includes(" ")), [words]);
  const bookItems = isPhraseBook ? phrases : singleWords;
  const filteredWords = bookItems.filter((item) => `${item.text} ${item.translation}`.toLowerCase().includes(query.toLowerCase()));
  const allFilteredWordsSelected = filteredWords.length > 0 && filteredWords.every((word) => selectedWordIds?.has(word.id));
  const filteredSentences = sentences.filter((item) => `${item.text} ${item.translation}`.toLowerCase().includes(query.toLowerCase()));
  const savedWordSet = useMemo(() => new Set(words.map((item) => item.text.toLowerCase())), [words]);
  const savedSentenceTexts = useMemo(() => sentences.map((item) => item.text), [sentences]);
  const savedPhraseTexts = useMemo(() => phrases.map((item) => item.text), [phrases]);
  useReadingTimer(activeArticle?.id ?? 0, tab === "read");
  const savedWordTexts = useMemo(() => words.map((item) => item.text), [words]);
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);
  const sourceLabel = (articleId: number | null | undefined, fallback: string) => {
    const article = articleId ? articleById.get(articleId) : undefined;
    return article ? articleLabel(article) : fallback;
  };
  const articleParts = useMemo(() => splitArticle(activeArticle?.content || ""), [activeArticle?.content]);
  const readingLength = useMemo(() => {
    const tokens = articleParts.body.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    const kaoyan = new Set<string>();
    for (const token of tokens) { const lower = token.toLowerCase(); if (englishLemmaCandidates(lower).some((candidate) => kaoyanVocab.has(candidate))) kaoyan.add(lower); }
    return { words: tokens.length, minutes: Math.max(1, Math.round(tokens.length / 180)), kaoyan: kaoyan.size };
  }, [articleParts.body]);
  // A hairline under the top bar that fills as the article is read.
  const progressRef = useRef<HTMLDivElement | null>(null);
  const progressFrame = useRef(0);
  const trackProgress = useCallback(() => {
    if (progressFrame.current) return;
    progressFrame.current = requestAnimationFrame(() => {
      progressFrame.current = 0;
      const panel = readerPanelRef.current; const bar = progressRef.current;
      if (!panel || !bar) return;
      const room = panel.scrollHeight - panel.clientHeight;
      bar.style.transform = `scaleX(${room > 8 ? Math.min(1, panel.scrollTop / room) : 0})`;
    });
  }, []);
  useEffect(() => { trackProgress(); }, [activeArticle?.id, libraryLoaded, trackProgress]);
  const deepseekConnected = aiConnected;
  // Side-by-side translation of every paragraph.
  const [bilingual, setBilingual] = useState(false);
  const [paraTranslations, setParaTranslations] = useState<Record<string, { text?: string; error?: string }>>({});
  const paraInflight = useRef(new Set<string>());
  const [panelWidth, setPanelWidth] = useState(0);
  const paragraphs = useMemo(() => articleParts.body.split(/\n{2,}/), [articleParts.body]);
  const paraKey = (articleId: number, text: string) => `${articleId}\u0000${text}`;
  useEffect(() => { try { if (localStorage.getItem("gist-bilingual") === "1") queueMicrotask(() => setBilingual(true)); } catch { /* Device preference only. */ } }, []);
  useEffect(() => {
    const panel = readerPanelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => setPanelWidth(panel.clientWidth));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [libraryLoaded]);
  const toggleBilingual = useCallback((force?: boolean) => {
    setBilingual((current) => {
      const next = force ?? !current;
      try { localStorage.setItem("gist-bilingual", next ? "1" : "0"); } catch { /* Device preference only. */ }
      return next;
    });
  }, []);
  const translateParagraph = useCallback(async (articleId: number, index: number, text: string, previous: string) => {
    const key = paraKey(articleId, text);
    if (paraInflight.current.has(key)) return;
    paraInflight.current.add(key);
    setParaTranslations((current) => { const next = { ...current }; delete next[key]; return next; });
    try {
      const response = await fetch("/api/translate/paragraph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ articleId, text, previous }) });
      const data = await response.json() as { translation?: string; error?: string };
      setParaTranslations((current) => ({ ...current, [key]: response.ok && data.translation ? { text: data.translation } : { error: data.error || "翻译失败" } }));
    } catch {
      setParaTranslations((current) => ({ ...current, [key]: { error: "网络出错" } }));
    } finally {
      paraInflight.current.delete(key);
    }
    void index;
  }, []);
  useEffect(() => {
    if (!bilingual || !libraryLoaded || !activeArticle || !aiConnected) return;
    const articleId = activeArticle.id;
    const pending = paragraphs.map((text, index) => ({ text, index })).filter(({ text }) => text.trim() && !paraTranslations[paraKey(articleId, text)] && !paraInflight.current.has(paraKey(articleId, text)));
    if (!pending.length) return;
    let cancelled = false;
    // Three at a time, top to bottom, so the first screen fills in first.
    const queue = [...pending];
    const worker = async () => {
      while (!cancelled && queue.length) {
        const item = queue.shift()!;
        await translateParagraph(articleId, item.index, item.text, paragraphs[item.index - 1] || "");
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { cancelled = true; };
    // paraTranslations is read only to skip finished paragraphs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bilingual, libraryLoaded, activeArticle?.id, aiConnected, paragraphs, translateParagraph]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "t" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (tab !== "read") return;
      toggleBilingual();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, toggleBilingual]);
  const readingMeasure = Math.round(Math.min(860, Math.max(560, readingSettings.fontSize * 34)));
  const sideWidth = Math.min(460, panelWidth - 56 - readingMeasure - 56);
  const sideBySide = bilingual && sideWidth >= 280;
  const formProvider = providerFor(formEndpoint);
  const formIsCustom = formProvider.id === "custom";
  const keyNeeded = !aiConnected || aiShared || formEndpoint !== aiEndpoint;
  const wordColumns = Array.from({ length: wordColumnCount }, () => [] as SavedWord[]);
  filteredWords.forEach((word, index) => wordColumns[index % wordColumnCount].push(word));
  const expandedIndex = filteredWords.findIndex((word) => word.id === expandedWordId);
  const expandedColumn = expandedIndex < 0 ? -1 : expandedIndex % wordColumnCount;
  // Opened cards float their details over the grid, so the columns never change width.
  const wordColumnWidths = `repeat(${wordColumnCount}, minmax(0, 1fr))`;

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
      // v2 introduced Newsreader as the default face; an older saved choice keeps its size and spacing only.
      const current = JSON.parse(localStorage.getItem(READING_SETTINGS_KEY) || "null") as Partial<ReadingSettings> | null;
      const legacy = current ? null : JSON.parse(localStorage.getItem("lexitrace-reading-settings") || "null") as Partial<ReadingSettings> | null;
      const saved = current ?? (legacy ? { ...legacy, fontFamily: undefined } : null);
      if (saved) queueMicrotask(() => setReadingSettings({
        fontSize: typeof saved.fontSize === "number" ? Math.min(32, Math.max(14, saved.fontSize)) : 20,
        lineHeight: typeof saved.lineHeight === "number" ? Math.min(2.6, Math.max(1.3, saved.lineHeight)) : defaultReadingSettings.lineHeight,
        fontFamily: saved.fontFamily && saved.fontFamily in READING_FONTS ? saved.fontFamily : "newsreader",
        letterSpacing: typeof saved.letterSpacing === "number" ? Math.min(2, Math.max(0, saved.letterSpacing)) : 0,
      }));
    } catch { /* Ignore invalid device-local preferences. */ }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { setSelectedWordIds(null); setPinnedWordId(null); setExpandedWordId(null); setRevealedWordIds([]); setWallOpen(false); });
  }, [tab]);

  useEffect(() => {
    try { if (localStorage.getItem("gist-kaoyan-highlight") === "off") queueMicrotask(() => setKaoyanOn(false)); } catch { /* Device preference only. */ }
  }, []);

  useEffect(() => {
    try { if (localStorage.getItem("gist-mark-mode") === "on") queueMicrotask(() => setMarkMode(true)); } catch { /* Device preference only. */ }
  }, []);

  async function markReviewed(id: number, grade: "again" | "good") {
    const response = await fetch("/api/library", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "review", id, grade }) });
    if (!response.ok) return;
    const data = await json<{ reviewedAt: string; reviewCount: number; srsStability: number; srsDifficulty: number }>(response);
    setWords((items) => items.map((item) => item.id === id ? { ...item, ...data } : item));
  }

  useEffect(() => {
    if (document.documentElement.dataset.theme === "light") queueMicrotask(() => setTheme("light"));
  }, []);

  // Remember where the last tap landed so the theme change can grow out of it.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const remember = (event: PointerEvent) => { lastPointerRef.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener("pointerdown", remember, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", remember, { capture: true });
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    document.cookie = `gist_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduce) {
      root.classList.add("theme-fade");
      root.dataset.theme = next;
      setTheme(next);
      window.setTimeout(() => root.classList.remove("theme-fade"), 420);
      return;
    }
    const { x, y } = lastPointerRef.current ?? { x: window.innerWidth - 40, y: 28 };
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => { root.dataset.theme = next; flushSync(() => setTheme(next)); });
    void transition.ready.then(() => {
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 620, easing: "cubic-bezier(.65,0,.35,1)", pseudoElement: "::view-transition-new(root)" });
    }).catch(() => undefined);
  }

  // Stable handlers for the word cards, so a hover or a toggle only re-renders the cards that changed.
  const wordActionsRef = useRef<WordActions | null>(null);
  useLayoutEffect(() => {
    wordActionsRef.current = {
      hoverStart: (id) => { if (!translationsHidden && (pinnedWordId === null || pinnedWordId === id)) setExpandedWordId(id); },
      hoverEnd: (id) => { if (pinnedWordId !== id) setExpandedWordId((current) => current === id ? null : current); },
      toggle: (id) => {
        if (translationsHidden) { setRevealedWordIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); return; }
        const next = pinnedWordId === id ? null : id;
        setPinnedWordId(next);
        setExpandedWordId(next);
      },
      moveFirst: (id) => void moveWordFirst(id),
      dismiss: () => { setPinnedWordId(null); setExpandedWordId(null); },
      enrich: (id, again) => void enrichWord(id, again),
      sync: (id) => void syncWords([id]),
      remove: (id) => void removeItem("word", id),
    };
  });
  const wordActions = useMemo<WordActions>(() => ({
    hoverStart: (id) => wordActionsRef.current?.hoverStart(id),
    hoverEnd: (id) => wordActionsRef.current?.hoverEnd(id),
    toggle: (id) => wordActionsRef.current?.toggle(id),
    moveFirst: (id) => wordActionsRef.current?.moveFirst(id),
    dismiss: () => wordActionsRef.current?.dismiss(),
    enrich: (id, again) => wordActionsRef.current?.enrich(id, again),
    sync: (id) => wordActionsRef.current?.sync(id),
    remove: (id) => wordActionsRef.current?.remove(id),
  }), []);

  function toggleMarkMode() {
    const next = !markMode;
    setMarkMode(next);
    try { localStorage.setItem("gist-mark-mode", next ? "on" : "off"); } catch { /* Device preference only. */ }
    if (next) setSelection(null);
    toast(next ? "标记模式" : "查词模式", { duration: 1200 });
  }

  function toggleKaoyan() {
    setKaoyanOn((on) => {
      try { localStorage.setItem("gist-kaoyan-highlight", on ? "off" : "on"); } catch { /* Device preference only. */ }
      return !on;
    });
  }

  function updateReadingSettings(next: ReadingSettings) {
    setReadingSettings(next);
    try { localStorage.setItem(READING_SETTINGS_KEY, JSON.stringify(next)); } catch { /* Device preference only. */ }
  }

  useEffect(() => {
    fetch("/api/library").then((response) => { if (response.status === 401) { window.location.href = "/login?next=/"; } return response; }).then((response) => response.ok ? json<{ articles?: Article[]; words?: SavedWord[]; sentences?: SavedSentence[] }>(response) : Promise.reject()).then((data) => {
      const loadedArticles = Array.isArray(data.articles) ? data.articles : [];
      if (loadedArticles.length) { setArticles(loadedArticles); setActiveArticleId(loadedArticles[0].id); }
      setWords(Array.isArray(data.words) ? data.words : []); setSentences(Array.isArray(data.sentences) ? data.sentences : []);
    }).catch(() => undefined).finally(() => setLibraryLoaded(true));
    fetch("/api/maimemo/connection").then((response) => response.ok ? json<{ connected: boolean }>(response) : Promise.reject()).then((data) => setMaimemoConnected(Boolean(data.connected))).catch(() => undefined);
    fetch("/api/ai/connection").then((response) => response.ok ? json<{ connected: boolean; shared?: boolean; endpoint?: string; model?: string; thinkingMode?: string }>(response) : Promise.reject()).then((data) => { setAiConnected(Boolean(data.connected)); setAiShared(Boolean(data.shared)); if (data.endpoint) { setAiEndpoint(data.endpoint); setFormEndpoint(data.endpoint); } if (data.model) { setAiModel(data.model); setFormModel(data.model); } if (data.thinkingMode === "enabled") setAiThinkingMode("enabled"); }).catch(() => undefined);
  }, []);

  async function requestTranslation(text: string, type: SelectionKind, context: string, articleId: number) {
    const response = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, type, context, articleId, mode: translationMode }) });
    const data = await json<{ translation?: string; error?: string; phrase?: string; phraseTranslation?: string }>(response);
    if (!response.ok) throw new Error(data.error || "实时翻译失败");
    return { translation: data.translation || "", phrase: data.phrase && data.phraseTranslation ? { text: data.phrase, translation: data.phraseTranslation } : undefined };
  }

  async function translateSelection(text: string, type: SelectionKind, context: string) {
    const requestId = ++translationRequestRef.current;
    setSelection({ text, type, context, translation: "", loading: true });
    try {
      if (!activeArticle || activeArticle.id < 1) throw new Error("请先添加自己的文章");
      const { translation, phrase } = await requestTranslation(text, type, context, activeArticle.id);
      if (translationRequestRef.current === requestId) setSelection({ text, type, context, translation: translation || "暂时没有获取到翻译", loading: false, error: !translation, phrase });
    } catch (error) {
      const message = error instanceof Error ? error.message : "翻译暂时不可用";
      if (translationRequestRef.current === requestId) setSelection({ text, type, context, translation: message, loading: false, error: true });
      if (/API Key|连接 AI|余额|模型/.test(message)) openSettings("deepseek");
    }
  }

  const closeSelection = useCallback(() => {
    translationRequestRef.current += 1;
    setSelection(null);
  }, []);

  // Dismiss the sheet on a tap outside it, but not when the reader scrolls or long-presses to select again.
  useEffect(() => {
    if (!selection) return;
    let start: { x: number; y: number; t: number } | null = null;
    const down = (event: PointerEvent) => {
      start = translationFloatRef.current?.contains(event.target as Node) ? null : { x: event.clientX, y: event.clientY, t: performance.now() };
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      const held = performance.now() - start.t;
      start = null;
      if (moved < 10 && held < 450 && !window.getSelection()?.toString().trim()) closeSelection();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("pointerup", up); };
  }, [selection, closeSelection]);

  function isAlreadySaved(text: string, type: SelectionKind) {
    if (type === "sentence") return sentences.some((item) => item.text.replace(/\s+/g, " ").trim() === text);
    if (type === "phrase") return savedWordSet.has(text.replace(/[’]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase());
    return englishLemmaCandidates(text).some((candidate) => savedWordSet.has(candidate));
  }

  // Keep the selected line visible above the sheet.
  function keepAboveSheet(rect: DOMRect, type: SelectionKind) {
    const panel = readerPanelRef.current;
    if (!panel || rect.height === 0) return;
    const limit = window.innerHeight - (type === "sentence" ? 250 : 170);
    if (rect.bottom > limit) window.setTimeout(() => panel.scrollBy({ top: rect.bottom - limit, behavior: "smooth" }), 60);
  }

  async function markSelection(text: string, type: SelectionKind, context: string) {
    const article = activeArticle;
    if (!article || article.id < 1) { toast.error("请先添加自己的文章"); return; }
    if (isAlreadySaved(text, type)) { toast(type === "sentence" ? "句子本里已经有了" : "已经收藏过了", { duration: 1400 }); return; }
    const tempId = tempIdRef.current--;
    const createdAt = "";
    const state = { cancelled: false, id: 0 };
    const drop = () => {
      if (type === "sentence") setSentences((items) => items.filter((item) => item.id !== tempId && item.id !== state.id));
      else setWords((items) => items.filter((item) => item.id !== tempId && item.id !== state.id));
    };
    if (type === "sentence") setSentences((items) => [{ id: tempId, articleId: article.id, text, translation: "", articleTitle: article.title, createdAt }, ...items]);
    else setWords((items) => [{ id: tempId, articleId: article.id, text: text.toLowerCase(), translation: "", context, articleTitle: article.title, createdAt }, ...items]);
    const shown = text.length > 28 ? `${text.slice(0, 26)}…` : text;
    toast(`已标记 ${shown}`, {
      duration: 2600,
      action: { label: "撤销", onClick: () => {
        state.cancelled = true;
        drop();
        if (state.id) void fetch(`/api/library?kind=${type === "sentence" ? "sentence" : "word"}&id=${state.id}`, { method: "DELETE" });
      } },
    });
    try {
      const { translation } = await requestTranslation(text, type, context, article.id);
      if (!translation) throw new Error("暂时没有获取到翻译");
      if (state.cancelled) return;
      const response = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-selection", text, type, context, translation, articleId: article.id, articleTitle: article.title }) });
      const data = await json<{ error?: string; item: SavedWord | SavedSentence }>(response);
      if (!response.ok) throw new Error(data.error || "保存失败");
      state.id = data.item.id;
      if (state.cancelled) { void fetch(`/api/library?kind=${type === "sentence" ? "sentence" : "word"}&id=${state.id}`, { method: "DELETE" }); return; }
      if (type === "sentence") { const item = data.item as SavedSentence; setSentences((items) => [item, ...items.filter((x) => x.id !== tempId && x.id !== item.id)]); }
      else { const item = data.item as SavedWord; setWords((items) => [item, ...items.filter((x) => x.id !== tempId && x.id !== item.id)]); if (aiConnected) void enrichWord(item.id); }
    } catch (error) {
      drop();
      const message = error instanceof Error ? error.message : "标记失败";
      toast.error(`没有标记上：${message}`);
      if (/API Key|连接 AI|余额|模型/.test(message)) openSettings("deepseek");
    }
  }

  function handleSelection() {
    const current = window.getSelection();
    // The drop cap is a separate float, so browsers may stop a selection at its edge: widen it to the whole first word.
    if (current && current.rangeCount) {
      const capWord = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest(".drop-cap")?.parentElement ?? null;
      const range = current.getRangeAt(0);
      const startWord = capWord(range.startContainer);
      const endWord = capWord(range.endContainer);
      if (startWord || endWord) {
        const widened = range.cloneRange();
        if (startWord) widened.setStartBefore(startWord);
        if (endWord) widened.setEndAfter(endWord);
        current.removeAllRanges();
        current.addRange(widened);
      }
    }
    const selected = current?.toString().trim().replace(/\s+/g, " ") || "";
    if (!selected || selected.length > 700) return;
    if (current?.anchorNode && articleBodyRef.current && !articleBodyRef.current.contains(current.anchorNode)) return;
    if (current?.anchorNode && (current.anchorNode.nodeType === 1 ? current.anchorNode as Element : current.anchorNode.parentElement)?.closest(".para-zh")) return;
    const now = Date.now();
    if (lastPickRef.current.text === selected && now - lastPickRef.current.at < 900) { current?.removeAllRanges(); return; }
    lastPickRef.current = { text: selected, at: now };
    const core = selected.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    const wordCount = core.split(" ").filter(Boolean).length;
    // One word goes to the word book; 2–4 plain words (e.g. "take over", "on the contrary") are a phrase, which also goes to the word book; anything longer is a sentence.
    const type: SelectionKind = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(selected) ? "word" : wordCount >= 2 && wordCount <= 4 && /^[A-Za-z'’ -]+$/.test(core) ? "phrase" : "sentence";
    const fullText = activeArticle.content.replace(/\s+/g, " ");
    const at = fullText.indexOf(selected);
    const context = at >= 0 ? fullText.slice(Math.max(0, at - 90), Math.min(fullText.length, at + selected.length + 90)) : selected;
    const rect = current && current.rangeCount ? current.getRangeAt(0).getBoundingClientRect() : null;
    current?.removeAllRanges();
    if (markMode) { void markSelection(selected, type, context); return; }
    void translateSelection(selected, type, context);
    if (rect) keepAboveSheet(rect, type);
  }
  const handleSelectionRef = useRef(handleSelection);
  useEffect(() => { handleSelectionRef.current = handleSelection; });

  // Touch screens: wait until the finger is lifted and the selection has settled, so the handles can still be dragged.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let timer = 0;
    let touching = false;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (!touching) handleSelectionRef.current(); }, 520); };
    const hasSelection = () => { const current = window.getSelection(); return Boolean(current && !current.isCollapsed && articleBodyRef.current?.contains(current.anchorNode)); };
    const onChange = () => { if (hasSelection() && !touching) schedule(); };
    const onStart = () => { touching = true; window.clearTimeout(timer); };
    const onEnd = () => { touching = false; if (hasSelection()) schedule(); };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  async function saveSelection() {
    if (!selection || !activeArticle) return;
    setSaving(true);
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-selection", ...selection, articleId: activeArticle.id, articleTitle: activeArticle.title }) });
      const data = await json<{ error?: string; item: SavedWord | SavedSentence }>(response);
      if (!response.ok) throw new Error(data.error);
      if (selection.type !== "sentence") { const item = data.item as SavedWord; setWords((items) => [item, ...items.filter((x) => x.id !== item.id)]); if (selection.type === "word" && item.text.toLowerCase() !== selection.text.toLowerCase()) toast(`已还原为 ${item.text}`, { duration: 1800 }); if (aiConnected) void enrichWord(item.id); }
      else { const item = data.item as SavedSentence; setSentences((items) => [item, ...items.filter((x) => x.id !== item.id)]); }
      const savedText = selection.text;
      setSelection((current) => current && current.text === savedText ? { ...current, saved: true } : current);
      window.setTimeout(() => setSelection((current) => current?.saved && current.text === savedText ? null : current), 900);
    } catch { toast.error("保存失败，请稍后重试"); } finally { setSaving(false); }
  }

  async function importFile(file: File) {
    const name = file.name.toLowerCase();
    const kind = name.endsWith(".pdf") ? "pdf" : name.endsWith(".docx") ? "docx" : name.endsWith(".txt") ? "txt" : "";
    if (!kind) { toast.error("支持 PDF、DOCX 和 TXT 文件"); return; }
    setReadingFile(true);
    try {
      if (kind === "pdf") {
        const { extractPdf } = await import("@/lib/pdf-extract");
        const pdf = await extractPdf(file);
        if (pdf.words < 30) throw new Error("PDF 里几乎没有英文正文，可能是扫描图片");
        setDraftTitle(pdf.title); setDraftText(pdf.content);
        setDraftPublisher(pdf.publisher); setDraftDate(pdf.publishedDate); setDraftUrl(pdf.sourceUrl);
        toast.success(`已读取 PDF · ${pdf.pages} 页 · ${pdf.words.toLocaleString("en-US")} 词，检查一下再开始阅读`);
        return;
      }
      setDraftTitle(file.name.replace(/\.(txt|docx)$/i, ""));
      if (kind === "docx") {
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        setDraftText(result.value.trim());
      } else setDraftText(await file.text());
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "文件读取失败");
    } finally { setReadingFile(false); }
  }

  function openPicked(article: Article, added: boolean) {
    if (added) setArticles((items) => [article, ...items.filter((item) => item.id !== 0 && item.id !== article.id)]);
    setActiveArticleId(article.id); setTab("read");
    if (added) toast.success("已加入文章库");
  }

  function openSettings(section: "deepseek" | "maimemo") {
    setSettingsOpen(true);
    setTimeout(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
  }

  async function addArticle() {
    if (!draftTitle.trim() || !draftText.trim()) { toast.error("请填写标题和文章内容"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-article", title: draftTitle, shortTitle: draftShort, content: draftText, publisher: draftPublisher, publishedDate: draftDate, sourceUrl: draftUrl }) });
      const data = await json<{ error?: string; article: Article }>(response);
      if (!response.ok) throw new Error(data.error);
      setArticles((items) => [data.article, ...items.filter((item) => item.id !== 0)]); setActiveArticleId(data.article.id);
      setDraftTitle(""); setDraftText(""); setDraftShort(""); setDraftPublisher(""); setDraftDate(""); setDraftUrl(""); setUploadOpen(false); setTab("read");
      if (!deepseekConnected) { toast.success("文章已保存，请先在设置里连接 AI 模型"); openSettings("deepseek"); }
      else toast.success("文章已保存，划词或划句时会实时翻译");
    } catch { toast.error("文章保存失败，请稍后重试"); } finally { setSaving(false); }
  }

  // Paste a link → the server reads the page, keeps the article text and files it in the library.
  async function importFromUrl() {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true); setImportError("");
    try {
      const response = await fetch("/api/import-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await json<{ error?: string; article?: Article; duplicate?: boolean; words?: number }>(response);
      if (!response.ok || !data.article) throw new Error(data.error || "导入失败，请稍后再试");
      const article = data.article;
      setArticles((items) => [article, ...items.filter((item) => item.id !== 0 && item.id !== article.id)]); setActiveArticleId(article.id);
      setImportUrl(""); setUploadOpen(false); setTab("read");
      toast.success(data.duplicate ? "这篇已经在文章库里了，已为你打开" : `已导入 · ${(data.words ?? 0).toLocaleString("en-US")} 词`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败，请稍后再试");
    } finally { setImporting(false); }
  }

  // Re-translate every single word in the word book, 20 at a time, so each keeps only its own meaning.
  async function retranslateAllWords() {
    const ids = words.filter((word) => !word.text.includes(" ")).map((word) => word.id);
    if (!ids.length) return;
    setRetranslate({ running: true, done: 0, total: ids.length, failed: 0, finished: false });
    let done = 0; let failed = 0;
    for (let at = 0; at < ids.length; at += 20) {
      const chunk = ids.slice(at, at + 20);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const response = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retranslate-words", ids: chunk }) });
          const data = await json<{ updated?: Array<{ id: number; translation: string }>; error?: string }>(response);
          if (!response.ok) throw new Error(data.error || "翻译失败");
          const map = new Map((data.updated ?? []).map((item) => [item.id, item.translation]));
          setWords((items) => items.map((item) => map.has(item.id) ? { ...item, translation: map.get(item.id)! } : item));
          ok = true;
        } catch (error) {
          if (attempt === 1) { failed += chunk.length; if (error instanceof Error && /API Key|连接 AI|余额/.test(error.message)) { toast.error(error.message); setRetranslate({ running: false, done, total: ids.length, failed: ids.length - done, finished: true }); return; } }
        }
      }
      done += chunk.length;
      setRetranslate({ running: true, done, total: ids.length, failed, finished: false });
    }
    setRetranslate({ running: false, done, total: ids.length, failed, finished: true });
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
    if (!formEndpoint.trim()) return toast.error("请填写接口地址");
    if (!formModel.trim()) return toast.error("请填写模型名称");
    if (keyNeeded && !aiApiKey.trim()) return toast.error(`请填写${formIsCustom ? "" : ` ${formProvider.name} 的`} API Key`);
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai/connection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: formEndpoint.trim(), model: formModel.trim(), apiKey: aiApiKey, thinkingMode: formProvider.thinking ? aiThinkingMode : "disabled" }) });
      const data = await json<{ error?: string; endpoint?: string; model?: string }>(response);
      if (!response.ok) throw new Error(data.error || "保存 AI 连接失败");
      setAiConnected(true); setAiShared(false); setAiEndpoint(data.endpoint || aiEndpoint); setAiModel(data.model || aiModel); setAiApiKey("");
      if (!formProvider.thinking) setAiThinkingMode("disabled");
      toast.success(`${formIsCustom ? "模型" : formProvider.name} · ${data.model || formModel} 已连接`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存 AI 连接失败"); }
    finally { setAiLoading(false); }
  }

  function chooseProvider(id: string) {
    const next = AI_PROVIDERS.find((item) => item.id === id) ?? AI_PROVIDERS[0];
    setFormEndpoint(next.id === "custom" ? (providerFor(aiEndpoint).id === "custom" ? aiEndpoint : "") : next.endpoint);
    setFormModel(next.id === "custom" ? (providerFor(aiEndpoint).id === "custom" ? aiModel : "") : next.endpoint === aiEndpoint ? aiModel : next.models[0]);
    setModelList([]);
  }

  async function loadModels() {
    if (!formEndpoint.trim()) return toast.error("请先填写接口地址");
    setModelsLoading(true);
    try {
      const response = await fetch("/api/ai/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: formEndpoint.trim(), apiKey: aiApiKey }) });
      const data = await json<{ models?: string[]; error?: string }>(response);
      if (!response.ok || !data.models) throw new Error(data.error || "获取模型列表失败");
      setModelList(data.models);
      toast.success(data.models.length ? `找到 ${data.models.length} 个模型，点模型框选择` : "这个接口没有列出模型，请手动填写");
    } catch (error) { toast.error(error instanceof Error ? error.message : "获取模型列表失败"); }
    finally { setModelsLoading(false); }
  }

  async function disconnectAi() {
    setAiLoading(true);
    try {
      const response = await fetch("/api/ai/connection", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setAiApiKey("");
      // Falls back to the shared key from /admin when there is one.
      const state = await fetch("/api/ai/connection").then((result) => result.ok ? json<{ connected?: boolean; shared?: boolean; thinkingMode?: string }>(result) : null).catch(() => null);
      setAiConnected(Boolean(state?.connected)); setAiShared(Boolean(state?.shared)); setAiEndpoint("https://api.deepseek.com/chat/completions"); setAiModel("deepseek-flash"); setFormEndpoint("https://api.deepseek.com/chat/completions"); setFormModel("deepseek-flash"); setModelList([]);
      if (state?.shared) setAiThinkingMode("disabled");
      toast.success(state?.shared ? "已断开你自己的 Key，改用共享 Key" : "已断开 AI 接口，已生成的词汇联想仍会保留");
    } catch { toast.error("断开 AI 接口失败"); }
    finally { setAiLoading(false); }
  }

  async function enrichWord(id: number, refresh = false) {
    if (!deepseekConnected) { openSettings("deepseek"); toast.info("请先在设置里连接 AI 模型"); return false; }
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
    if (!deepseekConnected) { openSettings("deepseek"); toast.info("请先在设置里连接 AI 模型"); return; }
    const batch = bookItems.filter((word) => !word.similarJson && !enrichingIds.includes(word.id)).slice(0, 10);
    if (!batch.length) return toast.info(`所有${unit}都已生成联想`);
    let completed = 0;
    for (const word of batch) if (await enrichWord(word.id)) completed += 1;
    if (completed) toast.success(`已生成 ${completed} 个${unit}的联想`);
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
    if (!maimemoConnected) { openSettings("maimemo"); toast.info("请先连接墨墨背单词"); return; }
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

  const wordBookView = (
          <>
            <LibraryHeader
              title={isPhraseBook ? "词组本" : "单词本"}
              subtitle={undefined}
              query={query}
              setQuery={setQuery}
              count={bookItems.length}
              action={selectedWordIds === null ? (
                <>
                    <Button variant="outline" size="icon" className="rounded-xl" disabled={!filteredWords.some((word) => !word.text.includes(" ") && englishLemmaCandidates(word.text).some((candidate) => kaoyanVocab.has(candidate)))} onClick={() => setWallOpen(true)} aria-label="翻卡（考研词）" title="翻卡（考研词）"><Shuffle className="size-4" /></Button>
                    <Button variant="outline" size="icon" className="rounded-xl" aria-pressed={translationsHidden} onClick={() => { setTranslationsHidden((hidden) => !hidden); setRevealedWordIds([]); setPinnedWordId(null); setExpandedWordId(null); }} aria-label={translationsHidden ? "显示释义" : "隐藏释义"} title={translationsHidden ? "显示释义" : "隐藏释义"}>{translationsHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</Button>
                    <Button variant="outline" size="icon" className="rounded-xl" disabled={!bookItems.some((word) => !word.similarJson) || enrichingIds.length > 0} onClick={() => void enrichMissingWords()} aria-label="生成联想" title="生成联想">{enrichingIds.length > 0 ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}</Button>
                    {!isPhraseBook && <Button variant="outline" size="icon" className="rounded-xl" disabled={!words.some((word) => !word.text.includes(" ")) || retranslate.running} onClick={() => { if (!retranslate.running) setRetranslate((current) => ({ ...current, finished: false, done: 0, failed: 0 })); setRetranslateOpen(true); }} aria-label="重新翻译释义" title="重新翻译释义">{retranslate.running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button>}
                    {!isPhraseBook && <Button variant="outline" size="icon" className="rounded-xl" disabled={!words.some((word) => word.syncStatus !== "synced" && !word.text.includes(" ")) || syncingIds.length > 0} onClick={() => void syncWords(words.filter((word) => word.syncStatus !== "synced" && !word.text.includes(" ")).map((word) => word.id))} aria-label="同步墨墨" title="同步墨墨">{syncingIds.length > 0 ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}</Button>}
                  <Button variant="outline" size="icon" className="rounded-xl" disabled={!filteredWords.length} onClick={startWordSelection} aria-label="批量删除" title="批量删除"><Trash2 className="size-4" /></Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground" role="status">{selectedWordIds.size}</span>
                  <Button variant="outline" className="rounded-xl" disabled={deletingWords || !filteredWords.length} onClick={() => setSelectedWordIds(new Set(allFilteredWordsSelected ? [] : filteredWords.map((word) => word.id)))}>
                    {allFilteredWordsSelected ? "取消全选" : "全选"}
                  </Button>
                  <Button variant="outline" className="rounded-xl" disabled={deletingWords} onClick={() => setSelectedWordIds(null)}>取消</Button>
                  <AlertDialog open={confirmWordDeletion} onOpenChange={(open) => { if (!deletingWords) setConfirmWordDeletion(open); }}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="rounded-xl text-destructive" disabled={!selectedWordIds.size || deletingWords}><Trash2 className="size-4" />删除</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onEscapeKeyDown={(event) => { if (deletingWords) event.preventDefault(); }}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除选中的 {selectedWordIds.size} 个{unit}？</AlertDialogTitle>
                        <AlertDialogDescription>删除后无法撤销。</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deletingWords}>取消</AlertDialogCancel>
                        <Button className="bg-destructive text-background hover:bg-destructive/85" disabled={!selectedWordIds.size || deletingWords} onClick={() => void deleteSelectedWords()}>
                          {deletingWords ? <><Loader2 className="size-4 animate-spin" />正在删除</> : "确认删除"}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            />
            {!libraryLoaded ? <div className="skeleton-words" role="status" aria-label="正在加载">{Array.from({ length: 15 }, (_, index) => <div className="sk-word" key={index}><span className="sk" style={{ width: `${50 + (index * 37) % 40}%` }} /><span className="sk short" style={{ width: `${30 + (index * 23) % 35}%` }} /></div>)}</div> : filteredWords.length ? <div ref={setWordGridElement} className={`word-grid ${expandedColumn >= 0 ? "has-expanded" : ""} ${translationsHidden ? "translations-hidden" : ""}`} style={{ gridTemplateColumns: wordColumnWidths }}>
            {wordColumns.map((column, columnIndex) => <div className="word-column" key={columnIndex}>{column.map((word) => selectedWordIds === null ? <SavedWordCard key={word.id} word={word} open={expandedWordId === word.id} translationVisible={!translationsHidden || revealedWordIds.includes(word.id)} aiConnected={deepseekConnected} enriching={enrichingIds.includes(word.id)} syncing={syncingIds.includes(word.id)} actions={wordActions} /> : (
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
            </div> : <EmptyLibrary icon={isPhraseBook ? <Layers /> : <Bookmark />} text={bookItems.length ? "没有结果" : `还没有${unit}`} setTab={setTab} />}
          </>
  );

  return (
    <main className="app-shell">
      <Toaster position="top-center" theme={theme} />
      <Dialog open={retranslateOpen} onOpenChange={(open) => { if (!retranslate.running) setRetranslateOpen(open); }}>
        <DialogContent className="retranslate-dialog sm:max-w-[440px]">
          <DialogHeader><DialogTitle>重新翻译单词本</DialogTitle>
            <DialogDescription>按收藏时所在的句子，重新给每个单词写释义：只写这个词本身的意思，不再写它所在搭配的意思（例如 equity 是「股权；股本」，不是「私募股权」）。词组本不变。</DialogDescription></DialogHeader>
          {retranslate.running || retranslate.finished ? (
            <div className="retranslate-progress" role="status">
              <div className="retranslate-bar"><span style={{ width: `${retranslate.total ? (retranslate.done / retranslate.total) * 100 : 0}%` }} /></div>
              <p>{retranslate.finished ? `完成：${retranslate.done - retranslate.failed} 个单词已更新${retranslate.failed ? `，${retranslate.failed} 个失败，可以再试一次` : ""}` : `正在翻译 ${retranslate.done} / ${retranslate.total}…`}</p>
              {retranslate.finished && <p className="retranslate-note">已经同步到墨墨的单词，墨墨里的释义不会跟着改。</p>}
            </div>
          ) : <p className="retranslate-note">共 {words.filter((word) => !word.text.includes(" ")).length} 个单词，每 20 个调用一次 AI，大约 {Math.ceil(words.filter((word) => !word.text.includes(" ")).length / 20)} 次。翻译期间可以继续使用。</p>}
          <div className="retranslate-actions">
            {retranslate.finished || retranslate.running
              ? <Button className="rounded-xl" disabled={retranslate.running} onClick={() => setRetranslateOpen(false)}>{retranslate.running ? <><Loader2 className="size-4 animate-spin" />翻译中</> : "完成"}</Button>
              : <><Button variant="ghost" className="rounded-xl" onClick={() => setRetranslateOpen(false)}>取消</Button><Button className="rounded-xl" onClick={() => void retranslateAllWords()}>开始翻译</Button></>}
          </div>
        </DialogContent>
      </Dialog>
      {wallOpen && <WordWall pool={filteredWords.filter((word) => !word.text.includes(" ") && englishLemmaCandidates(word.text).some((candidate) => kaoyanVocab.has(candidate))).map((word) => ({ id: word.id, text: word.text, translation: word.translation, reviewedAt: word.reviewedAt ?? null, stability: word.srsStability ?? null, difficulty: word.srsDifficulty ?? null }))} onReview={(id, grade) => void markReviewed(id, grade)} onClose={() => setWallOpen(false)} />}
      <Tabs value={tab} onValueChange={setTab} className="workspace">
        <header className="topbar">
          <TabsList className="reader-tabs" aria-label="页面导航">
            <TabsTrigger value="read" className="reader-tab" aria-label="阅读" title="阅读"><BookOpen /><span className="reader-tab-label">阅读</span></TabsTrigger>
            <TabsTrigger value="words" className="reader-tab" aria-label="单词本" title="单词本"><Bookmark /><span className="reader-tab-label">单词本</span><span className="reader-tab-count">{singleWords.length}</span></TabsTrigger>
            <TabsTrigger value="phrases" className="reader-tab" aria-label="词组本" title="词组本"><Layers /><span className="reader-tab-label">词组本</span><span className="reader-tab-count">{phrases.length}</span></TabsTrigger>
            <TabsTrigger value="sentences" className="reader-tab" aria-label="句子本" title="句子本"><Library /><span className="reader-tab-label">句子本</span><span className="reader-tab-count">{sentences.length}</span></TabsTrigger>
            <TabsTrigger value="stats" className="reader-tab" aria-label="统计" title="阅读统计"><BarChart3 /><span className="reader-tab-label">统计</span></TabsTrigger>
          </TabsList>
          <div className="topbar-actions">
            <Button variant="ghost" className="rounded-xl mode-toggle" aria-pressed={markMode} onClick={toggleMarkMode} aria-label={markMode ? "标记模式：划词直接收藏，点击切换到查词模式" : "查词模式：划词显示释义，点击切换到标记模式"} title={markMode ? "标记模式" : "查词模式"}><span className="mode-icon" key={markMode ? "mark" : "look"}>{markMode ? <BookmarkPlus className="size-4" /> : <Languages className="size-4" />}</span><span className="button-label">{markMode ? "标记" : "查词"}</span></Button>
            <Popover open={readingOpen} onOpenChange={setReadingOpen}><PopoverTrigger asChild><Button variant="ghost" className="rounded-xl" aria-label="阅读设置" title="阅读设置"><ALargeSmall className="size-[18px]" /></Button></PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="aa-panel">
                <div className="aa-row"><span>全文对照翻译</span><Switch checked={bilingual} onCheckedChange={(checked) => toggleBilingual(checked)} aria-label="全文对照翻译" /></div><div className="aa-row"><span>考研词标记</span><Switch checked={kaoyanOn} onCheckedChange={toggleKaoyan} aria-label="考研词标记" /></div>
                <div className="aa-row aa-theme-row"><span>黑夜模式</span><Switch checked={theme === "dark"} onCheckedChange={toggleTheme} aria-label="黑夜模式" /></div>
                <div className="reading-controls"><label>字号 <strong>{readingSettings.fontSize}px</strong><input type="range" min="14" max="32" step="1" value={readingSettings.fontSize} onChange={(event) => updateReadingSettings({ ...readingSettings, fontSize: Number(event.target.value) })} /></label>
                  <label>行距 <strong>{readingSettings.lineHeight.toFixed(2)}</strong><input type="range" min="1.3" max="2.6" step="0.05" value={readingSettings.lineHeight} onChange={(event) => updateReadingSettings({ ...readingSettings, lineHeight: Number(event.target.value) })} /></label>
                  <label>字距 <strong>{readingSettings.letterSpacing.toFixed(1)}px</strong><input type="range" min="0" max="2" step="0.1" value={readingSettings.letterSpacing} onChange={(event) => updateReadingSettings({ ...readingSettings, letterSpacing: Number(event.target.value) })} /></label>
                  <label>字体 <select value={readingSettings.fontFamily} onChange={(event) => updateReadingSettings({ ...readingSettings, fontFamily: event.target.value as ReadingSettings["fontFamily"] })}><option value="newsreader">Newsreader</option><option value="georgia">Georgia</option><option value="serif">系统衬线</option><option value="sans">无衬线</option></select></label>
                  <Button variant="ghost" className="aa-reset" onClick={() => updateReadingSettings(defaultReadingSettings)}>恢复默认</Button></div>
              </PopoverContent></Popover>
            <DailyPicks onOpen={openPicked} />
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogTrigger asChild><Button variant="ghost" className="rounded-xl" aria-label="添加文章" title="添加文章"><Plus className="size-4" /><span className="button-label">添加文章</span></Button></DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto rounded-xl sm:max-w-2xl"><DialogHeader><DialogTitle className="text-2xl">添加文章</DialogTitle><DialogDescription className="sr-only">输入网址导入，上传 PDF、DOCX、TXT，或粘贴正文</DialogDescription></DialogHeader>
                <form className="url-import" onSubmit={(event) => { event.preventDefault(); void importFromUrl(); }}>
                  <div className="url-import-row"><Link2 className="url-import-icon size-4" /><input type="url" inputMode="url" value={importUrl} onChange={(event) => { setImportUrl(event.target.value); setImportError(""); }} placeholder="粘贴文章网址，例如 https://www.theguardian.com/…" aria-label="文章网址" disabled={importing} />
                    <Button type="submit" className="h-9 rounded-lg" disabled={importing || !importUrl.trim()}>{importing ? <><Loader2 className="size-4 animate-spin" />读取中</> : "导入"}</Button></div>
                  {importError ? <p className="url-import-error" role="alert">{importError}</p> : <p className="url-import-hint">自动提取标题、正文和出处，去掉广告和推荐阅读</p>}
                </form>
                <div className="add-divider"><span>或者</span></div>
                <label className={`upload-zone${readingFile ? " is-busy" : ""}`}>{readingFile ? <Loader2 className="size-6 animate-spin text-foreground" /> : <Upload className="size-6 text-foreground" />}<span className="font-medium">{readingFile ? "正在读取…" : "PDF / DOCX / TXT"}</span><input className="sr-only" type="file" accept=".pdf,.docx,.txt,application/pdf" disabled={readingFile} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></label>
                <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="标题" className="h-11 rounded-xl" />
                <Input value={draftShort} onChange={(event) => setDraftShort([...event.target.value].slice(0, 5).join(""))} placeholder="简称（≤5 字，留空自动生成）" className="h-11 rounded-xl" />
                <div className="draft-source"><Input value={draftPublisher} onChange={(event) => setDraftPublisher(event.target.value)} placeholder="出处（可选，如 The Guardian）" className="h-11 rounded-xl" aria-label="出处" /><Input type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} className="h-11 rounded-xl" aria-label="发布日期" title="发布日期" /><Input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} placeholder="原文链接（可选）" className="h-11 rounded-xl" aria-label="原文链接" /></div>
                <Textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="粘贴正文" className="min-h-56 rounded-xl leading-7" />
                <Button className="h-11 rounded-xl" onClick={() => void addArticle()} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}开始阅读</Button>
              </DialogContent></Dialog>
            <Button variant="ghost" className="rounded-xl theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "切换到白天模式" : "切换到黑夜模式"} title={theme === "dark" ? "黑夜模式" : "白天模式"}><span className="mode-icon" key={theme}>{theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}</span></Button>
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogTrigger asChild><Button variant="ghost" className="relative rounded-xl" aria-label="设置" title="设置"><Settings className="size-4" /></Button></DialogTrigger>
              <DialogContent className="settings-dialog max-h-[88vh] overflow-y-auto rounded-xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">设置</DialogTitle><DialogDescription className="sr-only">AI 模型、墨墨背单词和账户</DialogDescription></DialogHeader>
                <section className="settings-section" id="settings-deepseek"><h3><Sparkles className="size-4" />AI 模型{aiConnected && <span className="settings-state">{aiShared ? "使用共享 Key" : `${providerFor(aiEndpoint).id === "custom" ? "" : `${providerFor(aiEndpoint).name} · `}${aiModel}`}</span>}</h3>
                {aiShared && <p className="security-note">现在用的是管理员共享的 DeepSeek Key，可以直接划词翻译。选好服务商、填入你自己的 Key 并保存后，就改用你自己的额度。</p>}
                <label className="ai-field">服务商<select className="ai-mode-select" value={formProvider.id} onChange={(event) => chooseProvider(event.target.value)}>{AI_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                {formIsCustom && <label className="ai-field">接口地址<Input value={formEndpoint} onChange={(event) => { setFormEndpoint(event.target.value); setModelList([]); }} placeholder="https://…/v1/chat/completions" autoComplete="off" spellCheck={false} className="mt-1 h-11 rounded-xl" /></label>}
                <label className="ai-field">模型<span className="ai-model-row"><Input list="ai-model-options" value={formModel} onChange={(event) => setFormModel(event.target.value)} placeholder="模型名称" autoComplete="off" spellCheck={false} className="h-11 rounded-xl" /><Button type="button" variant="outline" className="h-11 shrink-0 rounded-xl" disabled={modelsLoading} onClick={() => void loadModels()}>{modelsLoading && <Loader2 className="size-4 animate-spin" />}获取列表</Button></span>
                  <datalist id="ai-model-options">{[...new Set([...formProvider.models, ...modelList])].map((id) => <option key={id} value={id} />)}</datalist></label>
                {formProvider.thinking && !aiShared && <label className="ai-field">联想模式<select className="ai-mode-select" value={aiThinkingMode} onChange={(event) => setAiThinkingMode(event.target.value as "disabled" | "enabled")}><option value="disabled">快速</option><option value="enabled">深度思考</option></select></label>}
                {formProvider.keyUrl && keyNeeded && <a className="token-link" href={formProvider.keyUrl} target="_blank" rel="noreferrer">获取 {formProvider.name} API Key <ExternalLink className="size-4" /></a>}
                <label className="ai-field">API Key<Input type="password" autoComplete="off" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder={keyNeeded ? "粘贴 API Key" : "留空则不变"} className="mt-1 h-11 rounded-xl" /></label>
                <Button className="rounded-xl" disabled={aiLoading} onClick={() => void connectAi()}>{aiLoading && <Loader2 className="size-4 animate-spin" />}{aiLoading ? "测试连接中" : "保存"}</Button>
                {aiConnected && !aiShared && <Button variant="outline" className="rounded-xl text-destructive" disabled={aiLoading} onClick={() => void disconnectAi()}><Unlink className="size-4" />断开</Button>}
                </section>
                <section className="settings-section" id="settings-maimemo"><h3><Cloud className="size-4" />墨墨背单词{maimemoConnected && <span className="settings-state">已连接</span>}</h3>
                {!maimemoConnected && <><a className="token-link" href="https://open.maimemo.com/open/api/v1/tokens/openapi" target="_blank" rel="noreferrer">获取凭证 <ExternalLink className="size-4" /></a><Input type="password" autoComplete="off" value={maimemoToken} onChange={(event) => setMaimemoToken(event.target.value)} placeholder="粘贴凭证" className="h-12 rounded-xl" /><Button className="h-11 rounded-xl" onClick={() => void connectMaimemo()} disabled={maimemoLoading}>{maimemoLoading && <Loader2 className="size-4 animate-spin" />}连接</Button></>}
                {maimemoConnected && <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="rounded-xl text-destructive"><Unlink className="size-4" />断开</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>断开墨墨连接？</AlertDialogTitle><AlertDialogDescription>已同步的单词不受影响。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void disconnectMaimemo()}>断开</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
                </section>
                <AccountSection />
              </DialogContent></Dialog>
          </div>
        </header>

        <section className="content"><TabsContent value="read" className="h-full" forceMount hidden={tab !== "read"}><div className={`reader-layout${bilingual ? ` bilingual ${sideBySide ? "side" : "stacked"}` : ""}`} style={{ "--measure": `${readingMeasure}px`, "--tw": `${Math.max(280, sideWidth)}px` } as React.CSSProperties}><div className="read-progress" ref={progressRef} aria-hidden="true" /><article ref={readerPanelRef} className={`reader-panel${selection ? " has-sheet" : ""}`} onScroll={trackProgress}>{!libraryLoaded ? <div className="skeleton-reader" aria-label="正在加载" role="status"><span className="sk sk-chip" /><span className="sk sk-title" /><span className="sk sk-title short" />{[0, 1, 2].map((block) => <div className="sk-para" key={block}>{[92, 100, 96, 88, 64].map((width, line) => <span className="sk sk-line" style={{ width: `${width}%` }} key={line} />)}</div>)}</div> : <><div className="reader-heading"><div><div className="reader-meta-row"><p className="eyebrow">{activeArticle && activeArticle.id > 0 ? formatImportDate(activeArticle.createdAt, true) : "示例文章"}</p>{activeArticle && activeArticle.id > 0 && (editingShort !== null
    ? <input className="short-title-input" autoFocus value={editingShort} maxLength={8} placeholder="最多 5 个字" aria-label="文章简称" onChange={(event) => setEditingShort([...event.target.value].slice(0, 5).join(""))} onBlur={() => void saveShortTitle(activeArticle.id, editingShort)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditingShort(null); }} />
    : <button type="button" className="short-title-chip" title="点击修改简称" onClick={() => setEditingShort(activeArticle.shortTitle || "")}>{activeArticle.shortTitle || "添加简称"}</button>)}</div><h1>{activeArticle?.title}</h1>{readingLength.words > 0 && <div className="read-length-row"><p className="read-length"><span>{readingLength.words.toLocaleString("en-US")} 词</span><span>约 {readingLength.minutes} 分钟</span>{readingLength.kaoyan > 0 && kaoyanOn && <span>考研词 {readingLength.kaoyan}</span>}</p><button type="button" className="bilingual-toggle" aria-pressed={bilingual} onClick={() => { if (!bilingual && !aiConnected) { openSettings("deepseek"); toast.info("请先在设置里连接 AI 模型"); return; } toggleBilingual(); }} title="全文对照翻译（快捷键 T）"><Columns2 className="size-[15px]" /><span>{bilingual ? "关闭对照" : "全文对照"}</span></button></div>}{articleParts.source && <p className="article-source">{articleParts.source.publisher} · {articleParts.source.publishedDate}{articleParts.source.url && <> · <a href={articleParts.source.url} target="_blank" rel="noreferrer">原文</a></>}</p>}</div></div><div ref={articleBodyRef} className="article-body" style={{ fontSize: readingSettings.fontSize, lineHeight: readingSettings.lineHeight, letterSpacing: readingSettings.letterSpacing, fontFamily: READING_FONTS[readingSettings.fontFamily] }} onMouseUp={handleSelection}>{paragraphs.map((paragraph, index) => {
              const entry = bilingual && activeArticle ? paraTranslations[paraKey(activeArticle.id, paragraph)] : undefined;
              return <Fragment key={index}><AnnotatedParagraph text={paragraph} dropCap={index === 0} savedWords={savedWordSet} savedPhrases={savedPhraseTexts} savedSentences={savedSentenceTexts} vocab={kaoyanOn ? kaoyanVocab : null} />
                {bilingual && activeArticle && paragraph.trim() && <div className={`para-zh${entry?.error ? " is-error" : ""}${entry?.text ? " is-ready" : ""}`} lang="zh-CN" onMouseUp={(event) => event.stopPropagation()}>
                  {!aiConnected ? <span className="para-zh-note">连接 AI 模型后显示译文</span>
                    : entry?.text ? entry.text
                    : entry?.error ? <span className="para-zh-note">{entry.error}<button type="button" onClick={() => void translateParagraph(activeArticle.id, index, paragraph, paragraphs[index - 1] || "")}><RotateCw className="size-3" />重试</button></span>
                    : <span className="para-zh-loading" aria-label="正在翻译"><i /><i /><i /></span>}
                </div>}</Fragment>;
            })}</div></>}</article>
          <TranslationSheet sheetRef={translationFloatRef} selection={selection} saving={saving} alreadySaved={selection ? !selection.loading && !selection.saved && isAlreadySaved(selection.text, selection.type) : false} onSave={() => void saveSelection()} onClose={closeSelection} onSwitchType={(type) => setSelection((current) => current && { ...current, type })} onOpenPhrase={(phrase) => setSelection((current) => current && { text: phrase.text, type: "phrase", context: current.context, translation: phrase.translation, loading: false })} /></div></TabsContent>

          <TabsContent value="words" className="library-page">{wordBookView}</TabsContent>
          <TabsContent value="phrases" className="library-page">{wordBookView}</TabsContent>

          <TabsContent value="sentences" className="library-page"><LibraryHeader title="句子本" query={query} setQuery={setQuery} count={sentences.length} />{filteredSentences.length ? <div className="sentence-list">{filteredSentences.map((sentence) => <section className="sentence-card" key={sentence.id}><div className="sentence-english">{tokenize(sentence.text).map((token, index) => /^[A-Za-z]/.test(token) ? <WordHover key={`${token}-${index}`} word={token} articleId={sentence.articleId} known={wordMap[token.toLowerCase()]} mode={translationMode} /> : <span key={`${token}-${index}`}>{token}</span>)}</div><p className="sentence-translation">{sentence.translation}</p><div className="sentence-meta"><span>{sourceLabel(sentence.articleId, sentence.articleTitle)}</span><Button variant="ghost" size="icon" onClick={() => void removeItem("sentence", sentence.id)} aria-label="删除"><Trash2 /></Button></div></section>)}</div> : <EmptyLibrary icon={<Library />} text="划选文章中的句子，它会出现在这里。" setTab={setTab} />}</TabsContent>
          <TabsContent value="stats" className="library-page"><ReadingStats active={tab === "stats"} onOpenArticle={(id) => { setActiveArticleId(id); setTab("read"); }}>{tab === "stats" && <KaoyanCoverage articles={articles} savedWords={savedWordTexts} />}</ReadingStats></TabsContent>
        </section>

        <div className={`article-dock ${articleDockOpen ? "open" : ""}${selection && tab === "read" ? " is-hidden" : ""}`} onMouseEnter={() => setArticleDockOpen(true)} onMouseLeave={() => setArticleDockOpen(false)} onFocusCapture={() => setArticleDockOpen(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setArticleDockOpen(false); }}>
          <button type="button" className="article-dock-trigger" onClick={() => setArticleDockOpen((open) => !open)} aria-expanded={articleDockOpen} aria-label="选择文章"><FileText className="size-5" /><span>{activeArticle ? articleLabel(activeArticle) : ""}</span></button>
          <div className="article-dock-list" ref={dockListRef}>{articles.map((article) => <div className={`dock-article ${activeArticleId === article.id ? "active" : ""}`} key={article.id}><button type="button" className="dock-article-button" tabIndex={articleDockOpen ? 0 : -1} onClick={() => { setActiveArticleId(article.id); setTab("read"); setArticleDockOpen(false); }}><FileText className="size-4" /><span title={article.title}>{articleLabel(article)}</span>{article.id > 0 && <small className="dock-date">{formatImportDate(article.createdAt, true)}</small>}</button>{article.id > 0 && <AlertDialog><AlertDialogTrigger asChild><button type="button" tabIndex={articleDockOpen ? 0 : -1} className="dock-delete" aria-label={`删除《${articleLabel(article)}》`}><Trash2 className="size-3.5" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除《{articleLabel(article)}》？</AlertDialogTitle><AlertDialogDescription>文章正文和预翻译缓存会被删除，已经收藏到单词本、句子本的内容会保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-background hover:bg-destructive/85" onClick={() => void removeArticle(article.id)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>)}</div>
        </div>
      </Tabs>
    </main>
  );
}

function LibraryHeader({ title, subtitle, query, setQuery, count, action }: { title: string; subtitle?: string; query: string; setQuery: (value: string) => void; count: number; action?: React.ReactNode }) {
  return <header className="library-header"><div><h1>{title}<span className="library-count">{count}</span></h1>{subtitle && <p>{subtitle}</p>}</div><div className="library-actions">{action}<label className="search-box"><Search className="size-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label></div></header>;
}
function EmptyLibrary({ icon, text, setTab }: { icon: React.ReactNode; text: string; setTab: (value: string) => void }) {
  return <div className="empty-library"><span>{icon}</span><p>{text}</p><Button variant="outline" className="rounded-xl" onClick={() => setTab("read")}><BookOpen className="size-4" />去阅读</Button></div>;
}

type WordActions = {
  hoverStart: (id: number) => void; hoverEnd: (id: number) => void; toggle: (id: number) => void; moveFirst: (id: number) => void;
  dismiss: () => void; enrich: (id: number, again: boolean) => void; sync: (id: number) => void; remove: (id: number) => void;
};

const SavedWordCard = memo(function SavedWordCard({ word, open, translationVisible, aiConnected, enriching, syncing, actions }: {
  word: SavedWord; open: boolean; translationVisible: boolean; aiConnected: boolean; enriching: boolean; syncing: boolean; actions: WordActions;
}) {
  // The expandable part is only built once a card has been opened.
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  const id = word.id;
  return <section className={`word-card word-row ${open ? "expanded" : ""}`} data-word-card-id={id}
    onMouseEnter={() => actions.hoverStart(id)} onMouseLeave={() => actions.hoverEnd(id)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) actions.dismiss(); }}
    onKeyDown={(event) => { if (event.key === "Escape") actions.dismiss(); }}>
    <button type="button" className="word-row-trigger" onClick={(event) => { if (event.detail > 1) return; actions.toggle(id); }} onDoubleClick={() => actions.moveFirst(id)} aria-expanded={open} aria-label={`${word.text}${translationVisible ? `，${word.translation}` : "，点击显示释义"}；双击置顶`}>
      <span className="word-row-text">{word.text}</span>{translationVisible && <span className="word-row-translation">{word.translation}</span>}
    </button>
    <div className="word-row-reveal" aria-hidden={!open}><div className="word-row-reveal-inner">{opened && <>
      <div className="word-row-related">{word.similarJson && word.lookalikeJson ? <><RelatedWords title="近义" raw={word.similarJson} /><RelatedWords title="形近" raw={word.lookalikeJson} /></> : <div className="word-popover-pending">{enriching ? <Loader2 className="size-4 animate-spin" /> : null}</div>}</div>
      {word.syncStatus === "failed" && word.syncError && <p className="word-popover-error">同步失败：{word.syncError}</p>}
      <div className="word-popover-actions"><Button variant="ghost" size="icon" disabled={enriching || !aiConnected} tabIndex={open ? 0 : -1} onClick={() => actions.enrich(id, Boolean(word.similarJson))} aria-label={word.similarJson ? "重新生成联想" : "生成联想"} title={word.similarJson ? "重新生成联想" : "生成联想"}>{enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}</Button>{!word.text.includes(" ") && <Button variant="ghost" size="icon" disabled={syncing || word.syncStatus === "synced"} tabIndex={open ? 0 : -1} onClick={() => actions.sync(id)} aria-label={word.syncStatus === "synced" ? "已同步墨墨" : "同步墨墨"} title={word.syncStatus === "synced" ? "已同步墨墨" : "同步墨墨"}>{syncing ? <Loader2 className="size-4 animate-spin" /> : word.syncStatus === "synced" ? <CloudCheck className="size-4" /> : <Cloud className="size-4" />}</Button>}<Button variant="ghost" size="icon" tabIndex={open ? 0 : -1} onClick={() => speak(word.text)} aria-label={`朗读 ${word.text}`}><Volume2 className="size-4" /></Button><Button variant="ghost" size="icon" tabIndex={open ? 0 : -1} onClick={() => actions.remove(id)} aria-label={`删除 ${word.text}`}><Trash2 className="size-4" /></Button></div>
    </>}</div></div>
  </section>;
});

function RelatedWords({ title, raw }: { title: string; raw: string }) {
  let entries: RelatedWord[] = [];
  try { const data: unknown = JSON.parse(raw); if (Array.isArray(data)) entries = data.filter((item) => item && typeof item.word === "string" && typeof item.translation === "string").slice(0, 5); }
  catch { return null; }
  return <div className="related-words"><h3>{title}</h3><div>{entries.map((item) => <span className="related-word" key={item.word}><strong>{item.word}</strong><small>{item.translation}</small></span>)}</div></div>;
}
