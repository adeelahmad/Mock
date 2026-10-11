// Mock — the pure half of the written analysis. The Flash model judges the content (story,
// numbers, STAR split, I-vs-we, verdict); everything measurable comes from the app: pace and
// duration from timestamps, fillers from the transcript. The model's JSON is never trusted as
// is — `normalizeAnalysis` clamps, defaults and repairs it into the `Analysis` shape so a
// malformed reply degrades a card instead of breaking History.

import type { Analysis, MissedNumber, StarSplit, Story, Verdict } from './types.ts';

export const VERDICTS: Verdict[] = ['strong_hire', 'inclined', 'not_inclined', 'strong_no_hire'];
export const isVerdict = (x: unknown): x is Verdict => typeof x === 'string' && (VERDICTS as string[]).includes(x);

export interface Turn { speaker: 'interviewer' | 'coach' | 'me'; text: string; tMs: number }

// ---------- delivery from timestamps ----------

const FILLERS = /\b(um+|uh+|erm+|er|ah+|like|you know|sort of|kind of|basically|actually|i mean)\b/gi;

export const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const fillerCount = (text: string): number => (text.match(FILLERS) ?? []).length;

/** Under 130 wpm reads slow, over 175 fast. */
export const paceNoteFor = (wpm: number): 'slow' | 'good' | 'fast' => (wpm < 130 ? 'slow' : wpm > 175 ? 'fast' : 'good');
/** A behavioural answer lands in 1½–3 minutes. */
export const lengthNoteFor = (sec: number): 'short' | 'good' | 'long' => (sec < 90 ? 'short' : sec > 180 ? 'long' : 'good');

export interface MeasuredDelivery { paceWpm: number; paceNote: 'slow' | 'good' | 'fast'; durationSec: number; lengthNote: 'short' | 'good' | 'long'; fillers: number; words: number }

/** What the app measures itself: words, pace, length and fillers of the candidate's turns. */
export function measureDelivery(turns: Turn[], durationSec: number): MeasuredDelivery {
  const mine = turns.filter((t) => t.speaker === 'me').map((t) => t.text).join(' ');
  const words = wordCount(mine);
  const sec = Math.max(0, Math.round(durationSec));
  const paceWpm = sec > 0 && words > 0 ? Math.round(words / (sec / 60)) : 0;
  return { paceWpm, paceNote: paceNoteFor(paceWpm || 150), durationSec: sec, lengthNote: lengthNoteFor(sec), fillers: fillerCount(mine), words };
}

// ---------- the verdict the coach said aloud ----------

// Longer phrases first: at any position the alternation takes the first that matches, so
// "not inclined" never reads as "inclined" and "strong no hire" never as "strong hire".
const SPOKEN = /\bstrong(?:ly)?[\s-]*no[\s-]*hire\b|\bnot[\s-]+inclined\b|\bstrong(?:ly)?[\s-]*hire\b|\binclined\b/gi;

/** The verdict named in the coaching text, if any ("…that's a not inclined." → not_inclined). The last one named wins. */
export function extractSpokenVerdict(text: string): Verdict | null {
  let last: string | null = null;
  for (const m of text.matchAll(SPOKEN)) last = m[0].toLowerCase();
  if (!last) return null;
  if (last.startsWith('not')) return 'not_inclined';
  if (/[\s-]no[\s-]/.test(last)) return 'strong_no_hire';
  return /strong/.test(last) ? 'strong_hire' : 'inclined';
}

// ---------- normalising the model's reply ----------

const str = (x: unknown, fallback = ''): string => (typeof x === 'string' ? x.trim() : fallback);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() && Number.isFinite(Number(x)) ? Number(x) : fallback);
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** STAR shares as whole percentages that add up to 100 (the largest remainder takes the rounding). */
export function normalizeStar(raw: unknown): StarSplit {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const xs = (['s', 't', 'a', 'r'] as const).map((k) => Math.max(0, num(o[k] ?? o[{ s: 'situation', t: 'task', a: 'action', r: 'result' }[k]], 0)));
  const sum = xs.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { s: 25, t: 25, a: 25, r: 25 };
  const exact = xs.map((x) => (x / sum) * 100);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return { s: out[0], t: out[1], a: out[2], r: out[3] };
}

