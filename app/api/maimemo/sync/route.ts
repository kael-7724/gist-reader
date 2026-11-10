import { database, message, ownerId } from "@/lib/site-data";
import { maimemoRequest, readMaimemoToken, sentenceFromContext } from "@/lib/maimemo";
import { englishLemmaCandidates, normalizeEnglishWord } from "@/lib/english-lemma";

type WordRow = { id: number; article_id: number | null; text: string; translation: string; context: string; article_title: string; maimemo_voc_id: string | null; maimemo_phrase_id: string | null };
type Vocabulary = { id: string; spelling: string };
type Phrase = { id: string; phrase: string };
type VocabularyResponse = {
  voc?: Vocabulary[];
  vocs?: Vocabulary[];
  vocabulary?: Vocabulary[];
  data?: { voc?: Vocabulary[]; vocs?: Vocabulary[]; vocabulary?: Vocabulary[] };
};

function vocabularyItems(response: VocabularyResponse) {
  const items = response.voc || response.vocs || response.vocabulary || response.data?.voc || response.data?.vocs || response.data?.vocabulary;
  if (!Array.isArray(items)) throw new Error("墨墨查词返回格式异常，请重新连接后再试");
  return items.filter((item) => item && typeof item.id === "string" && typeof item.spelling === "string");
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index]); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const payload = await request.json() as { ids?: number[] };
    const ids = [...new Set((payload.ids || []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 30);
    if (!ids.length) return Response.json({ error: "没有可同步的单词" }, { status: 400 });
    const db = database();
    const placeholders = ids.map(() => "?").join(",");
    const wordResult = await db.prepare(`SELECT id, article_id, text, translation, context, article_title, maimemo_voc_id, maimemo_phrase_id FROM saved_words WHERE owner_id = ? AND id IN (${placeholders})`).bind(owner, ...ids).all<WordRow>();
    const words = wordResult.results;
    if (!words.length) return Response.json({ error: "没有找到这些单词" }, { status: 404 });
    const token = await readMaimemoToken(request, owner);
    const candidateMap = new Map(words.map((word) => [word.id, englishLemmaCandidates(word.text)]));
    const spellings = [...new Set([...candidateMap.values()].flat())];
    let vocabulary: VocabularyResponse;
    try {
      vocabulary = await maimemoRequest<VocabularyResponse>(token, "/api/v1/memo/vocabulary/query", { method: "POST", body: JSON.stringify({ spellings }) });
    } catch (error) {
      throw new Error(`查询墨墨词库失败：${message(error)}`);
    }
    const lookup = new Map(vocabularyItems(vocabulary).map((item) => [normalizeEnglishWord(item.spelling), item]));
    const matched = words.flatMap((word) => {
      const voc = word.maimemo_voc_id
        ? { id: word.maimemo_voc_id, spelling: candidateMap.get(word.id)?.[0] || normalizeEnglishWord(word.text) }
        : candidateMap.get(word.id)?.map((candidate) => lookup.get(candidate)).find(Boolean);
      return voc ? [{ word, voc }] : [];
    });
    if (matched.length) {
      const vocIds = [...new Set(matched.map(({ voc }) => voc.id))];
      try {
        await maimemoRequest(token, "/api/v1/memo/study/add_words", { method: "POST", body: JSON.stringify({ words: vocIds.map((id) => ({ id })), advance: false }) });
      } catch (error) {
        throw new Error(`加入墨墨学习列表失败：${message(error)}`);
      }
    }

    const results = await mapLimit(matched, 4, async ({ word, voc }) => {
      try {
        let phraseId = word.maimemo_phrase_id;
        let phraseWarning: string | undefined;
        if (!phraseId) {
          const sentence = sentenceFromContext(word.context, word.text).slice(0, 500);
          const cached = word.article_id ? await db.prepare("SELECT translation FROM article_translations WHERE owner_id = ? AND article_id = ? AND kind = 'sentence' AND normalized_source = ?").bind(owner, word.article_id, sentence.trim().replace(/\s+/g, " ").toLowerCase()).first<{ translation: string }>() : null;
          const sentenceTranslation = (cached?.translation || `词义：${word.translation}`).slice(0, 500);
          try {
            const existing = await maimemoRequest<{ phrases?: Phrase[] }>(token, `/api/v1/memo/phrases?voc_id=${encodeURIComponent(voc.id)}`);
            phraseId = existing.phrases?.find((item) => item.phrase.trim().toLowerCase() === sentence.trim().toLowerCase())?.id || null;
          } catch { /* Existing-phrase lookup is an optional optimization. */ }
          if (!phraseId) {
            try {
              const created = await maimemoRequest<{ phrase: { id: string } }>(token, "/api/v1/memo/phrases", { method: "POST", body: JSON.stringify({ phrase: { voc_id: voc.id, phrase: sentence, interpretation: sentenceTranslation, tags: ["LexiTrace"], origin: word.article_title.slice(0, 80) } }) });
              phraseId = created.phrase.id;
            } catch (error) {
              phraseWarning = `单词已同步，例句未添加：${message(error)}`.slice(0, 300);
            }
          }
        }
        await db.prepare("UPDATE saved_words SET maimemo_voc_id = ?, maimemo_phrase_id = ?, sync_status = 'synced', sync_error = NULL, synced_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ?").bind(voc.id, phraseId, owner, word.id).run();
        return { id: word.id, status: "synced", vocId: voc.id, warning: phraseWarning };
      } catch (error) {
        const errorMessage = message(error).slice(0, 300);
        await db.prepare("UPDATE saved_words SET sync_status = 'failed', sync_error = ? WHERE owner_id = ? AND id = ?").bind(errorMessage, owner, word.id).run();
        return { id: word.id, status: "failed", error: errorMessage };
      }
    });

    const matchedIds = new Set(matched.map(({ word }) => word.id));
    const unmatched = words.filter((word) => !matchedIds.has(word.id));
    if (unmatched.length) {
      const errorText = "墨墨词库中未找到该单词或其词典原形";
      await db.batch(unmatched.map((word) => db.prepare("UPDATE saved_words SET sync_status = 'failed', sync_error = ? WHERE owner_id = ? AND id = ?").bind(errorText, owner, word.id)));
      results.push(...unmatched.map((word) => ({ id: word.id, status: "failed", error: errorText })));
    }
    return Response.json({ results, synced: results.filter((item) => item.status === "synced").length, failed: results.filter((item) => item.status === "failed").length, warnings: results.filter((item) => "warning" in item && item.warning).length });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}
