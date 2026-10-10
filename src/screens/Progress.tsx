// Progress — LP × session heatmap, weakest LPs, readiness now, trend, story usage.
import React from 'react';
import { VerdictCell } from '../components/ui.tsx';

export default function Progress({ sessionCount, daysLeft, cols, heatRows, weakest, cnt, pct, trendDots, usage, onDrill, covered }) {
  const points = trendDots.map((d) => d.x + ',' + d.y).join(' ');
  const trendNote = trendDots.length >= 2 ? (trendDots[trendDots.length - 1].y < trendDots[0].y ? '↗ improving' : trendDots[trendDots.length - 1].y > trendDots[0].y ? '↘ slipping' : '→ flat') : '';
  return (
    <div className="screen">
      <div className="screen-head column" style={{ gap: 4 }}>
        <div className="hstack between">
          <div className="stack g4"><span className="h1">Progress</span><span className="sub">{sessionCount} sessions · {daysLeft} days to go</span></div>
          <div className="desk-only hstack" style={{ gap: 10 }}>
            {[[<><span>{covered}</span><span className="muted">/16</span></>, 'LPs covered', ''], [cnt.s, '✓ strong hire', 'var(--m-green)'], [cnt.n, '● not inclined', 'var(--m-gold)']].map(([n, l, c], i) => (
              <div key={i} className="card stack g2" style={{ padding: '10px 16px', borderRadius: 12 }}><span className="mono" style={{ font: '500 22px/1 var(--font-mono)', color: c || undefined }}>{n}</span><span className="sub" style={{ fontSize: 11 }}>{l}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="screen-body">
        <div className="two-col-wide" style={{ gap: 12, display: 'flex', flexDirection: 'column' }}>
          <div className="card stack g4" style={{ padding: 12 }}>
            <div className="heat" style={{ gridTemplateColumns: '96px repeat(' + cols.length + ',1fr) 28px', paddingBottom: 4 }}>
              <span className="label" style={{ fontSize: 9 }}>LP × session</span>
              {cols.map((c) => <span key={c} className="mono" style={{ font: '500 9px/1 var(--font-mono)', color: 'var(--m-fg3)', textAlign: 'center' }}>{c}</span>)}
              <span style={{ font: '700 9px/1 var(--font-sans)', textAlign: 'center', letterSpacing: '.04em' }}>NOW</span>
            </div>
            {heatRows.map((r) => (
              <div key={r.id} className="heat" style={{ gridTemplateColumns: '96px repeat(' + cols.length + ',1fr) 28px' }}>
                <span className="ellipsis" style={{ font: '600 10px/1.1 var(--font-sans)', paddingRight: 4 }}>{r.name}</span>
                {r.cells.map((c, i) => <VerdictCell key={i} code={c.verdict} glyph={false} title={r.name + ' · session ' + c.session_n + ' · ' + c.vLabel} />)}
                <VerdictCell code={r.verdict} title={r.name + ' · now'} />
              </div>
            ))}
            {cols.length === 0 && <span className="sub" style={{ padding: 8 }}>No sessions yet. The heatmap fills in as you practise.</span>}
          </div>
          <div className="stack g12">
            <div className="tint gold stack g10" style={{ padding: 14, borderRadius: 16 }}>
              <span className="label gold">Weakest LPs</span>
              {weakest.map((l) => (
                <div key={l.id} className="hstack" style={{ gap: 10 }}>
                  <div className="stack grow" style={{ gap: 1 }}><span style={{ font: '600 13px/1.2 var(--font-sans)' }}>{l.name}</span><span className="sub" style={{ fontSize: 11 }}>{l.vLabel} · {l.last}</span></div>
                  <button className="btn xs primary" onClick={() => onDrill(l.id)}>Drill</button>
                </div>
              ))}
            </div>
            <div className="card pad stack g10">
              <span className="label">Readiness · now</span>
              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
                <span style={{ width: pct.s + '%', background: 'var(--m-green-fill)' }} /><span style={{ width: pct.i + '%', background: 'var(--m-blue-fill)' }} /><span style={{ width: pct.n + '%', background: 'var(--m-gold-fill)' }} /><span style={{ width: pct.x + '%', background: 'var(--m-red-fill)' }} /><span style={{ width: pct.z + '%', background: 'var(--m-line2)' }} />
              </div>
              <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                {[[cnt.s, '✓ strong', 'var(--m-green)'], [cnt.i, '◆ inclined', 'var(--m-blue)'], [cnt.n, '● not incl.', 'var(--m-gold)'], [cnt.z, '○ never', 'var(--m-fg3)']].map(([n, l, c]) => (
                  <div key={l} className="stack g2"><span style={{ font: '500 20px/1 var(--font-mono)', color: c }}>{n}</span><span className="sub" style={{ fontSize: 11, fontFamily: 'var(--font-sans)' }}>{l}</span></div>
                ))}
              </div>
            </div>
            <div className="card pad stack g10">
              <div className="hstack between baseline"><span className="label">Trend · average verdict per session</span>{trendNote && <span style={{ font: '500 12px/1 var(--font-sans)', color: trendNote.startsWith('↗') ? 'var(--m-green)' : 'var(--m-fg3)' }}>{trendNote}</span>}</div>
              <svg viewBox="0 0 320 110" style={{ width: '100%', height: 110, display: 'block', overflow: 'visible' }} role="img" aria-label="Average verdict per session">
                {[20, 50, 80].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} style={{ stroke: 'var(--m-line)', strokeWidth: 1 }} />)}
                <text x="0" y="16" style={{ font: '500 9px var(--font-sans)', fill: 'var(--m-fg3)' }}>Strong hire</text><text x="0" y="46" style={{ font: '500 9px var(--font-sans)', fill: 'var(--m-fg3)' }}>Inclined</text><text x="0" y="76" style={{ font: '500 9px var(--font-sans)', fill: 'var(--m-fg3)' }}>Not inclined</text>
                <polyline points={points} style={{ fill: 'none', stroke: 'var(--m-cool-fill)', strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
                {trendDots.map((d) => <circle key={d.label} cx={d.x} cy={d.y} r="4" style={{ fill: 'var(--m-card)', stroke: 'var(--m-cool-fill)', strokeWidth: 2.5 }} />)}
                {trendDots.map((d) => <text key={d.label + 'l'} x={d.x} y="106" textAnchor="middle" style={{ font: '500 9px var(--font-mono)', fill: 'var(--m-fg3)' }}>{d.label}</text>)}
              </svg>
            </div>
            <div className="card pad stack g10">
              <div className="hstack between baseline"><span className="label">Story usage</span>{usage.some((u) => u.uses >= 8) && <span style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--m-gold)' }}>{usage.filter((u) => u.uses >= 8).length} over-used</span>}</div>
              {usage.map((u) => (
                <div key={u.title} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 28px', gap: 10, alignItems: 'center' }}>
                  <span className="ellipsis" style={{ font: '600 12px/1.2 var(--font-sans)', color: u.uses >= 8 ? 'var(--m-gold)' : 'var(--m-fg)' }}>{u.title}</span>
                  <div className="usage-bar"><span style={{ width: u.pct + '%', background: u.uses >= 8 ? 'var(--m-gold-fill)' : 'var(--m-fg2)' }} /></div>
                  <span className="mono sub" style={{ font: '500 11px/1 var(--font-mono)', textAlign: 'right' }}>{u.uses}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
