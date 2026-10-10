// Story × LP grid — one tap cycles none → primary → secondary. Gaps are gold.
import React from 'react';
import { BackHead } from '../components/ui.tsx';

export default function Grid({ lps, stories, coveredIds, covered, onBack, onCycle, embedded = false }) {
  const gaps = lps.filter((l) => !coveredIds.has(l.id)).map((l) => l.name);
  const over = stories.filter((s) => s.uses >= 8);
  const cols = `${embedded ? 220 : 88}px repeat(16,1fr)${embedded ? ' 60px' : ''}`;
  const cellH = embedded ? 36 : undefined;
  return (
    <div className="screen">
      {!embedded && <BackHead onBack={onBack} label="Stories" />}
      <div className="screen-body" style={{ paddingTop: embedded ? 24 : 6, gap: 14, paddingLeft: embedded ? undefined : 16, paddingRight: embedded ? undefined : 16 }}>
        <div className="stack g8" style={{ padding: '0 4px' }}>
          <span className="h2">Story × LP</span>
          <span className="sub" style={{ font: '500 13px/1.3 var(--font-sans)' }}><span className="mono" style={{ fontSize: 15, color: 'var(--m-fg)' }}>{covered}</span> of 16 LPs covered · one tap cycles none → primary → secondary</span>
          <div className="progress-bar"><span style={{ width: Math.round(covered / 16 * 100) + '%' }} /></div>
        </div>
        <div className="card r12 stack g4" style={{ padding: embedded ? '16px 20px' : '10px 8px', maxWidth: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: embedded ? 6 : 2, alignItems: 'end' }}>
            <span />
            {lps.map((l) => <span key={l.id} title={l.name} style={{ font: `700 ${embedded ? 11 : 8}px/1 var(--font-sans)`, color: coveredIds.has(l.id) ? 'var(--m-fg3)' : 'var(--m-gold)', textAlign: 'center', paddingBottom: 3 }}>{l.short}</span>)}
            {embedded && <span className="label" style={{ fontSize: 10, textAlign: 'right' }}>Used</span>}
          </div>
          {stories.map((s) => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: embedded ? 6 : 2, alignItems: 'center' }}>
              <span className="ellipsis" style={{ font: `600 ${embedded ? 14 : 10}px/1.1 var(--font-sans)`, paddingRight: 4, color: s.uses >= 8 ? 'var(--m-gold)' : undefined }}>{s.title}</span>
              {lps.map((l) => {
                const role = s.primary.includes(l.id) ? 'primary' : s.secondary.includes(l.id) ? 'secondary' : null;
                return <button key={l.id} title={s.title + ' × ' + l.name + (role ? ' · ' + role : '')} aria-label={s.title + ' × ' + l.name} onClick={() => onCycle(s.id, l.id, role)} style={{ aspectRatio: cellH ? undefined : '1', height: cellH, border: 'none', padding: 0, borderRadius: embedded ? 8 : 3, background: role === 'primary' ? 'var(--m-fg)' : 'var(--m-elev)', boxShadow: role === 'secondary' ? 'inset 0 0 0 2px var(--m-fg2)' : 'none', cursor: 'pointer' }} />;
              })}
              {embedded && <span className="mono" style={{ font: '500 12px/1 var(--font-mono)', color: s.uses >= 8 ? 'var(--m-gold)' : 'var(--m-fg3)', textAlign: 'right' }}>{s.uses}×</span>}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: embedded ? 6 : 2, marginTop: 2, alignItems: 'center' }}>
            <span className="label" style={{ fontSize: embedded ? 10 : 8 }}>gap</span>
            {lps.map((l) => <span key={l.id} style={{ height: 4, borderRadius: 2, background: coveredIds.has(l.id) ? 'transparent' : 'var(--m-gold-fill)' }} />)}
          </div>
        </div>
        <div className="hstack wrap" style={{ gap: 14, font: '500 11px/1.2 var(--font-sans)', color: 'var(--m-fg2)', padding: '0 4px' }}>
          <span className="hstack" style={{ gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--m-fg)' }} />Primary</span>
          <span className="hstack" style={{ gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, boxShadow: 'inset 0 0 0 2px var(--m-fg2)' }} />Secondary</span>
          <span className="hstack" style={{ gap: 5 }}><span style={{ width: 12, height: 4, borderRadius: 2, background: 'var(--m-gold-fill)' }} />No story yet</span>
        </div>
        {(over.length > 0 || gaps.length > 0) && (
          <div className={embedded ? 'two-col' : 'stack g10'}>
            {over.length > 0 && <div className="tint gold hstack start" style={{ gap: 10 }}><span className="label gold" style={{ paddingTop: 2, whiteSpace: 'nowrap' }}>Over-used</span><span style={{ font: '400 14px/1.45 var(--font-sans)' }}><strong>{over[0].title}</strong> covers {over[0].primary.length + over[0].secondary.length} LPs and was used {over[0].uses} times. Map a second story to its secondary LPs.</span></div>}
            {gaps.length > 0 && <div className="card hstack start" style={{ gap: 10, padding: '14px 16px', borderRadius: 12 }}><span className="label" style={{ paddingTop: 2, whiteSpace: 'nowrap' }}>Gaps</span><span style={{ font: '400 14px/1.45 var(--font-sans)' }}>{gaps.join(' · ')}. Tap a cell to map; the coach can suggest which of your stories stretch to them.</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}
