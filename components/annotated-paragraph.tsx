"use client";

import { memo } from "react";
import { englishLemmaCandidates } from "@/lib/english-lemma";

type Interval = { start: number; end: number };
// Set while rendering the article's opening paragraph: its first letter becomes a drop cap made of real text, so it can still be selected.
type Cap = { pending: boolean };

function escapePattern(value: string) {
  return value.trim().replace(/\s+/g, " ").split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]")).join("\\s+");
}

function findIntervals(text: string, needles: string[], wholeWords: boolean) {
  const found: Interval[] = [];
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    const normalized = needle.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > 1200) continue;
    const body = escapePattern(normalized);
    const pattern = new RegExp(wholeWords ? `(?<![A-Za-z])${body}(?![A-Za-z])` : body, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!found.some((existing) => start < existing.end && end > existing.start)) found.push({ start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function renderWords(text: string, saved: Set<string>, vocab: Set<string> | null, prefix: string, cap?: Cap) {
  const result: React.ReactNode[] = [];
  const pattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) result.push(text.slice(cursor, start));
    const word = match[0];
    let shown: React.ReactNode = word;
    if (cap?.pending) { cap.pending = false; shown = <><span className="drop-cap">{word[0]}</span>{word.slice(1)}</>; }
    const candidates = englishLemmaCandidates(word);
    const isKaoyan = Boolean(vocab && candidates.some((candidate) => vocab.has(candidate)));
    if (candidates.some((candidate) => saved.has(candidate))) {
      result.push(<strong key={`${prefix}-${start}`} className={isKaoyan ? "saved-word kaoyan-word" : "saved-word"}><em>{shown}</em></strong>);
    } else if (isKaoyan) {
      result.push(<span key={`${prefix}-${start}`} className="kaoyan-word">{shown}</span>);
    } else {
      result.push(cap && shown !== word ? <span key={`${prefix}-${start}`}>{shown}</span> : word);
    }
    cursor = start + word.length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

function renderWithPhrases(text: string, saved: Set<string>, phrases: string[], vocab: Set<string> | null, prefix: string, cap?: Cap) {
  const output: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of findIntervals(text, phrases, true)) {
    if (match.start > cursor) output.push(...renderWords(text.slice(cursor, match.start), saved, vocab, `${prefix}-w${cursor}`, cap));
    output.push(<strong key={`${prefix}-p${match.start}`} className="saved-word saved-phrase" title="已收藏到单词本（词组）"><em>{renderWords(text.slice(match.start, match.end), new Set(), vocab, `${prefix}-in${match.start}`, cap)}</em></strong>);
    cursor = match.end;
  }
  if (cursor < text.length) output.push(...renderWords(text.slice(cursor), saved, vocab, `${prefix}-w${cursor}`, cap));
  return output;
}

// A short line with no closing punctuation, such as "Outsourcing cognition", is shown as a subheading.
function isSubheading(text: string) {
  const line = text.trim();
  if (!line || line.includes("\n") || line.length > 70) return false;
  if (line.split(/\s+/).length > 10 || !/^[A-Z“"‘']/.test(line)) return false;
  return !/[.,;:!?…”"’)]$/.test(line);
}

export const AnnotatedParagraph = memo(function AnnotatedParagraph({ text, savedWords, savedPhrases, savedSentences, vocab, dropCap = false }: { text: string; savedWords: Set<string>; savedPhrases: string[]; savedSentences: string[]; vocab: Set<string> | null; dropCap?: boolean }) {
  const output: React.ReactNode[] = [];
  const subheading = isSubheading(text);
  const cap: Cap | undefined = dropCap && !subheading ? { pending: true } : undefined;
  let cursor = 0;
  for (const match of findIntervals(text, savedSentences, false)) {
    if (match.start > cursor) output.push(...renderWithPhrases(text.slice(cursor, match.start), savedWords, savedPhrases, vocab, `plain-${cursor}`, cap));
    output.push(<span className="saved-sentence" key={`sentence-${match.start}`} title="已收藏到句子本">{renderWithPhrases(text.slice(match.start, match.end), savedWords, savedPhrases, vocab, `sentence-${match.start}`, cap)}</span>);
    cursor = match.end;
  }
  if (cursor < text.length) output.push(...renderWithPhrases(text.slice(cursor), savedWords, savedPhrases, vocab, `tail-${cursor}`, cap));
  return <p className={subheading ? "article-subheading" : undefined}>{output}</p>;
});
