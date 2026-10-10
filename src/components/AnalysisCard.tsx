// Mock — the analysis card. One per answer: verdict, better story, missed numbers,
// STAR split, I-vs-we, delivery, one strength and up to three fixes.
import React from 'react';
import { v, Icon } from './ui.tsx';

export default function AnalysisCard({ data, compact = false, onPlay, onDrill, onSaveBest, style }) {
  const a = data;
  const d = v(a.verdict);
  const star = a.star || { s: 25, t: 25, a: 25, r: 25 };
  const starNote = star.r < 20 ? 'Result thin — aim for 25%' : star.s > 30 ? 'Situation long — aim for 20%' : 'Balanced';
  const iNote = a.iPct < 50 ? 'Mostly “we” — own the actions' : 'Good — you own the actions';
  const sw = (bg) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: bg, marginRight: 6 }} />;
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, width: '100%', ...style }}>
      <div className="hstack start between" style={{ gap: 12 }}>
        <div className="stack g6 grow">
          <div className="label hstack" style={{ gap: 8 }}><span>{a.q}</span><span>·</span><span style={{ color: 'var(--m-cool)' }}>{a.lp}</span></div>
          <div className="pretty" style={{ font: '700 17px/1.3 var(--font-sans)', letterSpacing: '-.01em' }}>{a.question}</div>
          <div className="sub" style={{ lineHeight: 1.4 }}>Story used · <span style={{ color: 'var(--m-fg)', fontWeight: 500 }}>{a.story || '—'}</span></div>
        </div>
        <span className="chip md none" style={{ background: d.vBg, color: d.vFg, border: d.vBorder }}><span style={{ fontSize: 12 }}>{d.vGlyph}</span>{d.vLabel}</span>
      </div>
      {!!a.better && (
        <div className="tint cool hstack start" style={{ gap: 12 }}>
          <span className="label cool" style={{ paddingTop: 3, whiteSpace: 'nowrap' }}>Better story</span>
          <div className="stack g2 grow"><div style={{ font: '700 14px/1.3 var(--font-sans)' }}>{a.better}</div><div className="sub pretty" style={{ lineHeight: 1.4 }}>{a.reason}</div></div>
        </div>
      )}
      {(a.missed || []).length > 0 && (
        <div className="stack g8">
          <div className="label">Numbers you missed · notes → said</div>
          <div className="hstack wrap">
            {a.missed.map((m, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '4px 12px 4px 10px', borderRadius: 999, border: '1px solid var(--m-line)', background: 'var(--m-bg)', font: '500 13px/1.2 var(--font-sans)' }}>
                <span className="mono">{m.notes}</span><span className="muted">→</span><span style={{ color: 'var(--m-red)' }}>{m.said}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {!compact && (
        <div className="stack g14">
          <div className="stack g8">
            <div className="hstack between baseline"><span className="label">STAR · time split</span><span className="sub" style={{ fontSize: 12 }}>{starNote}</span></div>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
              <span style={{ width: star.s + '%', background: 'var(--m-line2)' }} /><span style={{ width: star.t + '%', background: 'var(--m-fg3)' }} /><span style={{ width: star.a + '%', background: 'var(--m-fg2)' }} /><span style={{ width: star.r + '%', background: 'var(--m-cool)' }} />
            </div>
            <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, font: '500 12px/1.2 var(--font-sans)', color: 'var(--m-fg2)' }}>
              <span>{sw('var(--m-line2)')}S {star.s}%</span><span>{sw('var(--m-fg3)')}T {star.t}%</span><span>{sw('var(--m-fg2)')}A {star.a}%</span><span>{sw('var(--m-cool)')}R {star.r}%</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="stack g8" style={{ padding: 12, borderRadius: 12, background: 'var(--m-bg)', border: '1px solid var(--m-line)' }}>
              <span className="label">I vs we</span>
              <div className="hstack baseline" style={{ gap: 6 }}><span className="mono" style={{ font: '500 24px/1 var(--font-mono)' }}>{a.iPct}%</span><span className="sub" style={{ fontSize: 12 }}>“I”</span></div>
              <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--m-line)' }}><span style={{ width: a.iPct + '%', background: 'var(--m-cool)' }} /></div>
              <span className="sub" style={{ fontSize: 12 }}>{iNote}</span>
            </div>
            <div className="stack g8" style={{ padding: 12, borderRadius: 12, background: 'var(--m-bg)', border: '1px solid var(--m-line)' }}>
              <span className="label">Delivery</span>
              <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                <div className="stack g2"><span style={{ font: '500 16px/1.1 var(--font-mono)' }}>{a.pace}</span><span className="sub" style={{ fontSize: 11 }}>wpm · {a.paceNote}</span></div>
                <div className="stack g2"><span style={{ font: '500 16px/1.1 var(--font-mono)' }}>{a.fillers}</span><span className="sub" style={{ fontSize: 11 }}>fillers</span></div>
                <div className="stack g2"><span style={{ font: '500 16px/1.1 var(--font-mono)' }}>{a.length}</span><span className="sub" style={{ fontSize: 11 }}>{a.lengthNote || 'length'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="stack g10">
        <div className="hstack start" style={{ gap: 10 }}>
          <span className="none" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--m-green-tint)', color: 'var(--m-green)', display: 'grid', placeItems: 'center', font: '700 12px/1 var(--font-sans)' }}>✓</span>
          <div className="stack g2"><span className="label green">Strength</span><span className="pretty" style={{ font: '400 14px/1.45 var(--font-sans)' }}>{a.strength}</span></div>
        </div>
        {(a.fixes || []).map((t, i) => (
          <div key={i} className="hstack start" style={{ gap: 10 }}>
            <span className="none mono" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--m-cool-tint)', color: 'var(--m-cool)', display: 'grid', placeItems: 'center', font: '700 12px/1 var(--font-sans)' }}>{i + 1}</span>
            <span className="pretty" style={{ font: '400 14px/1.45 var(--font-sans)', paddingTop: 2 }}>{t}</span>
          </div>
        ))}
      </div>
      <div className="hstack wrap" style={{ paddingTop: 14, borderTop: '1px solid var(--m-line)' }}>
        <button className="btn sm" style={{ height: 36 }} onClick={onPlay} disabled={!onPlay}><Icon.Play size={16} />Play answer <span className="mono sub" style={{ fontSize: 12 }}>{a.length}</span></button>
        <button className="btn sm" style={{ height: 36 }} onClick={onSaveBest} disabled={!onSaveBest}>Save as best attempt</button>
        <button className="btn sm cool-tint" style={{ height: 36 }} onClick={onDrill} disabled={!onDrill}>Drill {a.lp}</button>
      </div>
    </div>
  );
}
