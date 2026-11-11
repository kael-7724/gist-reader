// Spaced repetition after FSRS-4.5 (Ye et al., the scheduler used by Anki), with two grades:
// "good" (turned the card, looked at the answer, knew it) and "again" (looked at the answer, put it back).
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86_400_000;

export type Grade = "again" | "good";
export type SrsState = { stability: number | null; difficulty: number | null; reviewedAt: string | null };

const clampDifficulty = (d: number) => Math.min(10, Math.max(1, d));

export function parseTime(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

// Probability of still remembering the word after `days` with memory stability `stability` (days).
export function retrievability(days: number, stability: number) {
  return (1 + FACTOR * Math.max(0, days) / stability) ** DECAY;
}

export function recallNow(state: SrsState, now = Date.now()) {
  if (!state.stability || !state.reviewedAt) return null;
  const at = parseTime(state.reviewedAt);
  if (Number.isNaN(at)) return null;
  return retrievability((now - at) / DAY, state.stability);
}

export function nextState(state: SrsState, grade: Grade, now = Date.now()) {
  const g = grade === "good" ? 3 : 1;
  if (!state.stability || !state.difficulty) {
    return { stability: W[g - 1], difficulty: clampDifficulty(W[4] - (g - 3) * W[5]) };
  }
  const r = recallNow(state, now) ?? 1;
  const s = state.stability;
  const d = state.difficulty;
  const difficulty = clampDifficulty(W[7] * W[4] + (1 - W[7]) * (d - W[6] * (g - 3)));
  const stability = g === 1
    ? Math.min(s, W[11] * d ** -W[12] * ((s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)))
    : s * (Math.exp(W[8]) * (11 - d) * s ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1) + 1);
  return { stability: Math.max(0.1, stability), difficulty };
}
