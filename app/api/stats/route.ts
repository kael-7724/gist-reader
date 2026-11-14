import { flashcardVocab } from "@/lib/article-meta";
import { englishLemmaCandidates } from "@/lib/english-lemma";
import { database, message, ownerId } from "@/lib/site-data";
import { recallNow } from "@/lib/srs";

// Days are counted in Taipei time; stored timestamps are UTC.
const LOCAL_OFFSET = "+8 hours";

function localDay(date = new Date()) {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

type DayRow = { day: string; seconds: number; articlesRead: number };
type CountRow = { day: string; n: number };
type ReviewDay = { day: string; good: number; again: number };
type WordRow = { id: number; text: string; translation: string; reviewCount: number; stability: number | null; difficulty: number | null; lapses: number; reviewedAt: string | null };

// Record active reading time. The page sends small increments (at most two minutes) while the reader is in use.
export async function POST(request: Request) {
  try {
    const owner = ownerId(request);
    const payload = await request.json().catch(() => null) as { articleId?: unknown; seconds?: unknown } | null;
    const seconds = Math.round(Number(payload?.seconds));
    const articleId = Number(payload?.articleId);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120 || !Number.isInteger(articleId) || articleId < 1) {
      return Response.json({ error: "统计参数无效" }, { status: 400 });
    }
    const db = database();
    const article = await db.prepare("SELECT id FROM articles WHERE id = ? AND owner_id = ?").bind(articleId, owner).first();
    if (!article) return Response.json({ error: "没有找到文章" }, { status: 404 });
    await db.prepare(`INSERT INTO reading_daily (owner_id, day, article_id, seconds) VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id, day, article_id) DO UPDATE SET seconds = MIN(seconds + excluded.seconds, 86400), updated_at = CURRENT_TIMESTAMP`)
      .bind(owner, localDay(), articleId, seconds).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const owner = ownerId(request);
    const db = database();
    const today = localDay();
    const since = shiftDay(today, -29);
    const [reading, words, sentences, imported, totals, activeDays, top, reviewDays, reviewWords] = await Promise.all([
      db.prepare("SELECT day, SUM(seconds) AS seconds, COUNT(DISTINCT article_id) AS articlesRead FROM reading_daily WHERE owner_id = ? AND day >= ? GROUP BY day").bind(owner, since).all<DayRow>(),
      db.prepare(`SELECT date(created_at, '${LOCAL_OFFSET}') AS day, COUNT(*) AS n FROM saved_words WHERE owner_id = ? AND date(created_at, '${LOCAL_OFFSET}') >= ? GROUP BY day`).bind(owner, since).all<CountRow>(),
      db.prepare(`SELECT date(created_at, '${LOCAL_OFFSET}') AS day, COUNT(*) AS n FROM saved_sentences WHERE owner_id = ? AND date(created_at, '${LOCAL_OFFSET}') >= ? GROUP BY day`).bind(owner, since).all<CountRow>(),
      db.prepare(`SELECT date(created_at, '${LOCAL_OFFSET}') AS day, COUNT(*) AS n FROM articles WHERE owner_id = ? AND date(created_at, '${LOCAL_OFFSET}') >= ? GROUP BY day`).bind(owner, since).all<CountRow>(),
      db.prepare("SELECT COALESCE(SUM(seconds), 0) AS seconds, COUNT(DISTINCT day) AS days FROM reading_daily WHERE owner_id = ?").bind(owner).first<{ seconds: number; days: number }>(),
      db.prepare("SELECT day FROM reading_daily WHERE owner_id = ? GROUP BY day HAVING SUM(seconds) >= 60 ORDER BY day DESC LIMIT 400").bind(owner).all<{ day: string }>(),
      db.prepare(`SELECT r.article_id AS id, a.title, a.short_title AS shortTitle, SUM(r.seconds) AS seconds FROM reading_daily r JOIN articles a ON a.id = r.article_id AND a.owner_id = r.owner_id
        WHERE r.owner_id = ? AND r.day >= ? GROUP BY r.article_id ORDER BY seconds DESC LIMIT 5`).bind(owner, since).all<{ id: number; title: string; shortTitle: string; seconds: number }>(),
      db.prepare("SELECT day, SUM(grade = 'good') AS good, SUM(grade = 'again') AS again FROM word_reviews WHERE owner_id = ? GROUP BY day ORDER BY day DESC LIMIT 400").bind(owner).all<ReviewDay>(),
      db.prepare("SELECT id, text, translation, review_count AS reviewCount, srs_stability AS stability, srs_difficulty AS difficulty, srs_lapses AS lapses, reviewed_at AS reviewedAt FROM saved_words WHERE owner_id = ?").bind(owner).all<WordRow>(),
    ]);

    const byDay = (rows: CountRow[]) => new Map(rows.map((row) => [row.day, row.n]));
    const readingByDay = new Map(reading.results.map((row) => [row.day, row]));
    const wordsByDay = byDay(words.results), sentencesByDay = byDay(sentences.results), importedByDay = byDay(imported.results);
    const days = Array.from({ length: 30 }, (_, index) => {
      const day = shiftDay(since, index);
      const row = readingByDay.get(day);
      return { day, seconds: row?.seconds ?? 0, articlesRead: row?.articlesRead ?? 0, words: wordsByDay.get(day) ?? 0, sentences: sentencesByDay.get(day) ?? 0, imported: importedByDay.get(day) ?? 0 };
    });

    // A day counts toward the streak with at least one minute of reading. Today may still be in progress.
    const active = new Set(activeDays.results.map((row) => row.day));
    let cursor = active.has(today) ? today : shiftDay(today, -1);
    let streak = 0;
    while (active.has(cursor)) { streak += 1; cursor = shiftDay(cursor, -1); }

    // Flashcards: only single words from the full exam list go on the table, so the memory picture covers just those.
    const reviewByDay = new Map(reviewDays.results.map((row) => [row.day, row]));
    const cardDays = Array.from({ length: 30 }, (_, index) => {
      const day = shiftDay(since, index);
      const row = reviewByDay.get(day);
      return { day, good: row?.good ?? 0, again: row?.again ?? 0 };
    });
    const cards = reviewWords.results.filter((word) => !word.text.includes(" ") && englishLemmaCandidates(word.text).some((candidate) => flashcardVocab.has(candidate)));
    const now = Date.now();
    const memory = { fresh: 0, learning: 0, familiar: 0, mastered: 0 };
    let due = 0;
    for (const card of cards) {
      if (!card.stability || !card.reviewedAt) { memory.fresh += 1; continue; }
      if (card.stability >= 21) memory.mastered += 1; else if (card.stability >= 7) memory.familiar += 1; else memory.learning += 1;
      if ((recallNow({ stability: card.stability, difficulty: card.difficulty, reviewedAt: card.reviewedAt }, now) ?? 1) < 0.9) due += 1;
    }
    const lastWeek = cardDays.slice(-7);
    const weekGood = lastWeek.reduce((sum, day) => sum + day.good, 0);
    const weekAgain = lastWeek.reduce((sum, day) => sum + day.again, 0);
    const reviewActive = new Set(reviewDays.results.map((row) => row.day));
    let reviewCursor = reviewActive.has(today) ? today : shiftDay(today, -1);
    let reviewStreak = 0;
    while (reviewActive.has(reviewCursor)) { reviewStreak += 1; reviewCursor = shiftDay(reviewCursor, -1); }
    const review = {
      days: cardDays,
      today: cardDays[cardDays.length - 1],
      weekRecall: weekGood + weekAgain ? weekGood / (weekGood + weekAgain) : null,
      weekTotal: weekGood + weekAgain,
      streak: reviewStreak,
      due,
      cards: cards.length,
      memory,
      totalTurns: reviewWords.results.reduce((sum, word) => sum + (word.reviewCount || 0), 0),
      hardest: cards.filter((card) => card.lapses > 0).sort((a, b) => b.lapses - a.lapses || (b.difficulty ?? 0) - (a.difficulty ?? 0)).slice(0, 6)
        .map((card) => ({ id: card.id, text: card.text, translation: card.translation, lapses: card.lapses, recall: recallNow({ stability: card.stability, difficulty: card.difficulty, reviewedAt: card.reviewedAt }, now) })),
    };

    return Response.json({
      review,
      today,
      days,
      streak,
      todaySeconds: days[days.length - 1].seconds,
      weekSeconds: days.slice(-7).reduce((sum, day) => sum + day.seconds, 0),
      totalSeconds: totals?.seconds ?? 0,
      totalDays: totals?.days ?? 0,
      topArticles: top.results,
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
