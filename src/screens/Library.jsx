// Library — LPs, stories, questions, files. One list per segment; desktop shows master-detail.
import React, { useState } from 'react';
import { Seg, VerdictChip, Switch, Dropzone, Icon } from '../components/ui.jsx';

export function LpList({ lps, onOpen, selected }) {
  return (
    <div className="list">
      {lps.map((l) => (
        <button key={l.id} className={'row' + (selected === l.id ? ' active' : '')} onClick={() => onOpen(l.id)}>
          <div className="stack grow" style={{ gap: 3 }}><span className="ellipsis" style={{ font: '700 14px/1.2 var(--font-sans)' }}>{l.name}</span><span className="sub" style={{ fontSize: 12, lineHeight: 1.2 }}>{l.stories} stories · {l.questions} questions · {l.last}</span></div>
          <VerdictChip code={l.verdict} />
        </button>
      ))}
    </div>
  );
}

export function StoryCards({ stories, onOpen, selected }) {
  return stories.map((s) => (
    <button key={s.id} className={'card pad stack g10' + (selected === s.id ? ' active' : '')} style={{ textAlign: 'left', cursor: 'pointer', width: '100%', background: selected === s.id ? 'var(--m-elev)' : undefined }} onClick={() => onOpen(s.id)}>
      <div className="hstack between" style={{ width: '100%', gap: 10 }}><span className="h3">{s.title}</span><VerdictChip code={s.best} /></div>
      <span className="sub pretty" style={{ lineHeight: 1.4 }}>{s.summary}</span>
      <div className="hstack wrap" style={{ gap: 6 }}>{s.numbers.map((n, i) => <span key={i} className="num">{n}</span>)}</div>
      <div className="hstack wrap" style={{ gap: 6, width: '100%' }}>{s.lpShorts.map((t, i) => <span key={i} className="chip">{t}</span>)}<span style={{ font: '400 11px/1 var(--font-sans)', color: s.uses >= 8 ? 'var(--m-gold)' : 'var(--m-fg3)', marginLeft: 'auto' }}>used {s.uses}×</span></div>
    </button>
  ));
}

