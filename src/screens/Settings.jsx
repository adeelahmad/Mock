// Settings — Gemini Live, interview date, pause length, system instruction, appearance, library & data.
import React from 'react';
import { BackHead, Input, Select, Seg } from '../components/ui.jsx';

export default function Settings(p) {
  const { gem, gemStatus, models, voices, interviewDate, pauseMs, systemText, dbBadge, storageNote, recCount, ui } = p;
  const pauseLabel = (pauseMs / 1000).toFixed(2).replace(/0$/, '') + ' s';
  return (
    <div className="screen">
      <BackHead onBack={p.onBack} label="Practice" />
      <div className="screen-body" style={{ paddingTop: 6, gap: 18, paddingBottom: 40 }}>
        <span className="h1">Settings</span>

        <div className="stack g10"><span className="label">Gemini Live</span>
          <div className="card pad r12 stack g12">
            <Input label="API key" type="password" placeholder="AIza…" defaultValue={gem.key} onChange={(e) => p.setGem('key', e.target.value.trim())} hint="Stored only in this browser. Get one at aistudio.google.com." autoComplete="off" />
            <Select label="Live model" options={models} value={gem.model} onChange={(v) => p.setGem('model', v)} />
            <Select label="Interviewer voice" options={voices} value={gem.voice} onChange={(v) => p.setGem('voice', v)} />
            <div className="hstack" style={{ gap: 10 }}><button className="btn md cool" onClick={p.onTestGemini}>Test · say hello</button><span className="sub" style={{ font: '500 12px/1.3 var(--font-sans)' }}>{gemStatus}</span></div>
          </div>
        </div>

        <div className="stack g8"><span className="label">Interview</span>
          <div className="list r12">
            <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px', gap: 12 }}><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Interview date</span><input type="date" value={interviewDate} onChange={(e) => p.setSetting('interview_date', e.target.value)} /></div>
            <div className="row stack g8" style={{ alignItems: 'stretch', padding: '12px 14px' }}>
              <div className="hstack between baseline"><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Pause before my turn ends</span><span className="mono" style={{ font: '500 15px/1 var(--font-mono)' }}>{pauseLabel}</span></div>
              <input type="range" min="1000" max="4000" step="250" value={pauseMs} onChange={(e) => p.setSetting('pause_ms', e.target.value)} aria-label="Pause length" />
              <span className="sub" style={{ fontSize: 12, lineHeight: 1.45 }}>How long Mock waits in silence before it treats your answer as finished and shows “still listening”. The model’s own turn detection decides when the coach speaks.</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px', gap: 12 }}><div className="stack g2"><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Session seed</span><span className="sub" style={{ fontSize: 12 }}>Same seed, same questions and the same model take.</span></div><div className="hstack" style={{ gap: 6 }}><input type="number" className="seed" value={p.seed} onChange={(e) => p.setSetting('seed', String(parseInt(e.target.value, 10) || 12345))} aria-label="Seed" /><button className="btn sm" style={{ width: 36, padding: 0, borderRadius: '50%' }} aria-label="New seed" onClick={p.onNewSeed}>↻</button></div></div>
          </div>
        </div>

        <div className="stack g8">
          <div className="hstack between baseline"><span className="label">System instruction</span><button className="btn link" onClick={p.onResetSystem}>Reset</button></div>
          <Input multiline mono key={systemText.length} defaultValue={systemText} onBlur={(e) => p.onSystem(e.target.value)} style={{ minHeight: 160 }} hint="Sent to the interviewer and the coach on every session, after your stories and files. Saved on blur." />
        </div>

        <div className="stack g8"><span className="label">Appearance &amp; live screen</span>
          <div className="list r12">
            <div className="row stack g8" style={{ alignItems: 'stretch', padding: '12px 14px' }}><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Theme</span><Seg value={ui.theme} onChange={(v) => p.setUi('theme', v)} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]} /></div>
            <div className="row stack g8" style={{ alignItems: 'stretch', padding: '12px 14px' }}><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Voice visual</span><Seg value={ui.voice} onChange={(v) => p.setUi('voice', v)} options={[['orb', 'Orb'], ['wave', 'Wave'], ['ring', 'Ring']]} /></div>
            <div className="row stack g8" style={{ alignItems: 'stretch', padding: '12px 14px' }}><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Live layout</span><Seg value={ui.layout} onChange={(v) => p.setUi('layout', v)} options={[['stage', 'Stage'], ['transcript', 'Transcript'], ['split', 'Split']]} /></div>
          </div>
        </div>

        <div className="stack g8"><span className="label">Library &amp; data · {dbBadge}</span>
          <div className="list r12">
            <button className="row" style={{ justifyContent: 'space-between', padding: '12px 14px' }} onClick={p.onExport}><div className="stack g2"><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Back up everything</span><span className="sub" style={{ fontSize: 12 }}>All tables + settings as one JSON · {storageNote}</span></div><span className="btn link">Download</span></button>
            <label htmlFor="mock-restore" className="row" style={{ justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer' }}><div className="stack g2"><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Restore a backup</span><span className="sub" style={{ fontSize: 12 }}>A Mock JSON export · replaces the database</span></div><span className="btn link">Choose file</span><input id="mock-restore" type="file" accept=".json" onChange={p.onRestore} style={{ display: 'none' }} /></label>
            <button className="row" style={{ justifyContent: 'space-between', padding: '12px 14px' }} onClick={p.onExportRecordings}><div className="stack g2"><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Download recordings</span><span className="sub" style={{ fontSize: 12 }}>{recCount} session recordings kept in IndexedDB</span></div><span className="btn link">Download</span></button>
            <button className="row" style={{ justifyContent: 'space-between', padding: '12px 14px' }} onClick={p.onReplayOnboarding}><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Run first-run setup again</span><span className="btn link">Open</span></button>
            <button className="row" style={{ justifyContent: 'space-between', padding: '12px 14px', color: 'var(--m-red)' }} onClick={p.onResetAll}><span style={{ font: '500 14px/1.2 var(--font-sans)' }}>Reset to sample data</span><span className="muted" style={{ font: '400 12px/1 var(--font-sans)' }}>reloads</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}
