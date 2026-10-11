// Mock — the session report. The verdicts (per LP and per interviewer) are arithmetic over the
// written cards and are never left to a model; the prose (summary, biggest improvement, the
// three fixes, story swaps, next focus) comes from the Flash call when there is a key, and
// from `localReport` otherwise or when that call fails. `normalizeReport` merges a model reply
// onto the local report so a partial or malformed reply still yields a complete one.

import type { Exchange, Interviewer, Lp, Report, Session, Story, Verdict } from './types.ts';
import { VERDICT_LABEL, verdictPoints } from './verdict.ts';

export interface ReportInput {
  session: Session;
  /** This session's exchanges, in order. */
  exchanges: Exchange[];
  /** Earlier sessions and their exchanges, for "biggest improvement". */
  previous: { session: Session; exchanges: Exchange[] }[];
  lps: Lp[];
  stories: Story[];
  now?: Date;
}

const POINT_VERDICT: Record<number, Verdict> = { 4: 'strong_hire', 3: 'inclined', 2: 'not_inclined', 1: 'strong_no_hire' };
/** The verdict of a mean of points, rounded toward the weaker verdict on a tie (a loop is only as strong as its doubts). */
export const meanVerdict = (vs: Verdict[]): Verdict => POINT_VERDICT[Math.max(1, Math.min(4, Math.floor(vs.reduce((n, v) => n + verdictPoints(v), 0) / vs.length + 0.49)))];

const lc = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);
const lpNameOf = (lps: Lp[], e: Exchange): string => lps.find((l) => l.id === e.lpId)?.name || e.analysis?.lp || 'Unmapped';
const lpKey = (lps: Lp[], e: Exchange): string => e.lpId ?? lpNameOf(lps, e);

/** Per LP: the mean of this session's verdicts on it, in the order first asked. */
export function lpVerdicts(exchanges: Exchange[], lps: Lp[]): Report['verdicts'] {
  const out = new Map<string, { lpId: string; lpName: string; vs: Verdict[] }>();
  for (const e of exchanges) {
    if (!e.verdict) continue;
    const k = lpKey(lps, e);
    const row = out.get(k) ?? { lpId: e.lpId ?? '', lpName: lpNameOf(lps, e), vs: [] };
    row.vs.push(e.verdict); out.set(k, row);
  }
  return Array.from(out.values()).map((r) => ({ lpId: r.lpId, lpName: r.lpName, verdict: meanVerdict(r.vs) }));
}

/** One vote per interviewer: the mean of the answers they heard, with the reason from the weakest of them. */
export function interviewerVotes(exchanges: Exchange[], lps: Lp[]): Report['votes'] {
  const by = new Map<string, { iv: Interviewer; xs: Exchange[] }>();
  for (const e of exchanges) {
    if (!e.verdict) continue;
    const row = by.get(e.interviewer.name) ?? { iv: e.interviewer, xs: [] };
    row.xs.push(e); by.set(e.interviewer.name, row);
  }
  return Array.from(by.values()).map(({ iv, xs }) => {
    const weakest = xs.slice().sort((a, b) => verdictPoints(a.verdict!) - verdictPoints(b.verdict!))[0];
    const verdict = meanVerdict(xs.map((e) => e.verdict!));
    const a = weakest.analysis;
    const reason = verdictPoints(verdict) >= 3 ? (a?.strength || 'Clear, owned answer.') : (a?.fixes[0] || 'Answer lacked the specifics to judge.');
    return { interviewer: iv, lpName: Array.from(new Set(xs.map((e) => lpNameOf(lps, e)))).join(', '), verdict, reason };
  });
}

/** The LP whose verdict rose the most against its last earlier attempt: "Dive Deep — not inclined → inclined". */
export function biggestImprovement(exchanges: Exchange[], previous: ReportInput['previous'], lps: Lp[]): string {
  const now = lpVerdicts(exchanges, lps);
  const earlier = previous.slice().sort((a, b) => b.session.number - a.session.number);
  let best: { name: string; from: Verdict; to: Verdict; d: number } | null = null;
  for (const r of now) {
    for (const p of earlier) {
      const before = lpVerdicts(p.exchanges.filter((e) => (r.lpId ? e.lpId === r.lpId : lpNameOf(lps, e) === r.lpName)), lps)[0];
      if (!before) continue;
      const d = verdictPoints(r.verdict) - verdictPoints(before.verdict);
      if (d > 0 && (!best || d > best.d)) best = { name: r.lpName, from: before.verdict, to: r.verdict, d };
      break;
    }
  }
  return best ? best.name + ' — ' + lc(VERDICT_LABEL[best.from]) + ' → ' + lc(VERDICT_LABEL[best.to]) : '';
}

