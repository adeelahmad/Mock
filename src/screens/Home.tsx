// Practice home (board 1 · 3b, canonical) — Start is the screen. Mock already knows what you
// should practise: the suggested drill is the top of today's queue (readiness.ts), yesterday's
// weakest answer is one tap to redo, readiness is a strip. Below it, the "Today · N min" queue
// from 3a/3c: tap any row to start there.

import React, { useMemo } from 'react';
import { useApp, type AppData } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Icon, VerdictChip, v } from '../components/ui.tsx';
import Notices from '../components/Notices.tsx';
import { useOnline } from '../app/install.ts';
import { daysUntil, latestSessionNumber, type LpRow } from '../domain/selectors.ts';
import { practiceQueue, type LpReadiness, type QueueItem } from '../domain/readiness.ts';
import { VERDICT_LABEL } from '../domain/verdict.ts';
import type { Lp, Session } from '../domain/types.ts';
import '../styles/screens/home.css';

export interface QueueRow extends QueueItem { lp: LpRow }

/** The readiness list the queue ranks, taken from the derived LP rows. */
export const readinessList = (rows: LpRow[]): LpReadiness[] =>
  rows.map((r) => ({ lpId: r.id, readiness: r.readiness, latest: r.verdict, lastSessionNumber: r.lastSessionNumber, lastAt: r.lastAt, samples: r.readiness == null ? 0 : 1 }));

/** The LP the last report pointed at ("Dive Deep — quantify the blast radius…" → Dive Deep). */
export function lastFocusLpId(sessions: Session[], lps: Lp[]): string | null {
  const last = sessions.slice().sort((a, b) => b.number - a.number).find((s) => s.report);
  const id = last?.report?.nextFocusLpId;
  if (id && lps.some((l) => l.id === id)) return id;
  const text = last?.report?.nextFocus?.toLowerCase() ?? '';
  if (!text) return null;
  return lps.find((l) => text.startsWith(l.name.toLowerCase()))?.id ?? lps.find((l) => text.includes(l.name.toLowerCase()))?.id ?? null;
}

/** Today's practice queue: weakest first, the last report's focus pulled to the top. */
export function todayQueue(data: AppData, now = new Date()): QueueRow[] {
  const byId = new Map(data.lpRows.map((r) => [r.id, r]));
  const items = practiceQueue(readinessList(data.lpRows), now, { focusLpId: lastFocusLpId(data.sessions, data.lps), limit: 3 });
  return items.flatMap((q) => { const lp = byId.get(q.lpId); return lp ? [{ ...q, lp }] : []; });
}

/** "Not inclined · last session" · "Never practised" — the why under the drill title. */
export const focusWhy = (lp: LpRow): string => (lp.verdict ? VERDICT_LABEL[lp.verdict] + ' · ' + lp.lastLabel : 'Never practised');

const lc = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

const isYesterday = (iso: string, now = new Date()): boolean => {
  const d = new Date(iso); const y = new Date(now); y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
};

