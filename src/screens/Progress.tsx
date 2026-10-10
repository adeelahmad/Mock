// Progress (board 4) — the LP × session heatmap with its NOW column, the weakest LPs with a
// Drill each, the average-verdict trend, readiness now and story usage. Phone: one column in
// the board's order (heatmap · legend · weakest · trend · readiness · usage). Desktop: the stat
// tiles sit in the head and the heatmap sits beside a 380 px column (weakest · trend · usage),
// as the Desktop progress artboard draws it.

import { useMemo, type CSSProperties } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { v } from '../components/ui.tsx';
import { daysUntil, verdictCounts, type HeatRow, type LpRow, type StoryRow } from '../domain/selectors.ts';
import { VERDICT_LABEL, verdictPoints } from '../domain/verdict.ts';
import type { Exchange, Session, Verdict } from '../domain/types.ts';
import '../styles/screens/progress.css';

// ---------- Derived values (ported from the prototype's renderVals) ----------

export interface TrendPoint { sessionNumber: number; avg: number | null }
export interface TrendDot { label: string; sessionNumber: number; avg: number | null; x: number; y: number }

/** Dots on the 320 × 110 trend chart: x spreads the window, y maps 4 (strong hire) → 20 … 1 → 110. */
export function trendDots(trend: TrendPoint[]): TrendDot[] {
  const step = 280 / Math.max(1, trend.length - 1);
  return trend.map((t, i) => ({ label: 'S' + t.sessionNumber, sessionNumber: t.sessionNumber, avg: t.avg, x: 20 + i * step, y: t.avg == null ? 50 : 20 + (4 - t.avg) * 30 }));
}

export type TrendNote = { text: string; dir: 'up' | 'down' | 'flat' } | null;
/** "↗ improving" when the latest average sits above the first one in the window. */
export function trendNote(trend: TrendPoint[]): TrendNote {
  const xs = trend.map((t) => t.avg).filter((a): a is number => a != null);
  if (xs.length < 2) return null;
  const d = xs[xs.length - 1] - xs[0];
  return d > 0.1 ? { text: '↗ improving', dir: 'up' } : d < -0.1 ? { text: '↘ slipping', dir: 'down' } : { text: '→ steady', dir: 'flat' };
}

/** Sum of session durations as h:mm ("6:20"). */
export function hoursPractised(sessions: Session[]): string {
  const sec = sessions.reduce((n, s) => (s.endedAt ? n + Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : n), 0);
  const m = Math.round(sec / 60);
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

/**
 * Weakest LPs: lowest readiness first, never-tested as 0.35 (readiness.ts), stalest first on a
 * tie. Local copy of selectors.weakestLps(), whose comparator has an operator-precedence bug
 * (`a - b || x === 0 ? 0 : …` parses as `(a - b || x === 0) ? 0 : …`, so every pair with
 * different readiness compares equal and the list comes back in LP order). Reported in sharedChanges.
 */
export function weakestRows(rows: LpRow[], n = 3): LpRow[] {
  const key = (r: LpRow) => r.readiness ?? 0.35;
  return rows.slice().sort((a, b) => key(a) - key(b) || (a.lastAt ?? '').localeCompare(b.lastAt ?? '') || a.order - b.order).slice(0, n);
}

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const ago = (iso: string | null, now = new Date()): string => {
  if (!iso) return 'never';
  const d = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days';
};

/** The "why" under a weakest LP: "never practised" · "no story · 12 days" · "● three sessions running" · "not inclined · last session". */
export function whyFor(lp: LpRow, row: HeatRow | undefined, now = new Date()): string {
  if (!lp.verdict) return 'never practised';
  if (lp.storyCount === 0) return 'no story · ' + ago(lp.lastAt, now);
  const seen = (row?.cells ?? []).map((c) => c.verdict).filter((x): x is Verdict => !!x).reverse();
  let streak = 0;
  for (const x of seen) { if (x === lp.verdict) streak++; else break; }
  if (streak >= 2 && (lp.verdict === 'not_inclined' || lp.verdict === 'strong_no_hire')) return v(lp.verdict).vGlyph + ' ' + (WORDS[streak] ?? String(streak)) + ' sessions running';
  return VERDICT_LABEL[lp.verdict].toLowerCase() + ' · ' + lp.lastLabel;
}

/** Position of the strongest answer for this LP inside the session (the History detail's ?q=N). */
export function answerIndex(exchanges: Exchange[], sessionId: string, lpId: string): number {
  const xs = exchanges.filter((e) => e.sessionId === sessionId).sort((a, b) => a.index - b.index);
  let best = -1, pts = 0;
  xs.forEach((e, i) => { if (e.lpId === lpId && e.verdict) { const p = verdictPoints(e.verdict); if (p > pts) { pts = p; best = i; } } });
  return best;
}

export interface UsageRow { story: StoryRow; pct: number }
/** Top stories by use; the bar is relative to the most-used one. */
export function storyUsage(rows: StoryRow[], n = 6): UsageRow[] {
  const max = rows.reduce((m, s) => Math.max(m, s.uses), 0);
  return rows.slice().sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title)).slice(0, n).map((story) => ({ story, pct: max ? Math.round((story.uses / max) * 100) : 0 }));
}