export interface NormalizeContext {
  measured: MeasuredDelivery;
  stories: Pick<Story, 'id' | 'title'>[];
  /** The LP the exchange was opened with (the model may not name one). */
  lpName: string;
  coachText: string;
  now?: Date;
}

const storyByTitle = (stories: Pick<Story, 'id' | 'title'>[], title: string) => {
  const t = title.toLowerCase();
  return t ? stories.find((s) => s.title.toLowerCase() === t) ?? stories.find((s) => t.includes(s.title.toLowerCase()) || s.title.toLowerCase().includes(t)) : undefined;
};

/** The model's JSON (any shape) → a valid Analysis. Measured delivery overrides the model's guesses. */
export function normalizeAnalysis(raw: unknown, ctx: NormalizeContext): Analysis {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const verdict = isVerdict(o.verdict) ? o.verdict : 'not_inclined';
  const storyUsedRaw = str(o.storyUsed ?? o.story_used);
  const used = storyByTitle(ctx.stories, storyUsedRaw);
  const storyUsed = storyUsedRaw && !/^(none|null|n\/a|no story)$/i.test(storyUsedRaw) ? used?.title ?? storyUsedRaw : null;
  const b = (o.betterStory ?? o.better_story) as Record<string, unknown> | null | undefined;
  const bTitle = b && typeof b === 'object' ? str(b.title) : '';
  const bStory = storyByTitle(ctx.stories, bTitle);
  const betterStory = bStory && bStory.title !== storyUsed ? { storyId: bStory.id, title: bStory.title, reason: str(b!.reason) } : null;
  const numbersMissed: MissedNumber[] = (Array.isArray(o.numbersMissed ?? o.numbers_missed) ? (o.numbersMissed ?? o.numbers_missed) as unknown[] : [])
    .map((m) => { const x = (m ?? {}) as Record<string, unknown>; return { notes: str(x.notes), said: str(x.said, '') || 'not said' }; })
    .filter((m) => m.notes).slice(0, 4);
  const d = (o.delivery ?? {}) as Record<string, unknown>;
  const m = ctx.measured;
  const spokenFromModel = isVerdict(o.spokenVerdict ?? o.spoken_verdict) ? (o.spokenVerdict ?? o.spoken_verdict) as Verdict : null;
  const fixes = (Array.isArray(o.fixes) ? o.fixes : []).map((f) => str(f)).filter(Boolean).slice(0, 3);
  return {
    lp: str(o.lp) || ctx.lpName,
    storyUsed,
    betterStory,
    numbersMissed,
    star: normalizeStar(o.star),
    iWeRatio: clamp(num(o.iWeRatio ?? o.i_we_ratio, 0.5), 0, 1),
    delivery: {
      paceWpm: m.paceWpm || Math.round(clamp(num(d.paceWpm, 150), 60, 260)),
      paceNote: m.paceWpm ? m.paceNote : (['slow', 'good', 'fast'].includes(str(d.paceNote)) ? str(d.paceNote) : 'good') as 'slow' | 'good' | 'fast',
      durationSec: m.durationSec,
      lengthNote: m.durationSec ? m.lengthNote : 'good',
      fillers: m.words ? m.fillers : Math.max(0, Math.round(num(d.fillers, 0))),
      confidence: clamp(num(d.confidence, 0.5), 0, 1),
      notes: str(d.notes),
    },
    verdict,
    // What the coach said aloud wins over the model's reading of it; the local match is the fallback.
    spokenVerdict: extractSpokenVerdict(ctx.coachText) ?? spokenFromModel,
    strength: str(o.strength),
    fixes,
    createdAt: (ctx.now ?? new Date()).toISOString(),
  };
}
