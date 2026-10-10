// Mock — derived values the screens show, computed from the repository's reads. Pure
// functions so they are testable and so the DuckDB repo (M2) can replace any of them with SQL.

import type { Exchange, Lp, Question, Session, Story, Verdict } from './types.ts';
import { readinessFor, type LpReadiness, type VerdictSample } from './readiness.ts';
import { verdictPoints } from './verdict.ts';

export interface LpRow extends Lp {
  storyCount: number;
  questionCount: number;
  /** Latest verdict in the window, or null. */
  verdict: Verdict | null;
  readiness: number | null;
  lastSessionNumber: number | null;
  lastAt: string | null;
  /** "last session" · "session 12" · "never" */
  lastLabel: string;
}

export interface StoryRow extends Story {
  primary: string[];
  secondary: string[];
  lpShorts: string[];
  /** Exchanges that used this story. */
  uses: number;
  /** Best verdict seen with this story. */
  best: Verdict | null;
  lastUsedAt: string | null;
  overused: boolean;
}

export interface QuestionRow extends Question {
  lpName: string;
  lpShort: string;
  sourceLabel: string;
  diffLabel: string;
  askedLabel: string;
  meta: string;
}

export const SOURCE_LABEL: Record<Question['source'], string> = { previous: 'Previous interview', common: 'Common', custom: 'Custom', ai: 'AI' };
export const DIFF_LABEL = ['', 'Easy', 'Medium', 'Hard'];

export function verdictSamples(sessions: Session[], exchanges: Exchange[]): VerdictSample[] {
  const num = new Map(sessions.map((s) => [s.id, s.number]));
  return exchanges.filter((e) => e.verdict && e.lpId && num.has(e.sessionId)).map((e) => ({ lpId: e.lpId!, sessionNumber: num.get(e.sessionId)!, verdict: e.verdict!, at: e.endedAt ?? e.startedAt }));
}

export const latestSessionNumber = (sessions: Session[]): number => sessions.reduce((m, s) => Math.max(m, s.number), 0);

export function lpRows(lps: Lp[], stories: Story[], questions: Question[], sessions: Session[], exchanges: Exchange[]): LpRow[] {
  const latest = latestSessionNumber(sessions);
  const ready = readinessFor(verdictSamples(sessions, exchanges), lps.map((l) => l.id), latest);
  const byId = new Map(ready.map((r) => [r.lpId, r]));
  return lps.slice().sort((a, b) => a.order - b.order).map((l) => {
    const r = byId.get(l.id)!;
    return {
      ...l,
      storyCount: stories.filter((s) => s.links.some((k) => k.lpId === l.id)).length,
      questionCount: questions.filter((q) => q.lpIds.includes(l.id)).length,
      verdict: r.latest, readiness: r.readiness, lastSessionNumber: r.lastSessionNumber, lastAt: r.lastAt,
      lastLabel: r.lastSessionNumber == null ? 'never' : r.lastSessionNumber === latest ? 'last session' : 'session ' + r.lastSessionNumber,
    };
  });
}

export function storyRows(stories: Story[], lps: Lp[], exchanges: Exchange[]): StoryRow[] {
  const lp = new Map(lps.map((l) => [l.id, l]));
  return stories.map((s) => {
    const used = exchanges.filter((e) => e.storyId === s.id || (!e.storyId && e.storyTitle === s.title));
    const verdicts = used.map((e) => e.verdict).filter((v): v is Verdict => !!v);
    const best = verdicts.length ? verdicts.sort((a, b) => verdictPoints(b) - verdictPoints(a))[0] : null;
    const primary = s.links.filter((k) => k.role === 'primary').map((k) => k.lpId);
    const secondary = s.links.filter((k) => k.role === 'secondary').map((k) => k.lpId);
    const lastUsedAt = used.map((e) => e.endedAt ?? e.startedAt).sort().pop() ?? null;
    return { ...s, primary, secondary, lpShorts: [...primary, ...secondary].map((id) => lp.get(id)?.short ?? id), uses: used.length, best, lastUsedAt, overused: used.length >= 8 };
  }).sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title));
}

export function questionRows(questions: Question[], lps: Lp[]): QuestionRow[] {
  const lp = new Map(lps.map((l) => [l.id, l]));
  return questions.map((q) => {
    const first = q.lpIds[0] ? lp.get(q.lpIds[0]) : undefined;
    const askedLabel = q.timesAsked ? 'asked ' + q.timesAsked + '×' : 'not asked';
    const sourceLabel = SOURCE_LABEL[q.source];
    return { ...q, lpName: first?.name ?? 'Untagged', lpShort: first?.short ?? '—', sourceLabel, diffLabel: DIFF_LABEL[q.difficulty], askedLabel, meta: [sourceLabel, q.tags, askedLabel].filter(Boolean).join(' · ') };
  });
}