export default function Home() {
  const { data, go, gemini, live, openSheet } = useApp();
  const { lpRows, sessions, settings, weakest, covered } = data;
  const queue = useMemo(() => todayQueue(data), [data]);
  const focus: LpRow | null = queue[0]?.lp ?? lpRows[0] ?? null;
  const second = queue[1] ?? null;
  const nextN = latestSessionNumber(sessions) + 1;
  const daysLeft = daysUntil(settings.interviewDate);
  const latest = sessions.slice().sort((a, b) => b.number - a.number)[0] ?? null;
  const weakLp = weakest?.lpId ? lpRows.find((r) => r.id === weakest.lpId) ?? null : null;
  const totalMin = queue.reduce((n, q) => n + q.minutes, 0);
  const gaps = lpRows.length - covered.size;
  const coachingText = settings.coaching === 'recap_only' ? 'recap at the end' : 'coaching after each';
  // Live needs the network; the demo transport doesn't (plan: offline banner, Start disabled).
  const online = useOnline();
  const blocked = gemini.hasKey && !online;
  const liveHint = gemini.hasKey ? 'Live · ' + gemini.voice + ' · mic granted at setup' : 'Demo until you add a Gemini key in Settings';

  const startFocus = () => { if (focus) void live.start({ mode: 'lp', focus: focus.id, focusLabel: focus.name }); };
  const startLoop = () => { void live.start({ mode: 'loop' }); };
  const startWeak = () => { if (weakest) void live.start({ mode: 'question_set', focus: weakest.questionId ?? null, questionText: weakest.questionText, focusLabel: weakLp?.name ?? 'Weakest answer' }); };
  const startLp = (lp: LpRow) => { void live.start({ mode: 'lp', focus: lp.id, focusLabel: lp.name }); };

  return (
    <div className="screen">
      <div className="screen-head">
        <span className="wordmark">Mock</span>
        <div className="hstack">
          <span className="pill-warm" title={'Interview on ' + settings.interviewDate}>{daysLeft} days</span>
          <button className="icon-btn" aria-label="Settings" onClick={() => go(paths.settings)}><Icon.Settings size={22} /></button>
        </div>
      </div>
      <div className="screen-body" style={{ paddingTop: 18, gap: 14 }}>
        <div className="home-cols">
          <div className="home-col">
            <Notices online={online} />
            {/* Session N · chosen for you */}
            <div className="card warm pad-lg stack g14">
              <span className="label warm">Session {nextN} · chosen for you</span>
              <div className="stack g6">
                <span style={{ font: '800 30px/1.1 var(--font-sans)', letterSpacing: '-.025em' }}>{focus ? focus.name + ' drill' : 'Your first drill'}</span>
                <span className="sub pretty" style={{ fontSize: 14, lineHeight: 1.45 }}>
                  {focus ? focusWhy(focus) + ' · up to 3 questions · ' + coachingText + '.' : 'Up to 3 questions · ' + coachingText + '.'}
                  {second ? ' Then one ' + second.lp.name + ' question — ' + lc(second.reason) + '.' : ''}
                </span>
              </div>
              <button className="btn xl primary" style={{ gap: 12 }} onClick={startFocus} disabled={!focus || blocked}><Icon.Mic size={22} style={{ strokeWidth: 2.2 }} />Start</button>
              <div className="hstack" style={{ justifyContent: 'center', gap: 16, font: '700 13px/1 var(--font-sans)', color: 'var(--m-fg2)' }}>
                <button className="text-btn" onClick={() => openSheet('setup')}>Change</button>
                <span style={{ color: 'var(--m-line2)' }}>·</span>
                <button className="text-btn" onClick={startLoop} disabled={blocked}>Full loop · {settings.loopSize * 10} min</button>
              </div>
              <span className="muted" style={{ textAlign: 'center', font: '400 11px/1.3 var(--font-sans)' }}>{liveHint}</span>
            </div>

            {/* Fix your weakest answer */}
            {weakest && (
              <div className="card stack g10" style={{ padding: '14px 16px' }}>
                <div className="hstack between">
                  <span className="label">{latest && isYesterday(latest.startedAt) ? 'Fix yesterday’s weakest answer' : 'Fix your weakest answer'}</span>
                  <VerdictChip code={weakest.verdict} />
                </div>
                <span className="pretty" style={{ font: '600 14px/1.35 var(--font-sans)' }}>{weakest.questionText}</span>
                <button className="btn" onClick={startWeak} disabled={blocked}><Icon.Redo size={16} />Redo{weakLp ? ' · ' + weakLp.name : ' this answer'}</button>
              </div>
            )}
          </div>

          <div className="home-col">
            {/* Readiness strip */}
            <div className="readiness">
              <div className="hstack between baseline">
                <span className="label">Readiness</span>
                <button className="text-btn" style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--m-fg2)' }} onClick={() => go(paths.grid)} aria-label={covered.size + ' of ' + lpRows.length + ' covered, ' + gaps + ' gaps · open the story grid'}>
                  <span className="mono">{covered.size}/{lpRows.length || 16}</span> covered · <span style={{ color: 'var(--m-gold)' }}>{gaps} gaps</span>
                </button>
              </div>
              <div className="strip" aria-label="Readiness by Leadership Principle">
                {lpRows.map((r) => { const d = v(r.verdict); return <button key={r.id} title={r.name + ' · ' + d.vLabel} aria-label={r.name + ' · ' + d.vLabel} style={{ background: d.vFill }} onClick={() => go(paths.lp(r.id))} />; })}
              </div>
              <div className="strip-labels" aria-hidden="true">{lpRows.map((r) => <span key={r.id}>{r.short}</span>)}</div>
            </div>

            {/* Today · N min · tap any row to start there */}
            {queue.length > 0 && (
              <div className="stack g8">
                <span className="label">Today · {totalMin} min · tap any row to start there</span>
                <div className="list">
                  {queue.map((q) => { const d = v(q.lp.verdict); return (
                    <button key={q.lpId} className="row queue-row" onClick={() => startLp(q.lp)} disabled={blocked} aria-label={'Start ' + q.lp.name + ' · ' + q.minutes + ' min'}>
                      <span className="queue-tile" style={{ background: d.vFill, color: d.vOnFill }} aria-hidden="true">{d.vGlyph}</span>
                      <div className="stack g2 grow"><span style={{ font: '700 14px/1.2 var(--font-sans)' }}>{q.lp.name}</span><span className="sub" style={{ fontSize: 12, lineHeight: 1.2 }}>{q.reason}</span></div>
                      <span className="queue-mins">{q.minutes} min</span>
                      <svg viewBox="0 0 24 24" className="ic" style={{ width: 16, height: 16, color: 'var(--m-fg3)' }} aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                    </button>
                  ); })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