const daysCopy = (days: number, loop: boolean): string => (days === 0 ? (loop ? 'the loop is today' : 'interview today') : days + (days === 1 ? ' day' : ' days') + (loop ? ' to the loop' : ' to go'));

// ---------- Screen ----------

export default function Progress() {
  const { data, go, live } = useApp();
  const { lpRows, storyRows, sessions, exchanges, settings, heat, trend, covered } = data;

  const days = daysUntil(settings.interviewDate);
  const cnt = useMemo(() => verdictCounts(lpRows), [lpRows]);
  const total = Math.max(1, lpRows.length);
  const pct = (n: number) => (n / total) * 100;
  const weakest = useMemo(() => weakestRows(lpRows, 3), [lpRows]);
  const heatByLp = useMemo(() => new Map(heat.rows.map((r) => [r.lp.id, r])), [heat]);
  const dots = useMemo(() => trendDots(trend), [trend]);
  const note = useMemo(() => trendNote(trend), [trend]);
  const usage = useMemo(() => storyUsage(storyRows), [storyRows]);
  const overused = storyRows.filter((s) => s.overused).length;
  const hours = useMemo(() => hoursPractised(sessions), [sessions]);
  const sessionCount = sessions.length;
  const lpCount = lpRows.length || 16;

  const drill = (lp: LpRow) => { void live.start({ mode: 'lp', focus: lp.id, focusLabel: lp.name }); };
  const openCell = (lpId: string, sessionNumber: number) => {
    const s = sessions.find((x) => x.number === sessionNumber);
    if (!s) return;
    const i = answerIndex(exchanges, s.id, lpId);
    go(i >= 0 ? paths.session(s.id) + '?q=' + i : paths.session(s.id));
  };

  const plotted = dots.filter((d): d is TrendDot & { avg: number } => d.avg != null);
  const linePoints = plotted.map((d) => d.x + ',' + d.y).join(' ');
  const trendSummary = plotted.map((d) => d.label + ' ' + d.avg.toFixed(1)).join(', ');
  const cols = heat.columns;
  const gridStyle = { '--pg-cols': String(Math.max(1, cols.length)) } as CSSProperties;

  const tiles = (
    <div className="pg-tiles desk-only" role="group" aria-label="Summary">
      <div className="pg-tile"><span className="pg-tile-n">{covered.size}<span className="of">/{lpCount}</span></span><span className="pg-tile-l">LPs covered</span></div>
      <div className="pg-tile"><span className="pg-tile-n" style={{ color: 'var(--m-green)' }}>{cnt.strong}</span><span className="pg-tile-l">✓ strong hire</span></div>
      <div className="pg-tile"><span className="pg-tile-n" style={{ color: 'var(--m-gold)' }}>{cnt.notInclined}</span><span className="pg-tile-l">● not inclined</span></div>
      <div className="pg-tile"><span className="pg-tile-n">{hours}</span><span className="pg-tile-l">hours practised</span></div>
    </div>
  );

  const heatmap = (
    <div className="pg-heat" style={gridStyle} role="group" aria-label="Leadership Principle by session heatmap">
      <div className="pg-heat-row head">
        <span className="label pg-corner">LP × session</span>
        {cols.map((n) => <span key={n} className="pg-col">S{n}</span>)}
        <span className="pg-now-col">NOW</span>
      </div>
      {heat.rows.map((r) => {
        const now = v(r.now);
        return (
          <div key={r.lp.id} className="pg-heat-row">
            <button className="pg-lp" title={r.lp.name} onClick={() => go(paths.lp(r.lp.id))}>{r.lp.name}</button>
            {r.cells.map((c) => {
              const d = v(c.verdict);
              const title = r.lp.name + ' · session ' + c.sessionNumber + ' · ' + (c.verdict ? d.vLabel : 'not asked');
              return c.verdict
                ? <button key={c.sessionNumber} className="pg-cell" title={title} aria-label={title + ' · open the answer'} style={{ background: d.vFill, color: d.vOnFill }} onClick={() => openCell(r.lp.id, c.sessionNumber)}><span aria-hidden="true">{d.vGlyph}</span></button>
                : <span key={c.sessionNumber} role="img" className="pg-cell" title={title} aria-label={title} style={{ background: d.vFill, color: d.vOnFill }}><span aria-hidden="true">{d.vGlyph}</span></span>;
            })}
            <button className="pg-cell now" title={r.lp.name + ' · now · ' + now.vLabel} aria-label={r.lp.name + ' · now · ' + now.vLabel + ' · open the LP'} style={{ background: now.vFill, color: now.vOnFill, border: r.now ? '1px solid transparent' : '1px dashed var(--m-line2)' }} onClick={() => go(paths.lp(r.lp.id))}><span aria-hidden="true">{now.vGlyph}</span></button>
          </div>
        );
      })}
      {cols.length === 0 && <span className="pg-empty" style={{ paddingTop: 6 }}>No sessions yet — the heatmap fills in as you practise. Start one from Practice.</span>}
    </div>
  );

  const legend = (
    <div className="pg-legend phone-only" aria-hidden="true">
      <span><span style={{ color: 'var(--m-green)' }}>■</span> Strong</span>
      <span><span style={{ color: 'var(--m-blue)' }}>■</span> Inclined</span>
      <span><span style={{ color: 'var(--m-gold)' }}>■</span> Not inclined</span>
      <span><span style={{ color: 'var(--m-red)' }}>■</span> Strong no</span>
      <span style={{ color: 'var(--m-fg3)' }}>■ Not asked</span>
    </div>
  );

  const weakestPanel = weakest.length > 0 && (
    <div className="pg-weak">
      <span className="label gold">Weakest LPs</span>
      {weakest.map((lp) => (
        <div key={lp.id} className="pg-weak-row">
          <div className="pg-weak-text">
            <span className="pg-weak-name">{lp.name}</span>
            <span className="pg-weak-why">{whyFor(lp, heatByLp.get(lp.id))}</span>
          </div>
          <button className="pg-drill" onClick={() => drill(lp)} aria-label={'Drill ' + lp.name}>Drill</button>
        </div>
      ))}
    </div>
  );

  const trendCard = (
    <div className="pg-card">
      <div className="pg-card-head">
        <span className="label"><span className="phone-only">Trend · average verdict per session</span><span className="desk-only">Trend · average verdict</span></span>
        {note && <span className={'pg-note ' + note.dir}>{note.text}</span>}
      </div>
      <svg className="pg-trend" viewBox="0 0 320 110" role="img" aria-label={trendSummary ? 'Average verdict per session: ' + trendSummary : 'Average verdict per session: no sessions yet'}>
        {[20, 50, 80].map((y) => <line key={y} className="grid" x1="0" y1={y} x2="320" y2={y} />)}
        <text className="axis" x="0" y="16">Strong hire</text>
        <text className="axis" x="0" y="46">Inclined</text>
        <text className="axis" x="0" y="76">Not inclined</text>
        {linePoints && <polyline className="line" points={linePoints} />}
        {plotted.map((d) => <circle key={d.label} className="dot" cx={d.x} cy={d.y} r="4"><title>{d.label + ' · ' + d.avg.toFixed(2)}</title></circle>)}
        {dots.map((d) => <text key={d.label + '-l'} className="tick" x={d.x} y="106" textAnchor="middle">{d.label}</text>)}
      </svg>
      {!linePoints && <span className="pg-empty">Your first session draws the first point.</span>}
    </div>
  );

  const readinessCard = (
    <div className="pg-card phone-only">
      <span className="label">Readiness · now</span>
      <div className="pg-bar" role="img" aria-label={cnt.strong + ' strong hire, ' + cnt.inclined + ' inclined, ' + cnt.notInclined + ' not inclined, ' + cnt.no + ' strong no hire, ' + cnt.never + ' never practised'}>
        {cnt.strong > 0 && <span style={{ width: pct(cnt.strong) + '%', background: 'var(--m-green-fill)' }} />}
        {cnt.inclined > 0 && <span style={{ width: pct(cnt.inclined) + '%', background: 'var(--m-blue-fill)' }} />}
        {cnt.notInclined > 0 && <span style={{ width: pct(cnt.notInclined) + '%', background: 'var(--m-gold-fill)' }} />}
        {cnt.no > 0 && <span style={{ width: pct(cnt.no) + '%', background: 'var(--m-red-fill)' }} />}
        {cnt.never > 0 && <span style={{ width: pct(cnt.never) + '%', background: 'var(--m-line2)' }} />}
      </div>
      <div className="pg-counts">
        <div className="pg-count"><span className="pg-count-n" style={{ color: 'var(--m-green)' }}>{cnt.strong}</span><span className="pg-count-l">✓ strong</span></div>
        <div className="pg-count"><span className="pg-count-n" style={{ color: 'var(--m-blue)' }}>{cnt.inclined}</span><span className="pg-count-l">◆ inclined</span></div>
        <div className="pg-count"><span className="pg-count-n" style={{ color: 'var(--m-gold)' }}>{cnt.notInclined}</span><span className="pg-count-l">● not incl.</span></div>
        <div className="pg-count"><span className="pg-count-n" style={{ color: 'var(--m-fg3)' }}>{cnt.never}</span><span className="pg-count-l">○ never</span></div>
      </div>
    </div>
  );

  const usageCard = (
    <div className="pg-card">
      <div className="pg-card-head">
        <span className="label">Story usage</span>
        {overused > 0 && <span className="pg-over">{overused} over-used</span>}
      </div>
      {usage.map(({ story, pct: w }) => (
        <div key={story.id} className="pg-use">
          <button className={'pg-use-title' + (story.overused ? ' over' : '')} title={story.title + ' · used ' + story.uses + '×' + (story.overused ? ' · over-used' : '')} onClick={() => go(paths.story(story.id))}>{story.title}</button>
          <div className="pg-use-bar" aria-hidden="true"><span className={story.overused ? 'over' : ''} style={{ width: w + '%' }} /></div>
          <span className="pg-use-n" aria-label={'used ' + story.uses + ' times'}>{story.uses}</span>
        </div>
      ))}
      {usage.length === 0 && <span className="pg-empty">No stories yet — add one in the Library and the coach will track how often you reach for it.</span>}
    </div>
  );

  return (
    <div className="screen">
      <div className="screen-head pg-head">
        <div className="stack g4">
          <span className="h1">Progress</span>
          <span className="sub"><span className="phone-only">{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'} · {daysCopy(days, false)}</span><span className="desk-only">{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'} · {daysCopy(days, true)}</span></span>
        </div>
        {tiles}
      </div>
      <div className="screen-body">
        <div className="pg-cols">
          <div className="pg-main">
            {heatmap}
            {legend}
          </div>
          <div className="pg-side">
            {weakestPanel}
            {trendCard}
            {readinessCard}
            {usageCard}
          </div>
        </div>
      </div>
    </div>
  );
}