export const coveredLpIds = (stories: Story[]): Set<string> => new Set(stories.flatMap((s) => s.links.map((k) => k.lpId)));

export interface HeatCell { sessionNumber: number; verdict: Verdict | null }
export interface HeatRow { lp: Lp; cells: HeatCell[]; now: Verdict | null }

/** LP × session matrix over the last `cols` sessions (oldest → newest); the strongest verdict per cell. */
export function heatmap(lps: Lp[], sessions: Session[], exchanges: Exchange[], cols = 8): { columns: number[]; rows: HeatRow[] } {
  const nums = sessions.map((s) => s.number).sort((a, b) => a - b).slice(-cols);
  const byId = new Map(sessions.map((s) => [s.id, s.number]));
  const rowsReady = lpRows(lps, [], [], sessions, exchanges);
  const rows = lps.slice().sort((a, b) => a.order - b.order).map((lp) => ({
    lp,
    cells: nums.map((n) => {
      const vs = exchanges.filter((e) => e.lpId === lp.id && byId.get(e.sessionId) === n && e.verdict).map((e) => e.verdict!);
      const best = vs.length ? vs.sort((a, b) => verdictPoints(b) - verdictPoints(a))[0] : null;
      return { sessionNumber: n, verdict: best };
    }),
    now: rowsReady.find((r) => r.id === lp.id)?.verdict ?? null,
  }));
  return { columns: nums, rows };
}

/** Average verdict points per session (1..4), oldest → newest. */
export function trend(sessions: Session[], exchanges: Exchange[], cols = 8): { sessionNumber: number; avg: number | null }[] {
  const nums = sessions.map((s) => s.number).sort((a, b) => a - b).slice(-cols);
  const byId = new Map(sessions.map((s) => [s.id, s.number]));
  return nums.map((n) => {
    const xs = exchanges.filter((e) => byId.get(e.sessionId) === n && e.verdict).map((e) => verdictPoints(e.verdict!));
    return { sessionNumber: n, avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
  });
}

export function verdictCounts(rows: LpRow[]): { strong: number; inclined: number; notInclined: number; no: number; never: number } {
  return {
    strong: rows.filter((r) => r.verdict === 'strong_hire').length,
    inclined: rows.filter((r) => r.verdict === 'inclined').length,
    notInclined: rows.filter((r) => r.verdict === 'not_inclined').length,
    no: rows.filter((r) => r.verdict === 'strong_no_hire').length,
    never: rows.filter((r) => !r.verdict).length,
  };
}

/** Weakest LPs: lowest readiness first, never-tested in between (see readiness.ts). */
export function weakestLps(rows: LpRow[], n = 3): LpRow[] {
  const key = (r: LpRow) => (r.readiness ?? 0.35);
  return rows.slice().sort((a, b) => key(a) - key(b) || (b.lastAt ?? '').localeCompare(a.lastAt ?? '') === 0 ? 0 : (a.lastAt ?? '') < (b.lastAt ?? '') ? -1 : 1).slice(0, n);
}

/** The weakest answer of the latest session (the "Fix your weakest answer" card). */
export function weakestAnswer(sessions: Session[], exchanges: Exchange[]): Exchange | null {
  const latest = sessions.slice().sort((a, b) => b.number - a.number)[0];
  if (!latest) return null;
  const xs = exchanges.filter((e) => e.sessionId === latest.id && e.verdict);
  return xs.sort((a, b) => verdictPoints(a.verdict!) - verdictPoints(b.verdict!) || a.index - b.index)[0] ?? null;
}

export const daysUntil = (isoDate: string, now = new Date()): number => Math.max(0, Math.ceil((new Date(isoDate + 'T00:00:00').getTime() - now.getTime()) / 86400000));

export const fmtDuration = (session: Session): string => {
  if (!session.endedAt) return '—';
  const s = Math.max(0, Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000));
  return s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + ' min' : Math.round(s / 60) + ' min';
};

export const fmtSessionDate = (session: Session): string => new Date(session.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function sessionModeLabel(session: Session, lps: Lp[], stories: Story[]): string {
  const lp = session.focus ? lps.find((l) => l.id === session.focus) : null;
  const st = session.focus ? stories.find((s) => s.id === session.focus) : null;
  switch (session.mode) {
    case 'loop': return 'Full loop';
    case 'lp': return 'One LP · ' + (lp?.name ?? session.focus ?? '');
    case 'story': return 'Pressure-test · ' + (st?.title ?? session.focus ?? '');
    case 'question_set': return 'Question set · ' + (session.focus === 'previous' ? 'Previous interviews' : session.focus ?? '');
    case 'replay': return 'Replay · ' + (session.focus ?? '');
    case 'deep_dive': return 'Deep dive';
    case 'bar_raiser': return 'Bar raiser';
  }
}

export type { LpReadiness };
