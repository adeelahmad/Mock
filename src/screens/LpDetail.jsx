// LP detail — mapped stories, the question bank for this LP, verdict history, practise.
import React from 'react';
import { BackHead, VerdictChip, VerdictCell, v } from '../components/ui.jsx';

export default function LpDetail({ lp, lpStories, lpQs, lpHist, onBack, onOpenStory, onOpenGrid, onAsk, onAnswer, onStart, embedded = false }) {
  return (
    <div className="screen">
      {!embedded && <BackHead onBack={onBack} label="LPs" />}
      <div className="screen-body" style={{ paddingTop: embedded ? 24 : 6, gap: 16 }}>
        <div className="stack g8">
          <div className="hstack between" style={{ gap: 10 }}><span className="h2">{lp.name}</span><VerdictChip code={lp.verdict} size="md" /></div>
          <span className="sub pretty" style={{ fontSize: 14, lineHeight: 1.5 }}>{lp.descr}</span>
        </div>
        <div className={embedded ? 'two-col' : 'stack g16'}>
          <div className="stack g16">
            <div className="stack g8"><span className="label">Mapped stories · {lpStories.length}</span>
              <div className="list r12">
                {lpStories.map((s) => (
                  <button key={s.id} className="row" style={{ padding: '10px 12px' }} onClick={() => onOpenStory(s.id)}>
                    <div className="stack g2 grow"><span style={{ font: '700 13px/1.2 var(--font-sans)' }}>{s.title}</span><span className="mono sub" style={{ font: '500 11px/1.2 var(--font-mono)' }}>{s.numbers.join(' · ')}</span></div>
                    <span className="chip none" style={{ background: s.role === 'Primary' ? 'var(--m-fg)' : 'transparent', color: s.role === 'Primary' ? 'var(--m-card)' : 'var(--m-fg2)', border: s.role === 'Primary' ? '1px solid transparent' : '1px solid var(--m-line2)', letterSpacing: '.06em' }}>{s.role}</span>
                  </button>
                ))}
                <button className="row" style={{ padding: '10px 12px', font: '700 12px/1 var(--font-sans)', color: 'var(--m-cool)' }} onClick={onOpenGrid}>Map a story in the grid →</button>
              </div>
            </div>
            <div className="stack g8"><span className="label">Verdict history</span>
              <div className="card r12" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 4 }}>
                {lpHist.map((c, i) => <VerdictCell key={i} code={c.verdict} size={26} radius={6} font={11} title={'Session ' + c.session_n} />)}
                {lpHist.length === 0 && <span className="sub" style={{ gridColumn: '1 / -1' }}>Not practised yet.</span>}
              </div>
            </div>
          </div>
          <div className="stack g8"><span className="label">Question bank · {lpQs.length}</span>
            <div className="list r12">
              {lpQs.map((q) => { const d = v(q.last_verdict); return (
                <div key={q.id} className="row" style={{ padding: '10px 12px', gap: 8 }}>
                  <button className="text-btn grow pretty" style={{ textAlign: 'left', font: '400 13px/1.35 var(--font-sans)' }} onClick={() => onAsk(q)}>{q.text}</button>
                  <button className="none" aria-label="Model answer" style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--m-cool-line)', background: 'var(--m-cool-tint)', color: 'var(--m-cool)', font: '700 13px/1 var(--font-sans)', cursor: 'pointer' }} onClick={() => onAnswer(q)}>✦</button>
                  <span className="none" style={{ font: '700 11px/1 var(--font-sans)', color: d.vFg }}>{d.vGlyph}</span>
                </div>
              ); })}
              {lpQs.length === 0 && <div className="row sub" style={{ padding: 14 }}>No questions tagged yet. Tag some in Library → Questions.</div>}
            </div>
          </div>
        </div>
      </div>
      <div className="screen-foot"><button className="btn lg primary block" style={{ maxWidth: 760 }} onClick={onStart}>Practise this LP</button></div>
    </div>
  );
}
