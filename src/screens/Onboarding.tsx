// First run — drop → say hello → start. Three steps, choices remembered, never re-asked.
import React from 'react';
import { Input, Select, Dropzone } from '../components/ui.tsx';

export default function Onboarding(p) {
  const { step, lps, importInfo, gem, gemStatus, models, voices, nextN, focusLp, covered, questionCount, dbBadge, gemBadge } = p;
  const dot = (on, color) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? color : 'var(--m-line2)' }} />;
  return (
    <div className="screen">
      <div className="screen-head" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
        <span className="wordmark">Mock</span>
        <div className="hstack" style={{ gap: 6 }}>{dot(true, 'var(--m-fg)')}{dot(step >= 2, 'var(--m-fg)')}{dot(step >= 3, 'var(--m-warm-fill)')}</div>
      </div>
      <div className="screen-body" style={{ paddingTop: 28, gap: 18 }}>
        {step === 1 && (
          <>
            <div className="stack g8"><span style={{ font: '800 34px/1.05 var(--font-sans)', letterSpacing: '-.03em' }}>Your 16 LPs are ready.</span><span className="sub pretty" style={{ fontSize: 15, lineHeight: 1.5 }}>Now drop whatever prep you have. Mock sorts it — stories, questions, your JD, notes from past loops.</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 4 }}>{lps.map((l) => <span key={l.id} title={l.name} style={{ height: 30, borderRadius: 7, background: 'var(--m-card)', border: '1px solid var(--m-line)', display: 'grid', placeItems: 'center', font: '800 10px/1 var(--font-sans)' }}>{l.short}</span>)}</div>
            <Dropzone id="mock-files-ob" title="Drop files, or tap to browse" sub=".md · .txt · .csv — anything, mixed" accept=".md,.txt,.csv,.json,.zst" onFiles={p.onBankFiles} />
            {importInfo && (
              <div className="list r12">
                <div className="row label" style={{ justifyContent: 'space-between', padding: '10px 14px' }}><span>Found in {importInfo.files} files</span><span style={{ color: 'var(--m-green)', textTransform: 'none', letterSpacing: 0 }}>sorted automatically</span></div>
                <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px' }}><span style={{ font: '600 14px/1.2 var(--font-sans)' }}>{importInfo.questions} questions</span><span className="sub" style={{ fontSize: 12 }}>tagged by keyword · fix any in Library</span></div>
                <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px' }}><span style={{ font: '600 14px/1.2 var(--font-sans)' }}>{importInfo.types}</span><span className="sub" style={{ fontSize: 12 }}>included in prep</span></div>
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <div className="stack g8"><span style={{ font: '800 34px/1.05 var(--font-sans)', letterSpacing: '-.03em' }}>Connect your interviewer.</span><span className="sub pretty" style={{ fontSize: 15, lineHeight: 1.5 }}>Mock talks to you through Gemini Live. Paste a key from Google AI Studio, pick a voice, and say hello once — that grants the microphone for good.</span></div>
            <div className="card pad stack g12">
              <Input label="Gemini API key" type="password" placeholder="AIza…" defaultValue={gem.key} onChange={(e) => p.setGem('key', e.target.value.trim())} hint="Kept in this browser only." autoComplete="off" />
              <Select label="Live model" options={models} value={gem.model} onChange={(v) => p.setGem('model', v)} />
              <Select label="Voice" options={voices} value={gem.voice} onChange={(v) => p.setGem('voice', v)} />
              <button className="btn cool" style={{ fontSize: 15 }} onClick={p.onTestGemini}>Say hello · test the connection</button>
              <span className="sub" style={{ font: '500 12px/1.4 var(--font-sans)', textAlign: 'center' }}>{gemStatus}</span>
            </div>
            <span className="muted" style={{ font: '400 12px/1.4 var(--font-sans)', textAlign: 'center' }}>No key? Skip — the live screen runs a scripted demo until you add one.</span>
          </>
        )}
        {step === 3 && (
          <>
            <div className="stack g8"><span style={{ font: '800 34px/1.05 var(--font-sans)', letterSpacing: '-.03em' }}>That’s it.</span><span className="sub pretty" style={{ fontSize: 15, lineHeight: 1.5 }}>Session {nextN} is short: up to three {focusLp.name} questions, coaching after each. Put your earbuds in.</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="card stack g2" style={{ padding: '12px 14px', borderRadius: 12 }}><span className="mono" style={{ font: '500 22px/1 var(--font-mono)' }}>16</span><span className="sub" style={{ fontSize: 11 }}>LPs · {covered} with a story</span></div>
              <div className="card stack g2" style={{ padding: '12px 14px', borderRadius: 12 }}><span className="mono" style={{ font: '500 22px/1 var(--font-mono)' }}>{questionCount}</span><span className="sub" style={{ fontSize: 11 }}>questions in the bank</span></div>
            </div>
            <div className="tint cool hstack start" style={{ gap: 10, padding: '14px 16px' }}><span className="label cool" style={{ fontSize: 10, paddingTop: 2, whiteSpace: 'nowrap' }}>Status</span><span style={{ font: '400 13px/1.45 var(--font-sans)' }}>{dbBadge} · {gemBadge}</span></div>
          </>
        )}
      </div>
      <div className="screen-foot">
        {step === 1 && <button className="btn lg ink" style={{ maxWidth: 760 }} onClick={p.onNext}>{importInfo ? 'Looks right' : 'Skip — start with the sample library'}</button>}
        {step === 2 && <button className="btn lg ink" style={{ maxWidth: 760 }} onClick={p.onNext}>Next</button>}
        {step === 3 && <><button className="btn xl primary" style={{ maxWidth: 760 }} onClick={p.onStart}>Start session {nextN}</button><button className="btn ghost" style={{ height: 44, maxWidth: 760 }} onClick={p.onDone}>Explore first</button></>}
      </div>
    </div>
  );
}
