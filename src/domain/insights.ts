// Mock — transcript insights: a tone read (sentiment) for every line of a session, and the
// ✦ Ask AI rewrites of the candidate's own lines, kept as versions you can step between.
// Both live in one JSON blob per session (`insights:{sessionId}`), so they ride along with the
// session's other blobs and never touch the tables. The lexicon read below is the offline
// fallback; with a key the History screen asks Flash once per session (gemini/insights.ts).

import type { Repo } from '../db/repo.ts';
import type { Story, TranscriptEvent } from './types.ts';
import { fillerCount, wordCount } from './analysis.ts';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';
export interface Sentiment { label: SentimentLabel; /** -1 … 1 */ score: number; /** one word: "confident", "hesitant", "frustrated"… */ tone: string }

export type RewriteKind = 'improve' | 'story';
export interface Rewrite { id: string; kind: RewriteKind; text: string; at: string; /** 'ai' = Flash wrote it; 'local' = the offline composer */ by: 'ai' | 'local' }

export interface SessionInsights {
  v: 1;
  /** Flash's read, by transcript event id; absent → the lexicon read is shown. */
  sentiment?: Record<string, Sentiment>;
  rewrites: Record<string, Rewrite[]>;
}

export const EMPTY_INSIGHTS: SessionInsights = { v: 1, rewrites: {} };
export const insightsKey = (sessionId: string): string => 'insights:' + sessionId;

export async function loadInsights(repo: Repo, sessionId: string): Promise<SessionInsights> {
  const b = await repo.getBlob(insightsKey(sessionId)).catch(() => null);
  if (!b) return { ...EMPTY_INSIGHTS, rewrites: {} };
  try {
    const raw = JSON.parse(await b.text()) as Partial<SessionInsights>;
    return { v: 1, sentiment: raw.sentiment && typeof raw.sentiment === 'object' ? raw.sentiment : undefined, rewrites: raw.rewrites && typeof raw.rewrites === 'object' ? raw.rewrites : {} };
  } catch { return { ...EMPTY_INSIGHTS, rewrites: {} }; }
}

export async function saveInsights(repo: Repo, sessionId: string, x: SessionInsights): Promise<void> {
  await repo.putBlob(insightsKey(sessionId), new Blob([JSON.stringify(x)], { type: 'application/json' }));
}

// ---------- the offline tone read ----------
const POS = /\b(good|great|excellent|glad|happy|love|proud|success(ful|fully)?|delivered|shipped|launched|improv(ed|ing)|reduc(ed|ing)|increas(ed|ing)|sav(ed|ing)|solv(ed|ing)|resolv(ed|ing)|achiev(ed|ing)|helped|won|win|clear(ly)?|strong(er)?|well|on time|commit(ted)?|agree(d)?|thank(s| you)?|nice|exactly|right|perfect|confident|ownership|learn(ed|t))\b/gi;
const NEG = /\b(bad|worse|worst|wrong|fail(ed|ure|ing)?|problem(s)?|issue(s)?|risk(s|y)?|frustrat(ed|ing|ion)|angry|upset|blam(e|ed)|conflict|against|disagree(d|ment)?|concern(ed|s)?|struggl(e|ed|ing)|delay(ed|s)?|late|miss(ed|ing)|unfortunately|couldn'?t|can'?t|won'?t|didn'?t|never|weak(er)?|vague|lack(s|ing)?|unclear|outage|incident|broke(n)?|stuck)\b/gi;
const HEDGE = /\b(maybe|perhaps|i think|i guess|kind of|sort of|probably|i'?m not sure|not sure|somewhat|basically)\b/gi;

const count = (re: RegExp, s: string): number => (s.match(re) ?? []).length;

/** A lexicon read of one line: cheap, deterministic, good enough to colour a transcript offline. */
export function localSentiment(text: string, speaker: TranscriptEvent['speaker']): Sentiment {
  const words = Math.max(1, wordCount(text));
  const pos = count(POS, text), neg = count(NEG, text), hedge = count(HEDGE, text) + fillerCount(text);
  const raw = (pos - neg) / Math.sqrt(words);
  const score = Math.max(-1, Math.min(1, Math.round(raw * 100) / 100));
  const label: SentimentLabel = score >= 0.15 ? 'positive' : score <= -0.15 ? 'negative' : 'neutral';
  let tone: string;
  if (speaker === 'me') tone = hedge >= 3 && hedge / words > 0.04 ? 'hesitant' : label === 'positive' ? 'confident' : label === 'negative' ? 'tense' : 'steady';
  else if (speaker === 'coach') tone = label === 'positive' ? 'encouraging' : label === 'negative' ? 'critical' : 'direct';
  else tone = label === 'positive' ? 'warm' : label === 'negative' ? 'probing' : 'neutral';
  return { label, score, tone };
}

/** Clamp and tidy whatever Flash sent back for one line. */
export function normalizeSentiment(x: unknown): Sentiment | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const label = o.label === 'positive' || o.label === 'negative' || o.label === 'neutral' ? o.label : null;
  if (!label) return null;
  const n = Number(o.score);
  const score = Number.isFinite(n) ? Math.max(-1, Math.min(1, Math.round(n * 100) / 100)) : label === 'positive' ? 0.5 : label === 'negative' ? -0.5 : 0;
  const tone = typeof o.tone === 'string' && o.tone.trim() ? o.tone.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ').slice(0, 20) : label;
  return { label, score, tone };
}

// ---------- the offline rewrites ----------
const FILLER_RX = /\b(um+|uh+|erm|you know|like,|i mean|so yeah|kind of|sort of|basically|actually|literally)\b[,]?\s*/gi;

/** The candidate's line with fillers and stutters taken out and "we" made "I" where it starts a clause. */
export function localPolish(text: string): string {
  let s = text.replace(FILLER_RX, '');
  s = s.replace(/\b(\w+)(\s+\1\b)+/gi, '$1'); // "AWS AWS" → "AWS"
  s = s.replace(/(^|[.!?]\s+)we\b/gi, (_m, p: string) => p + 'I');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return s && !/[.!?]$/.test(s) ? s + '.' : s;
}

/** A STAR answer from the story that best fits the area (primary-linked first), offline. */
export function localStory(stories: Story[], lpId: string | null, skip: number): string {
  const primary = lpId ? stories.filter((s) => s.links.some((k) => k.lpId === lpId && k.role === 'primary')) : [];
  const secondary = lpId ? stories.filter((s) => s.links.some((k) => k.lpId === lpId)) : [];
  const pool = primary.length ? primary : secondary.length ? secondary : stories;
  if (!pool.length) return 'Add a story in the Library and Ask AI will tell this answer with it, with its real numbers.';
  const st = pool[skip % pool.length];
  const nums = st.numbers.map((n) => (n.label ? n.label + ' ' + n.value : n.value)).filter(Boolean);
  return [
    'Situation — ' + (st.situation || st.summary),
    'Task — ' + (st.task || 'It was mine to own, end to end.'),
    'Action — ' + (st.action || 'I took the riskiest part myself and kept the numbers in front of everyone.'),
    'Result — ' + (st.result || (nums.length ? nums.join(', ') + '.' : 'It landed, and it held.')),
  ].join('\n\n');
}

export const newRewriteId = (): string => 'rw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