export function QuestionList({ questions, more, onMore, onAsk, onAnswer, onRetag, lps }) {
  const [retag, setRetag] = useState(null);
  return (
    <div className="list">
      {questions.map((q) => (
        <div key={q.id} className="row stack g8" style={{ alignItems: 'stretch', padding: '12px 14px' }}>
          <button className="text-btn pretty" style={{ textAlign: 'left', font: '600 14px/1.35 var(--font-sans)' }} onClick={() => onAsk(q)}>{q.text}</button>
          <div className="hstack wrap" style={{ gap: 6 }}>
            {retag === q.id
              ? <select className="input" style={{ minHeight: 26, height: 26, padding: '0 8px', font: '500 12px var(--font-sans)', width: 'auto' }} autoFocus value={q.lp_id || ''} onBlur={() => setRetag(null)} onChange={(e) => { onRetag(q.id, e.target.value); setRetag(null); }}>
                  <option value="">Untagged</option>{lps.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              : <button className={'chip' + (q.lp_id ? '' : ' gold')} title="Change the LP" onClick={() => setRetag(q.id)}>{q.lpName}</button>}
            <span className="muted" style={{ font: '400 11px/1 var(--font-sans)' }}>{q.meta}</span>
            <button className="btn xxs cool-tint" style={{ marginLeft: 'auto' }} onClick={() => onAnswer(q)}>✦ Model answer</button>
          </div>
        </div>
      ))}
      {questions.length === 0 && <div className="row sub" style={{ justifyContent: 'center', padding: 20 }}>No questions match this filter.</div>}
      {more && <button className="row" style={{ justifyContent: 'center', font: '700 13px/1 var(--font-sans)', color: 'var(--m-cool)', padding: 12 }} onClick={onMore}>Show more</button>}
    </div>
  );
}

export function FileList({ files, onOpen, onToggle }) {
  return (
    <div className="list">
      {files.map((f) => (
        <div key={f.name} className="row" style={{ padding: '12px 14px', gap: 12 }}>
          <button className="text-btn stack g4 grow" style={{ textAlign: 'left' }} onClick={() => onOpen(f.name)}>
            <span className="mono ellipsis" style={{ font: '500 13px/1.2 var(--font-mono)', maxWidth: '100%' }}>{f.name}</span>
            <div className="hstack" style={{ gap: 6 }}><span className="chip plain" style={{ height: 20, padding: '0 7px' }}>{f.type}</span><span className="muted" style={{ font: '400 11px/1 var(--font-sans)' }}>{f.size} · {f.updated}</span></div>
          </button>
          <Switch checked={!!f.included} label={'Include ' + f.name} onChange={(on) => onToggle(f.name, on)} />
        </div>
      ))}
      {files.length === 0 && <div className="row sub" style={{ justifyContent: 'center', padding: 20 }}>No files yet. Drop your JD, background and past-loop notes above.</div>}
    </div>
  );
}

export default function Library(p) {
  const { lib, setLib, dbBadge, importing, importPct, importMsg } = p;
  return (
    <div className="screen">
      <div className="screen-head column">
        <div className="hstack between"><span className="h1">Library</span><span className="muted" style={{ font: '500 12px/1 var(--font-sans)' }}>{dbBadge}{importing && <> · importing bank {importPct}%</>}</span></div>
        <Seg value={lib} onChange={setLib} options={[['lps', 'LPs'], ['stories', 'Stories'], ['questions', 'Questions'], ['files', 'Files']]} />
      </div>
      <div className="screen-body">
        {lib === 'lps' && <LpList lps={p.lps} onOpen={p.onOpenLp} />}
        {lib === 'stories' && (
          <>
            <div className="hstack between"><span className="sub" style={{ font: '500 12px/1 var(--font-sans)' }}>{p.stories.length} stories · <span className="mono">{p.covered}/16</span> LPs covered</span><div className="hstack" style={{ gap: 6 }}><button className="btn sm" onClick={p.onAddStory}>+ Story</button><button className="btn sm" onClick={p.onOpenGrid}>Story × LP grid</button></div></div>
            <StoryCards stories={p.stories} onOpen={p.onOpenStory} />
          </>
        )}
        {lib === 'questions' && (
          <>
            <div className="filter-row">{p.qFilters.map((f) => <button key={f.k} className={'filter' + (f.on ? ' on' : '')} onClick={f.onPick}>{f.label}</button>)}</div>
            <div className="hstack between" style={{ flex: 'none' }}>
              <span className="sub" style={{ font: '500 12px/1.3 var(--font-sans)' }}>{p.questionShown} of {p.questionCount} · tap to ask it now · ✦ model answer</span>
              <div className="hstack" style={{ gap: 6 }}>
                <button className="btn xs" onClick={p.onAddQuestion}>+ Add</button>
                <label htmlFor="mock-bank" className="btn xs" style={{ cursor: 'pointer' }}>Import file<input id="mock-bank" type="file" accept=".zst,.json,.md,.txt,.csv" onChange={(e) => { p.onBankFiles(Array.from(e.target.files || [])); e.target.value = ''; }} style={{ display: 'none' }} /></label>
                <button className="btn xs ink" onClick={p.onImportBundled} disabled={importing}>Load full Exponent export</button>
              </div>
            </div>
            {importing && (
              <div className="tint cool stack g6" style={{ padding: '10px 12px', flex: 'none' }}>
                <div className="hstack between" style={{ font: '500 12px/1.2 var(--font-sans)', color: 'var(--m-cool)' }}><span>{importMsg}</span><span className="mono">{importPct}%</span></div>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--m-card)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: importPct + '%', background: 'var(--m-cool-fill)', transition: 'width .2s' }} /></div>
              </div>
            )}
            <QuestionList questions={p.questions} more={p.moreQuestions} onMore={p.onShowMore} onAsk={p.onAsk} onAnswer={p.onAnswer} onRetag={p.onRetag} lps={p.lps} />
          </>
        )}
        {lib === 'files' && (
          <>
            <Dropzone id="mock-files" title="Drop markdown here, or tap to browse" sub="Type is detected from content; questions inside are added to the bank." accept=".md,.txt,.csv,.json,.zst" onFiles={p.onBankFiles} />
            <FileList files={p.files} onOpen={p.onOpenFile} onToggle={p.onToggleFile} />
          </>
        )}
      </div>
    </div>
  );
}
