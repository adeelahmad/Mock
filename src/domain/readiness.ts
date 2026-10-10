// Readiness per LP, computed from recent verdicts and weighted by recency.
//
// Why this shape: one bad attempt should not erase a trend, but the latest attempt should
// dominate, because that is what the next interviewer will hear. So each verdict is scored
// 4 (strong hire) … 1 (strong no hire), weighted by 0.5 ^ (sessionsAgo / HALF_LIFE): the
// most recent session counts fully, three sessions back counts half, six sessions back a
// quarter. Readiness is the weighted mean, normalised to 0..1. Only the last WINDOW sessions
// are considered; an LP never tested has readiness null (drawn gray, "Not yet").
//
// The queue ("Today's practice") ranks LPs by readiness ascending (weakest first), then by
// days since last practised (stalest first), with the last report's focus pulled to the top.

import type { Verdict } from './types.ts';
import { verdictPoints } from './verdict.ts';

export const HALF_LIFE_SESSIONS = 3;
export const WINDOW_SESSIONS = 8;

export interface VerdictSample { lpId: string; sessionNumber: number; verdict: Verdict; at: string }

export interface LpReadiness {
  lpId: string;
  /** 0..1, or null when never tested in the window. */
  readiness: number | null;
  /** The latest verdict (what the chip shows). */
  latest: Verdict | null;
  lastSessionNumber: number | null;
  lastAt: string | null;
  samples: number;
}

export function readinessFor(samples: VerdictSample[], lpIds: string[], latestSessionNumber: number): LpReadiness[] {
  return lpIds.map((lpId) => {
    const mine = samples
      .filter((s) => s.lpId === lpId && latestSessionNumber - s.sessionNumber < WINDOW_SESSIONS)
      .sort((a, b) => b.sessionNumber - a.sessionNumber || b.at.localeCompare(a.at));
    if (!mine.length) return { lpId, readiness: null, latest: null, lastSessionNumber: null, lastAt: null, samples: 0 };
    let num = 0, den = 0;
    for (const s of mine) {
      const w = Math.pow(0.5, (latestSessionNumber - s.sessionNumber) / HALF_LIFE_SESSIONS);
      num += w * verdictPoints(s.verdict);
      den += w;
    }
    const mean = num / den; // 1..4
    return { lpId, readiness: (mean - 1) / 3, latest: mine[0].verdict, lastSessionNumber: mine[0].sessionNumber, lastAt: mine[0].at, samples: mine.length };
  });
}

export interface QueueItem { lpId: string; reason: string; minutes: number }

/**
 * Today's practice queue. `focusLpId` is the last report's suggested focus (pulled first).
 * Never-tested LPs sort as readiness 0.35: below "inclined" but above a fresh "not inclined",
 * so a gap is drilled before a strong LP but after something that just went badly.
 */
export function practiceQueue(list: LpReadiness[], now: Date, opts: { focusLpId?: string | null; limit?: number; names?: Record<string, string> } = {}): QueueItem[] {
  const limit = opts.limit ?? 3;
  const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000)) : Infinity);
  const key = (r: LpReadiness) => (r.readiness ?? 0.35);
  const staler = (a: LpReadiness, b: LpReadiness) => { const da = days(a.lastAt), db = days(b.lastAt); return da === db ? 0 : db > da ? 1 : -1; };
  const sorted = [...list].sort((a, b) => key(a) - key(b) || staler(a, b) || a.lpId.localeCompare(b.lpId));
  const out: QueueItem[] = [];
  const reasonFor = (r: LpReadiness): string => {
    if (r.readiness == null) return 'Never practised';
    const d = days(r.lastAt);
    if (r.latest === 'strong_no_hire') return 'Strong no hire last time';
    if (r.latest === 'not_inclined') return 'Not inclined last time';
    if (d >= 5) return 'Not practised in ' + d + ' days';
    return r.latest === 'inclined' ? 'Inclined · push for strong hire' : 'Keep it sharp';
  };
  const minutesFor = (r: LpReadiness) => (r.readiness == null ? 15 : r.readiness < 0.5 ? 12 : 10);
  if (opts.focusLpId) {
    const f = list.find((r) => r.lpId === opts.focusLpId);
    if (f) out.push({ lpId: f.lpId, reason: 'Last session’s focus', minutes: minutesFor(f) });
  }
  for (const r of sorted) {
    if (out.length >= limit) break;
    if (out.some((o) => o.lpId === r.lpId)) continue;
    out.push({ lpId: r.lpId, reason: reasonFor(r), minutes: minutesFor(r) });
  }
  return out;
}
