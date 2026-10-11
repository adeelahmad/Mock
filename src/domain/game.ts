// Mock — the Areas game. A question is shown with every area; the player picks the ones it
// belongs to. Per picked area: the question's primary area (its first tag) scores +5, any
// other tagged area (secondary) +2, an area the question is not tagged with −2. Pure logic;
// the screen (screens/Game.tsx) renders it and saves each finished round as a GamePlay.

import type { Question } from './types.ts';

export const GAME_POINTS = { primary: 5, secondary: 2, invalid: -2 } as const;
export const ROUND_SIZE = 10;
/** Gameplays kept in history (oldest dropped first). */
export const GAME_HISTORY = 100;

export type AreaRole = 'primary' | 'secondary';

/** Per-area tallies: picked correctly, missed (valid but not picked), picked wrongly. */
export interface AreaTally { hit: number; miss: number; wrong: number }

export interface GamePlay {
  id: string;
  startedAt: string;
  endedAt: string;
  questions: number;
  score: number;
  /** Best possible score for these questions (every valid area picked, nothing else). */
  max: number;
  areas: Record<string, AreaTally>;
}

export interface AreaPick { areaId: string; role: AreaRole | null; points: number }
export interface Scored { picks: AreaPick[]; missed: { areaId: string; role: AreaRole }[]; score: number; max: number }

/** The role an area plays for a question: the first tag is primary, the rest secondary. */
export function roleOf(q: Pick<Question, 'lpIds'>, areaId: string): AreaRole | null {
  const i = q.lpIds.indexOf(areaId);
  return i < 0 ? null : i === 0 ? 'primary' : 'secondary';
}

export const maxScore = (q: Pick<Question, 'lpIds'>): number => {
  const ids = [...new Set(q.lpIds)];
  return ids.length ? GAME_POINTS.primary + (ids.length - 1) * GAME_POINTS.secondary : 0;
};

/** Scores one answer: the selected area ids against the question's tags. */
export function scoreAnswer(q: Pick<Question, 'lpIds'>, selected: Iterable<string>): Scored {
  const sel = [...new Set(selected)];
  const picks = sel.map((areaId): AreaPick => {
    const role = roleOf(q, areaId);
    return { areaId, role, points: role ? GAME_POINTS[role] : GAME_POINTS.invalid };
  });
  const missed = [...new Set(q.lpIds)].filter((id) => !sel.includes(id)).map((areaId) => ({ areaId, role: roleOf(q, areaId)! }));
  return { picks, missed, score: picks.reduce((n, p) => n + p.points, 0), max: maxScore(q) };
}

/** Adds one answer's outcome to per-area tallies (mutates and returns `into`). */
export function tally(into: Record<string, AreaTally>, s: Scored): Record<string, AreaTally> {
  const t = (id: string) => (into[id] ??= { hit: 0, miss: 0, wrong: 0 });
  for (const p of s.picks) if (p.role) t(p.areaId).hit++; else t(p.areaId).wrong++;
  for (const m of s.missed) t(m.areaId).miss++;
  return into;
}

/** Questions that can be played: tagged with at least one area. */
export const playable = (qs: Question[], areaIds?: Set<string>): Question[] =>
  qs.filter((q) => q.lpIds.length > 0 && (!areaIds || q.lpIds.every((id) => areaIds.has(id))));

/** A seeded PRNG (mulberry32), so rounds are reproducible in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to `n` distinct questions in random order. */
export function dealRound(qs: Question[], n = ROUND_SIZE, rand: () => number = Math.random): Question[] {
  const a = qs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

export interface AreaAccuracy { areaId: string; hit: number; miss: number; wrong: number; pct: number }

/** Accuracy per area across plays: hits ÷ (hits + misses + wrong picks), worst first. */
export function areaAccuracy(plays: GamePlay[]): AreaAccuracy[] {
  const sum: Record<string, AreaTally> = {};
  for (const p of plays) for (const [id, t] of Object.entries(p.areas)) {
    const s = (sum[id] ??= { hit: 0, miss: 0, wrong: 0 });
    s.hit += t.hit; s.miss += t.miss; s.wrong += t.wrong;
  }
  return Object.entries(sum)
    .map(([areaId, t]) => { const d = t.hit + t.miss + t.wrong; return { areaId, ...t, pct: d ? Math.round((t.hit / d) * 100) : 0 }; })
    .sort((a, b) => a.pct - b.pct || a.areaId.localeCompare(b.areaId));
}

export const bestPlay = (plays: GamePlay[]): GamePlay | null =>
  plays.reduce<GamePlay | null>((b, p) => (!b || p.score > b.score ? p : b), null);

export const newPlayId = (): string => 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Appends a play, keeping the newest `GAME_HISTORY`. */
export const withPlay = (plays: GamePlay[], p: GamePlay): GamePlay[] => [...plays, p].slice(-GAME_HISTORY);
