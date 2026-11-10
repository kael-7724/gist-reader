"use client";

import { englishLemmaCandidates } from "@/lib/english-lemma";

type Interval = { start: number; end: number };

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

function renderWords(text: string, saved: Set<string>, vocab: Set<string> | null, prefix: string) {
  const result: React.ReactNode[] = [];
  const pattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) result.push(text.slice(cursor, start));
    const word = match[0];
    const candidates = englishLemmaCandidates(word);
    if (candidates.some((candidate) => saved.has(candidate))) {
      result.push(<strong key={`${prefix}-${start}`} className="saved-word"><em>{word}</em></strong>);
    } else if (vocab && candidates.some((candidate) => vocab.has(candidate))) {
      result.push(<span key={`${prefix}-${start}`} className="kaoyan-word">{word}</span>);
    } else {
      result.push(word);
    }
    cursor = start + word.length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

function renderWithPhrases(text: string, saved: Set<string>, phrases: string[], vocab: Set<string> | null, prefix: string) {
  const output: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of findIntervals(text, phrases, true)) {
    if (match.start > cursor) output.push(...renderWords(text.slice(cursor, match.start), saved, vocab, `${prefix}-w${cursor}`));
    output.push(<strong key={`${prefix}-p${match.start}`} className="saved-word saved-phrase" title="已收藏到单词本（词组）"><em>{text.slice(match.start, match.end)}</em></strong>);
    cursor = match.end;
  }
  if (cursor < text.length) output.push(...renderWords(text.slice(cursor), saved, vocab, `${prefix}-w${cursor}`));
  return output;
}

// A short line with no closing punctuation, such as "Outsourcing cognition", is shown as a subheading.
function isSubheading(text: string) {
  const line = text.trim();
  if (!line || line.includes("\n") || line.length > 70) return false;
  if (line.split(/\s+/).length > 10 || !/^[A-Z“"‘']/.test(line)) return false;
  return !/[.,;:!?…”"’)]$/.test(line);
}

export function AnnotatedParagraph({ text, savedWords, savedPhrases, savedSentences, vocab }: { text: string; savedWords: Set<string>; savedPhrases: string[]; savedSentences: string[]; vocab: Set<string> | null }) {
  const output: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of findIntervals(text, savedSentences, false)) {
    if (match.start > cursor) output.push(...renderWithPhrases(text.slice(cursor, match.start), savedWords, savedPhrases, vocab, `plain-${cursor}`));
    output.push(<span className="saved-sentence" key={`sentence-${match.start}`} title="已收藏到句子本">{renderWithPhrases(text.slice(match.start, match.end), savedWords, savedPhrases, vocab, `sentence-${match.start}`)}</span>);
    cursor = match.end;
  }
  if (cursor < text.length) output.push(...renderWithPhrases(text.slice(cursor), savedWords, savedPhrases, vocab, `tail-${cursor}`));
  return <p className={isSubheading(text) ? "article-subheading" : undefined}>{output}</p>;
}
