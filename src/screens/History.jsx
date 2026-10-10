// History — the session list and the session detail (recording, transcript, analysis cards).
import React from 'react';
import { BackHead, Seg, VerdictCell } from '../components/ui.jsx';
import AnalysisCard from '../components/AnalysisCard.jsx';

export function SessionList({ sessions, selected, onOpen }) {
  return (
    <div className="list">
      {sessions.map((s) => (
        <button key={s.n} className={'row' + (selected === s.n ? ' active' : '')} style={{ padding: '12px 14px', gap: 12 }} onClick={() => onOpen(s.n)}>
          <div className="stack g4 grow">
            <div className="hstack baseline"><span style={{ font: '700 14px/1.2 var(--font-sans)' }}>Session {s.n}</span><span className="sub" style={{ fontSize: 12 }}>{s.date}</span></div>
            <span className="sub ellipsis" style={{ fontSize: 12 }}>{s.mode} · <span className="mono">{s.duration}</span></span>
          </div>
          <div className="hstack" style={{ gap: 3 }}>{s.chips.map((c, i) => <VerdictCell key={i} code={c.vCode} size={16} font={9} style={{ width: 16 }} />)}</div>
        </button>
      ))}
      {sessions.length === 0 && <div className="row sub" style={{ justifyContent: 'center', padding: 20 }}>No sessions yet — run one from Practice.</div>}
    </div>
  );
}

export default function History({ sessions, selected, onOpen }) {
  return (
    <div className="screen">
      <div className="screen-head"><span className="h1">History</span><span className="muted" style={{ font: '500 12px/1 var(--font-sans)' }}>{sessions.length} sessions</span></div>
      <div className="screen-body"><SessionList sessions={sessions} selected={selected} onOpen={onOpen} /></div>
    </div>
  );
}

export function SessionDetail({ sess, answers, histTab, setHistTab, recUrl, turns, onBack, onExport, onDownloadRec, onDrill, onSaveBest, onPlay, embedded = false }) {
  return (
    <div className="screen">
      {!embedded && <BackHead onBack={onBack} label="History" right={<button className="btn sm" style={{ height: 36, marginRight: 8, fontSize: 13 }} onClick={onExport}>Export</button>} />}
      <div className="screen-body" style={{ paddingTop: embedded ? 24 : 6 }}>
        <div className="hstack between start">
          <div className="stack" style={{ gap: 3 }}><span className="h2">Session {sess.n}</span><span className="sub">{sess.date} · {sess.mode} · <span className="mono">{sess.duration}</span> · {answers.length} answers</span></div>
          {embedded && <button className="btn md" onClick={onExport}>Export</button>}
        </div>
        <div className="card stack g10" style={{ padding: '12px 14px' }}>
          <div className="hstack" style={{ gap: 6 }}>
            {answers.map((r, i) => <div key={i} className="stack grow" style={{ alignItems: 'center', gap: 5 }}><VerdictCell code={r.verdict} size={30} radius={8} font={13} style={{ width: '100%' }} /><span className="ellipsis" style={{ font: '700 10px/1 var(--font-sans)', color: 'var(--m-fg2)', maxWidth: '100%' }}>{r.lpShort}</span></div>)}
            {answers.length === 0 && <span className="sub">No answers were recorded in this session.</span>}
          </div>
          {!!sess.focus && <div className="hstack start" style={{ gap: 10, paddingTop: 10, borderTop: '1px solid var(--m-line)' }}><span className="label cool" style={{ fontSize: 10, paddingTop: 2, whiteSpace: 'nowrap' }}>Focus next</span><span style={{ font: '500 13px/1.35 var(--font-sans)' }}>{sess.focus}</span></div>}
        </div>
        {!!recUrl && (
          <div className="card stack g8" style={{ padding: '12px 14px' }}>
            <div className="hstack between"><span className="label">Your recording</span><button className="btn link" onClick={onDownloadRec}>Download</button></div>
            <audio controls src={recUrl} style={{ width: '100%' }} />
          </div>
        )}
        <Seg className="h34" value={histTab} onChange={setHistTab} options={[['transcript', 'Transcript'], ['analysis', 'Analysis · ' + answers.length]]} />
        {histTab === 'transcript' && (
          <div className="stack g8">
            {turns.map((t, i) => (
              <div key={i} className="turn" style={{ borderLeftColor: t.ai ? 'var(--m-warm-line)' : 'var(--m-line)' }}>
                <div className="stack g2"><span className="label" style={{ fontSize: 10, color: t.ai ? 'var(--m-warm)' : 'var(--m-fg3)' }}>{t.ai ? (sess.ivFirst || 'Interviewer') : 'You'}</span><span className="pretty" style={{ font: '400 13px/1.45 var(--font-sans)' }}>{t.text}</span></div>
              </div>
            ))}
            {turns.length === 0 && <span className="sub" style={{ textAlign: 'center', padding: 12 }}>No transcript stored for this session.</span>}
          </div>
        )}
        {histTab === 'analysis' && (
          <div className="stack g12">
            {answers.map((a, i) => <AnalysisCard key={a.id || i} data={a.card} compact={i > 0} onDrill={() => onDrill(a)} onSaveBest={() => onSaveBest(a)} onPlay={recUrl ? onPlay : undefined} />)}
            {answers.length === 0 && <span className="sub" style={{ textAlign: 'center', padding: 12 }}>No analysis for this session.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
