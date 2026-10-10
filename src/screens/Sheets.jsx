// Sheets — new session setup (3 decisions), the model answer, add question, add story.
import React, { useState } from 'react';
import { Sheet, Seg, Input, Select } from '../components/ui.jsx';

export function SetupSheet({ open, onClose, nextN, options, pick, setPick, coaching, setCoaching, seed, onSeed, onNewSeed, gem, onOpenSettings, onStart }) {
  return (
    <Sheet open={open} onClose={onClose} title={'Session ' + nextN} foot={<><span className="label">3 · Go</span><button className="btn xl primary" style={{ height: 60, fontSize: 17 }} onClick={onStart}>Start</button></>}>
      <div className="stack g8"><span className="label">1 · What</span>
        <div className="stack g8">
          {options.map((o) => (
            <button key={o.k} className="hstack" style={{ gap: 12, padding: '12px 14px', borderRadius: 14, border: pick === o.k ? '1.5px solid var(--m-warm-line)' : '1px solid var(--m-line)', background: pick === o.k ? 'var(--m-warm-tint)' : 'transparent', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => setPick(o.k)}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: o.iconBg, color: o.iconFg, display: 'grid', placeItems: 'center', font: '700 12px/1 var(--font-sans)', flex: 'none' }}>{o.icon}</span>
              <div className="stack grow" style={{ gap: 1 }}><span style={{ font: '700 14px/1.2 var(--font-sans)' }}>{o.title}</span><span className="sub" style={{ fontSize: 12 }}>{o.sub}</span></div>
              <span style={{ font: '700 14px/1 var(--font-sans)' }}>{pick === o.k ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="stack g8"><span className="label">2 · Coaching</span>
        <Seg className="tall" value={coaching} onChange={setCoaching} options={[['each', 'After each answer'], ['recap', 'Recap only']]} />
      </div>
      <div className="hstack between" style={{ gap: 10, padding: '12px 14px', borderRadius: 12, background: 'var(--m-bg)', border: '1px solid var(--m-line)' }}>
        <div className="stack g2"><span style={{ font: '700 12px/1.2 var(--font-sans)', color: 'var(--m-fg2)' }}>Session seed</span><span className="muted" style={{ font: '400 12px/1.3 var(--font-sans)' }}>Decides which questions come up and the model’s take. Same seed, same session.</span></div>
        <div className="hstack" style={{ gap: 6 }}><input type="number" className="seed" value={seed} onChange={(e) => onSeed(e.target.value)} aria-label="Seed" /><button className="btn sm" style={{ width: 36, padding: 0, borderRadius: '50%', fontSize: 16 }} aria-label="New seed" onClick={onNewSeed}>↻</button></div>
      </div>
      <div className="hstack between" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--m-bg)', border: '1px solid var(--m-line)' }}>
        <div className="stack g2"><span style={{ font: '700 12px/1.2 var(--font-sans)', color: 'var(--m-fg2)' }}>Remembered</span><span className="muted" style={{ font: '400 12px/1.3 var(--font-sans)' }}>Voice {gem.voice} · {gem.model}</span></div>
        <button className="btn link" onClick={onOpenSettings}>Change</button>
      </div>
    </Sheet>
  );
}

export function AnswerSheet({ ans, onClose, onRegen, onAskNow }) {
  return (
    <Sheet open={!!ans} onClose={onClose} tall zIndex={12} eyebrow={'✦ Model answer · seed ' + (ans ? ans.seed : '')} title="From your own stories"
      foot={<div className="hstack" style={{ gap: 8 }}><button className="btn cool grow" onClick={onRegen}>Another take · new seed</button><button className="btn grow" onClick={onAskNow}>Ask me this live</button></div>}>
      {ans && (
        <>
          <div className="pretty" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--m-bg)', borderLeft: '3px solid var(--m-cool-fill)', font: '600 14px/1.35 var(--font-sans)' }}>{ans.question}</div>
          {ans.loading && <div className="hstack sub" style={{ gap: 10, font: '500 13px/1.3 var(--font-sans)' }}><span className="spinner cool" />Writing a STAR answer from your stories…</div>}
          {!ans.loading && !!ans.text && <div className="pretty" style={{ font: '400 14px/1.6 var(--font-sans)', whiteSpace: 'pre-wrap' }}>{ans.text}</div>}
          {!!ans.sample && <div className="stack g4" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--m-bg)', border: '1px solid var(--m-line)' }}><span className="label" style={{ fontSize: 10 }}>Top community answer · Exponent</span><span className="sub" style={{ fontSize: 12, lineHeight: 1.5 }}>{ans.sample}</span></div>}
        </>
      )}
    </Sheet>
  );
}

export function AddQuestionSheet({ open, onClose, lps, defaultLp, onAdd }) {
  const [text, setText] = useState('');
  const [lp, setLp] = useState(defaultLp || '');
  const [source, setSource] = useState('custom');
  const [difficulty, setDifficulty] = useState('2');
  const ok = text.trim().length > 8;
  return (
    <Sheet open={open} onClose={onClose} title="Add a question" zIndex={14} foot={<button className="btn lg ink" disabled={!ok} onClick={() => { onAdd({ text: text.trim(), lp_id: lp, source, difficulty: +difficulty }); setText(''); }}>Add to the bank</button>}>
      <Input label="Question" multiline value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell me about a time you…" />
      <Select label="Leadership Principle" value={lp} onChange={setLp} options={[{ value: '', label: 'Untagged' }, ...lps.map((l) => ({ value: l.id, label: l.name }))]} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Select label="Source" value={source} onChange={setSource} options={[{ value: 'custom', label: 'Custom' }, { value: 'previous', label: 'Previous interview' }, { value: 'common', label: 'Common' }]} />
        <Select label="Difficulty" value={difficulty} onChange={setDifficulty} options={[{ value: '1', label: 'Easy' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Hard' }]} />
      </div>
    </Sheet>
  );
}

export function AddStorySheet({ open, onClose, lps, onAdd }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [lp, setLp] = useState('');
  const ok = title.trim().length > 2;
  return (
    <Sheet open={open} onClose={onClose} title="New story" zIndex={14} foot={<button className="btn lg ink" disabled={!ok} onClick={() => { onAdd({ title: title.trim(), summary: summary.trim(), lp }); setTitle(''); setSummary(''); }}>Create story</button>}>
      <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Payments outage" />
      <Input label="One-line summary" multiline value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Led a Sev-1 recovery on the card-payments path during Black Friday week." />
      <Select label="Primary LP" value={lp} onChange={setLp} options={[{ value: '', label: 'Map it in the grid later' }, ...lps.map((l) => ({ value: l.id, label: l.name }))]} />
      <span className="sub">STAR, learning and key numbers go in the editor once the story exists.</span>
    </Sheet>
  );
}
