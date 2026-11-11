"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Newspaper, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Pick = { id: number; title: string; shortTitle: string; publisher: string; publishedDate: string; words: number; kaoyan: number; excerpt: string; articleId: number | null };
export type PickedArticle = { id: number; title: string; shortTitle?: string; content: string; createdAt: string };

function dateLabel(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month} 月 ${day} 日`;
}

export function DailyPicks({ onOpen }: { onOpen: (article: PickedArticle, added: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/picks").catch(() => null);
    if (!response?.ok) return;
    const data = await response.json() as { date: string | null; picks: Pick[] };
    setDate(data.date);
    setPicks(data.picks);
  }, []);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function take(pick: Pick) {
    if (busy) return;
    setBusy(pick.id);
    try {
      const response = await fetch("/api/picks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: pick.id }) });
      const data = await response.json() as { article?: PickedArticle; error?: string };
      if (!response.ok || !data.article) throw new Error(data.error);
      setPicks((items) => items?.map((item) => item.id === pick.id ? { ...item, articleId: data.article!.id } : item) ?? null);
      onOpen(data.article, response.status === 201);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "添加失败，再试一次");
    } finally {
      setBusy(null);
    }
  }

  const fresh = picks?.some((pick) => !pick.articleId) ?? false;

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) void load(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="relative rounded-xl" aria-label="今日精选" title="今日精选"><Newspaper className="size-4" />{fresh && <span className="connection-dot" />}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-3 text-2xl">今日精选{date && <small className="text-sm font-normal text-muted-foreground">{dateLabel(date)}</small>}</DialogTitle>
          <DialogDescription className="sr-only">挑几篇加入自己的文章库</DialogDescription>
        </DialogHeader>
        {picks === null ? <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
          : picks.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">今天的文章还没到</p>
          : <ul className="pick-list">{picks.map((pick) => {
            const added = Boolean(pick.articleId);
            return (
              <li key={pick.id}>
                <button type="button" className={`pick-card${added ? " is-added" : ""}`} onClick={() => void take(pick)} disabled={busy !== null} aria-label={added ? `阅读《${pick.title}》` : `添加《${pick.title}》`}>
                  <span className="pick-head">
                    {pick.shortTitle && <span className="pick-chip">{pick.shortTitle}</span>}
                    <span className="pick-meta">{[pick.publisher, `${pick.words} 词`, `考研词 ${pick.kaoyan}`].filter(Boolean).join(" · ")}</span>
                    <span className="pick-action" aria-hidden>{busy === pick.id ? <Loader2 className="size-4 animate-spin" /> : added ? <Check className="size-4" /> : <Plus className="size-4" />}</span>
                  </span>
                  <span className="pick-title">{pick.title}</span>
                  {pick.excerpt && <span className="pick-excerpt">{pick.excerpt}</span>}
                </button>
              </li>
            );
          })}</ul>}
      </DialogContent>
    </Dialog>
  );
}
