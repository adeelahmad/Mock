// Practice home — Start is the home screen. Mock already knows what you should practise.
import React from 'react';
import { Icon, VerdictChip } from '../components/ui.tsx';

export default function Home({ nextN, daysLeft, focusLp, focusWhy, liveHint, weak, lps, covered, onStartFocus, onOpenSheet, onStartLoop, onStartWeak, onOpenGrid, onOpenLp, onOpenSettings }) {
  return (
    <div className="screen">
      <div className="screen-head">
        <span className="wordmark">Mock</span>
        <div className="hstack">
          <span className="pill-warm">{daysLeft} days</span>
          <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}><Icon.Settings size={22} /></button>
        </div>
      </div>
      <div className="screen-body" style={{ paddingTop: 18, gap: 14 }}>
        <div className="card warm pad-lg stack g14">
          <span className="label warm">Session {nextN} · chosen for you</span>
          <div className="stack g6">
            <span style={{ font: '800 30px/1.1 var(--font-sans)', letterSpacing: '-.025em' }}>{focusLp.name} drill</span>
            <span className="sub" style={{ fontSize: 14, lineHeight: 1.45 }}>{focusWhy} · up to 3 questions · coaching after each.</span>
          </div>
          <button className="btn xl primary" style={{ gap: 12 }} onClick={onStartFocus}><Icon.Mic size={22} style={{ strokeWidth: 2.2 }} />Start</button>
          <div className="hstack" style={{ justifyContent: 'center', gap: 16, font: '700 13px/1 var(--font-sans)', color: 'var(--m-fg2)' }}>
            <button className="text-btn" onClick={onOpenSheet}>Change</button><span style={{ color: 'var(--m-line2)' }}>·</span><button className="text-btn" onClick={onStartLoop}>Full loop</button>
          </div>
          <span className="muted" style={{ textAlign: 'center', font: '400 11px/1.3 var(--font-sans)' }}>{liveHint}</span>
        </div>

        {weak && (
          <div className="card stack g10" style={{ padding: '14px 16px' }}>
            <div className="hstack between"><span className="label">Fix your weakest answer</span><VerdictChip code={weak.verdict} /></div>
            <span className="pretty" style={{ font: '600 14px/1.35 var(--font-sans)' }}>{weak.question}</span>
            <button className="btn" onClick={onStartWeak}><Icon.Redo size={16} />Redo · {weak.lp_name}</button>
          </div>
        )}

        <div className="readiness">
          <div className="hstack between baseline">
            <span className="label">Readiness</span>
            <button className="text-btn sub" style={{ font: '500 12px/1 var(--font-sans)' }} onClick={onOpenGrid}><span className="mono">{covered}/16</span> covered · <span style={{ color: 'var(--m-gold)' }}>{16 - covered} gaps</span></button>
          </div>
          <div className="strip">{lps.map((c) => <button key={c.id} title={c.name} aria-label={c.name + ' · ' + c.vLabel} style={{ background: c.vFill }} onClick={() => onOpenLp(c.id)} />)}</div>
          <div className="strip-labels">{lps.map((c) => <span key={c.id}>{c.short}</span>)}</div>
        </div>
      </div>
    </div>
  );
}