/** Up to three fixes, weakest answers first, without repeats. */
export function topFixes(exchanges: Exchange[], n = 3): string[] {
  const ordered = exchanges.filter((e) => e.analysis).sort((a, b) => verdictPoints(a.verdict ?? 'inclined') - verdictPoints(b.verdict ?? 'inclined') || a.index - b.index);
  const seen = new Set<string>(); const out: string[] = [];
  // Round-robin: the first fix of each answer before anyone's second.
  for (let k = 0; k < 3 && out.length < n; k++) {
    for (const e of ordered) {
      const f = e.analysis!.fixes[k]; if (!f) continue;
      const key = f.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key); out.push(f);
      if (out.length >= n) break;
    }
  }
  return out;
}

export function storySwaps(exchanges: Exchange[], lps: Lp[]): Report['storySwaps'] {
  const out: Report['storySwaps'] = [];
  for (const e of exchanges) {
    const b = e.analysis?.betterStory; if (!b) continue;
    if (out.some((x) => x.useStory === b.title && x.lpName === lpNameOf(lps, e))) continue;
    out.push({ lpName: lpNameOf(lps, e), useStory: b.title, insteadOf: e.storyTitle ?? e.analysis?.storyUsed ?? null });
  }
  return out;
}

/** The weakest answer of the session names the next focus: its LP and its first fix. */
export function nextFocusOf(exchanges: Exchange[], lps: Lp[]): { text: string; lpId: string | null } {
  const weakest = exchanges.filter((e) => e.verdict).sort((a, b) => verdictPoints(a.verdict!) - verdictPoints(b.verdict!) || a.index - b.index)[0];
  if (!weakest) return { text: '', lpId: null };
  const fix = weakest.analysis?.fixes[0];
  return { text: lpNameOf(lps, weakest) + ' — ' + (fix ? lc(fix) : 'redo it with the numbers first.'), lpId: weakest.lpId };
}

const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');

export function localReport(input: ReportInput): Report {
  const xs = input.exchanges.slice().sort((a, b) => a.index - b.index);
  const judged = xs.filter((e) => e.verdict);
  const focus = nextFocusOf(xs, input.lps);
  const counts = (['strong_hire', 'inclined', 'not_inclined', 'strong_no_hire'] as Verdict[])
    .map((v) => [v, judged.filter((e) => e.verdict === v).length] as const).filter(([, n]) => n > 0)
    .map(([v, n]) => n + ' ' + lc(VERDICT_LABEL[v]));
  return {
    verdicts: lpVerdicts(xs, input.lps),
    votes: interviewerVotes(xs, input.lps),
    improvement: biggestImprovement(xs, input.previous, input.lps),
    fixes: topFixes(xs),
    storySwaps: storySwaps(xs, input.lps),
    nextFocus: focus.text,
    nextFocusLpId: focus.lpId,
    summary: judged.length ? plural(judged.length, 'answer') + ' · ' + counts.join(', ') + '.' : 'No answers were judged in this session.',
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/** A model reply (any shape) on top of the local report: prose from the model, verdicts from the cards. */
export function normalizeReport(raw: unknown, input: ReportInput): Report {
  const base = localReport(input);
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fixes = (Array.isArray(o.fixes) ? o.fixes : []).map(str).filter(Boolean).slice(0, 3);
  const reasons = new Map<string, string>();
  for (const v of Array.isArray(o.votes) ? o.votes : []) {
    const x = (v ?? {}) as Record<string, unknown>;
    if (str(x.interviewer) && str(x.reason)) reasons.set(str(x.interviewer).toLowerCase(), str(x.reason));
  }
  const swaps = (Array.isArray(o.storySwaps ?? o.story_swaps) ? (o.storySwaps ?? o.story_swaps) as unknown[] : []).flatMap((s) => {
    const x = (s ?? {}) as Record<string, unknown>;
    const st = input.stories.find((k) => k.title.toLowerCase() === str(x.useStory ?? x.use_story).toLowerCase());
    return st ? [{ lpName: str(x.lpName ?? x.lp) || '—', useStory: st.title, insteadOf: str(x.insteadOf ?? x.instead_of) || null }] : [];
  });
  const focusText = str(o.nextFocus ?? o.next_focus);
  const focusLp = focusText ? input.lps.find((l) => focusText.toLowerCase().startsWith(l.name.toLowerCase())) ?? input.lps.find((l) => focusText.toLowerCase().includes(l.name.toLowerCase())) : undefined;
  return {
    ...base,
    votes: base.votes.map((v) => ({ ...v, reason: reasons.get(v.interviewer.name.toLowerCase()) ?? reasons.get(v.interviewer.name.split(' ')[0].toLowerCase()) ?? v.reason })),
    improvement: str(o.improvement) || base.improvement,
    fixes: fixes.length ? fixes : base.fixes,
    storySwaps: swaps.length ? swaps : base.storySwaps,
    nextFocus: focusText || base.nextFocus,
    nextFocusLpId: focusText ? focusLp?.id ?? base.nextFocusLpId ?? null : base.nextFocusLpId ?? null,
    summary: str(o.summary) || base.summary,
  };
}
