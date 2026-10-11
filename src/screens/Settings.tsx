// Settings (board 5) — one scrolling screen the board shows in two halves: interview date and
// loop size, Gemini Live (key, model, "Test · say hello"), the interviewer voice list with
// preview, the pause slider, the system instruction (saved on blur), appearance and the live-
// screen tweaks, Library & data, and the version line. Everything has a default set during first
// run. Writes go through the repo, then refresh(). The data helpers (voices, models, backup,
// prep import, the hello test) are exported because Onboarding shares them.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Icon, Input, Select, Seg, download } from '../components/ui.tsx';
import { newId, type Repo } from '../db/repo.ts';
import type { Exchange, FileType, Lp, PrepFile, Question, QuestionSource, Session, Settings as SettingsRow, Story, TranscriptEvent, UiPrefs } from '../domain/types.ts';
import { daysUntil } from '../domain/selectors.ts';
import { detectFileType, parseExponentRows, parseQuestionsFromCsv, parseStoriesFromMarkdown, parsedQuestionsFromText, type ParsedQuestion } from '../domain/parsers.ts';
import { DEFAULT_SYSTEM_INSTRUCTION } from '../fixtures/sample.ts';
import '../styles/screens/settings.css';
import { BackupSheet, RestoreSheet } from './BackupSheets.tsx';
import { BudgetSettings } from '../components/Budget.tsx';

export { VOICES, personaFor, previewToast, MODELS, type VoicePersona } from '../domain/voices.ts';
import { VOICES, personaFor, previewToast, MODELS, type VoicePersona } from '../domain/voices.ts';
const OTHER = '__other__';

// ---------- Small formatters ----------
export { plural } from '../domain/prep-import.ts';
import { plural } from '../domain/prep-import.ts';
export const fmtBytes = (n: number): string => {
  if (n < 1024) return Math.max(0, Math.round(n)) + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  if (n < 1073741824) { const mb = n / 1048576; return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + ' MB'; }
  return (n / 1073741824).toFixed(1) + ' GB';
};
/** 2500 → "2.5 s", 2250 → "2.25 s", 1000 → "1 s". */
export const fmtPause = (ms: number): string => (ms / 1000).toFixed(2).replace(/\.?0+$/, '') + ' s';
/** "Thu 30 Oct 2026" */
export const fmtLongDate = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso || '—';
  return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + d.getDate() + ' ' + d.toLocaleDateString('en-GB', { month: 'short' }) + ' ' + d.getFullYear();
};
const today = (): string => new Date().toISOString().slice(0, 10);
const ext = (mime: string): string => (mime.includes('mp4') ? '.m4a' : mime.includes('ogg') ? '.ogg' : mime.includes('wav') ? '.wav' : '.webm');

export { importPrepFiles, importSummary, typeLabel, type PrepImport } from '../domain/prep-import.ts';
import { importPrepFiles, importSummary } from '../domain/prep-import.ts';
export { useHelloTest, useVoicePreview, type HelloState } from '../app/hello.ts';
import { useHelloTest, useVoicePreview } from '../app/hello.ts';
export { keyClick } from '../components/ui.tsx';
import { keyClick } from '../components/ui.tsx';

// ---------- Shared fields ----------
export function KeyField({ value, onChange, onCommit, label = 'API key', hint }: { value: string; onChange: (v: string) => void; onCommit: () => void; label?: string; hint: React.ReactNode }) {
  return (
    <Input label={label} type="password" placeholder="AIza…" value={value} autoComplete="off" spellCheck={false}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} onBlur={onCommit}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') onCommit(); }} hint={hint} />
  );
}

export function ModelField({ label = 'Live model' }: { label?: string }) {
  const { gemini, setGemini } = useApp();
  const known = MODELS.some((m) => m.value === gemini.model);
  const [other, setOther] = useState(!known);
  const [draft, setDraft] = useState(gemini.model);
  useEffect(() => { setDraft(gemini.model); if (!MODELS.some((m) => m.value === gemini.model)) setOther(true); }, [gemini.model]);
  const commit = () => { const id = draft.trim(); if (id && id !== gemini.model) void setGemini({ model: id }); };
  const options = [...MODELS, { value: OTHER, label: 'Other…' }];
  return (
    <div className="stack g6">
      <Select label={label} options={options} value={other ? OTHER : gemini.model}
        onChange={(v) => { if (v === OTHER) setOther(true); else { setOther(false); void setGemini({ model: v }); } }} />
      {other
        ? <Input mono label="Model id" value={draft} placeholder="gemini-…" spellCheck={false} hint="Any Gemini Live model id · saved on blur"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') commit(); }} />
        : <span className="model-id">{gemini.model}</span>}
    </div>
  );
}

const THEMES: [UiPrefs['theme'], string][] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
const VISUALS: [UiPrefs['voiceVisual'], string][] = [['orb', 'Orb'], ['wave', 'Wave'], ['ring', 'Ring']];
const LAYOUTS: [UiPrefs['liveLayout'], string][] = [['stage', 'Stage'], ['transcript', 'Transcript'], ['split', 'Split']];

// ---------- The screen ----------
export default function Settings() {
  const { data, repo, refresh, prefs, setPref, back, go, toast, gemini, setGemini, dbMode } = useApp();
  const { settings } = data;
  const [scrolled, setScrolled] = useState(false);

  // Gemini
  const [keyDraft, setKeyDraft] = useState(gemini.key);
  useEffect(() => { setKeyDraft(gemini.key); }, [gemini.key]);
  const commitKey = () => { const k = keyDraft.trim(); if (k !== gemini.key) void setGemini({ key: k }); };
  const hello = useHelloTest();
  const preview = useVoicePreview();

  // Pause slider: local value, written 150 ms after the last change.
  const [pause, setPause] = useState(settings.pauseMs);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!pauseTimer.current) setPause(settings.pauseMs); }, [settings.pauseMs]);
  useEffect(() => () => { if (pauseTimer.current) clearTimeout(pauseTimer.current); }, []);
  const onPause = (ms: number) => {
    setPause(ms);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => { pauseTimer.current = null; void repo.setSettings({ pauseMs: ms }).then(refresh); }, 150);
  };

  // System instruction: saved on blur.
  const [sys, setSys] = useState(settings.systemInstruction);
  useEffect(() => { setSys(settings.systemInstruction); }, [settings.systemInstruction]);
  const saveSys = async () => { if (sys === settings.systemInstruction) return; await repo.setSettings({ systemInstruction: sys }); await refresh(); toast('System instruction saved'); };
  const resetSys = async () => { setSys(DEFAULT_SYSTEM_INSTRUCTION); await repo.setSettings({ systemInstruction: DEFAULT_SYSTEM_INSTRUCTION }); await refresh(); toast('System instruction reset to the default'); };

  // Recordings + storage.
  const [recKeys, setRecKeys] = useState<string[]>([]);
  const [recBytes, setRecBytes] = useState(0);
  const [storage, setStorage] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      const keys = await repo.listBlobs('rec:');
      let bytes = 0;
      for (const k of keys) bytes += (await repo.getBlob(k))?.size ?? 0;
      if (alive) { setRecKeys(keys); setRecBytes(bytes); }
    })();
    return () => { alive = false; };
  }, [repo, data.sessions.length]);
  useEffect(() => {
    let alive = true;
    const est = typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function' ? navigator.storage.estimate() : null;
    if (!est) { setStorage(''); return; }
    const persisted = typeof navigator.storage.persisted === 'function' ? navigator.storage.persisted().catch(() => false) : Promise.resolve(false);
    Promise.all([est, persisted]).then(([{ usage = 0, quota = 0 }, p]) => {
      if (alive) setStorage(fmtBytes(usage) + ' used of ' + fmtBytes(quota) + (p ? ' · persistent' : ' · the browser may clear it under storage pressure — back up'));
    }).catch(() => { if (alive) setStorage(''); });
    return () => { alive = false; };
  }, [data]);
  const tablesBytes = useMemo(() => new Blob([JSON.stringify({ lps: data.lps, stories: data.stories, questions: data.questions, files: data.files, sessions: data.sessions, exchanges: data.exchanges, settings })]).size, [data, settings]);
  const exportSize = fmtBytes(tablesBytes + recBytes);
  const storeNote = dbMode === 'duckdb' ? 'kept in IndexedDB' : 'in memory only — this browser could not start the database';

  // Library & data actions.
  const [backupSheet, setBackupSheet] = useState<'backup' | 'export' | null>(null);
  const [restoring, setRestoring] = useState<File | null>(null);
  const isBackupFile = (f: File): boolean => /\.(zip|mockbackup)$/i.test(f.name);
  const restore = (list: File[]) => { const f = list[0]; if (f) setRestoring(f); };
  const importLibrary = async (list: File[]) => {
    const backups = list.filter(isBackupFile);
    if (backups.length) setRestoring(backups[0]);
    const rest = list.filter((f) => !isBackupFile(f));
    if (!rest.length) return;
    const r = await importPrepFiles(rest, { repo, lps: data.lps, stories: data.stories, files: data.files });
    await refresh();
    toast(importSummary(r) + (r.questions.count ? ' · tagged by keyword, fix any in Library' : ''));
  };
  const downloadRecs = async () => {
    if (!recKeys.length) { toast('No recordings yet — run a live session first.'); return; }
    for (const k of recKeys) { const b = await repo.getBlob(k); if (b) download('mock-' + k.replace(/[^a-z0-9_-]+/gi, '-') + ext(b.type), b); }
  };
  const setupAgain = async () => { await repo.setSettings({ onboarded: false }); await refresh(); go(paths.onboarding); };
  const loadSample = async () => { if (!confirm('Load the sample library? It replaces everything on this device.')) return; await repo.loadSample(); await refresh(); toast('Sample library loaded'); };
  const deleteAll = async () => {
    if (!confirm('Delete all data? Stories, questions, files, sessions and recordings on this device will be removed.')) return;
    if (!confirm('Really delete everything? This cannot be undone — export first if in doubt.')) return;
    await repo.reset();
    await refresh();
    toast('Everything on this device was deleted');
    go(paths.practice);
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>, fn: (files: File[]) => void) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; if (list.length) fn(list); };

  const pct = ((pause - 1000) / 3000) * 100;
  const lastBackup = settings.lastBackupAt ? ' · last ' + new Date(settings.lastBackupAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  return (
    <div className="screen settings">
      <div className="screen-head back settings-head">
        <button className="back-btn" onClick={() => back(paths.practice)}><Icon.Back />Practice</button>
        <span className={'settings-head-title' + (scrolled ? ' show' : '')} aria-hidden={!scrolled}>Settings</span>
        <span className="settings-head-spacer" />
      </div>
      <div className="screen-body" style={{ paddingTop: 6, gap: 18, paddingBottom: 40 }} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 48)}>
        <span className="h1">Settings</span>
        <div className="settings-cols">
          <div className="settings-col">
            {/* Interview */}
            <div className="stack g8"><span className="label">Interview</span>
              <div className="list r12">
                <label className="row srow date-row">
                  <span className="srow-title">Interview date</span>
                  <span className="srow-value">{fmtLongDate(settings.interviewDate)}<span className="days-pill">{daysUntil(settings.interviewDate)} d</span></span>
                  <input type="date" aria-label="Interview date" value={settings.interviewDate} onChange={(e) => { if (e.target.value) void repo.setSettings({ interviewDate: e.target.value }).then(refresh); }} />
                </label>
                <div className="row srow">
                  <span className="srow-title">Loop size</span>
                  <span className="loop-wrap">
                    <select className="loop-select" aria-label="Loop size" value={String(settings.loopSize)} onChange={(e) => void repo.setSettings({ loopSize: parseInt(e.target.value, 10) || 5 }).then(refresh)}>
                      <option value="4">4 interviewers · 1 bar raiser</option>
                      <option value="5">5 interviewers · 1 bar raiser</option>
                    </select>
                  </span>
                </div>
              </div>
            </div>

            {/* Gemini Live */}
            <div className="stack g8"><span className="label">Gemini Live</span>
              <div className="card pad r12 stack g12">
                <KeyField value={keyDraft} onChange={setKeyDraft} onCommit={commitKey} hint="Stored only in this browser. Restrict the key to the Gemini API in Google AI Studio." />
                <ModelField />
                <div className="gem-test">
                  <button className="btn md cool" onClick={() => hello.run(keyDraft)} disabled={hello.state === 'connecting'}>Test · say hello</button>
                  <span className={'gem-status' + (hello.state === 'ok' ? ' ok' : '')} role="status">{hello.text}</span>
                </div>
              </div>
            </div>

            {/* Interviewer voice */}
            <div className="stack g8"><span className="label">Interviewer voice · tap to preview</span>
              <div className="list r12" role="radiogroup" aria-label="Interviewer voice">
                {VOICES.map((p) => {
                  const on = p.voice === gemini.voice;
                  return (
                    <div key={p.voice} className={'voice-row' + (on ? ' on' : '')}>
                      <button type="button" className="voice-main" role="radio" aria-checked={on} onClick={() => void setGemini({ voice: p.voice })}>
                        <span className="voice-mono">{p.mono}</span>
                        <span className="voice-text"><span className="voice-name">{p.name}</span><span className="voice-desc">{p.desc}</span></span>
                      </button>
                      <button type="button" className="voice-play" aria-label={'Preview ' + p.name} onClick={() => preview(p)}><Icon.Play size={14} /></button>
                      <span className="voice-check" aria-hidden="true">{on ? '✓' : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pause */}
            <div className="pause-card">
              <div className="hstack between baseline"><span className="srow-title">Pause before my turn ends</span><span className="pause-value">{fmtPause(pause)}</span></div>
              <input type="range" className="pause" min={1000} max={4000} step={250} value={pause} aria-label="Pause before my turn ends" aria-valuetext={fmtPause(pause)}
                style={{ '--pct': pct + '%' } as React.CSSProperties} onChange={(e) => onPause(parseInt(e.target.value, 10))} />
              <div className="pause-ends"><span>1 s · sharper</span><span>4 s · calmer</span></div>
              <span className="pause-why">How long Mock waits in silence before treating your answer as finished and starting coaching. Set from your “say hello” check; you can always keep talking.</span>
            </div>
          </div>

          <div className="settings-col">
            {/* System instruction */}
            <div className="stack g8">
              <div className="hstack between baseline"><span className="label">System instruction</span><button className="btn link" onClick={() => void resetSys()}>Reset</button></div>
              <Input multiline mono className="sys-field" aria-label="System instruction" value={sys} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSys(e.target.value)} onBlur={() => void saveSys()}
                hint="Sent to the interviewer and the coach on every session, after your files. Saved on blur." />
            </div>

            {/* Appearance */}
            <div className="stack g8"><span className="label">Appearance</span>
              <Seg className="appear" value={prefs.theme} options={THEMES} onChange={(v) => setPref('theme', v)} />
              <div className="list r12">
                <div className="row pref-row"><span className="srow-title">Voice visual</span><Seg className="appear" value={prefs.voiceVisual} options={VISUALS} onChange={(v) => setPref('voiceVisual', v)} /></div>
                <div className="row pref-row"><span className="srow-title">Live layout</span><Seg className="appear" value={prefs.liveLayout} options={LAYOUTS} onChange={(v) => setPref('liveLayout', v)} /></div>
              </div>
            </div>

            <BudgetSettings />

            {/* Library & data */}
            <div className="stack g8"><span className="label">Library &amp; data</span>
              <div className="list r12">
                <button className="data-row" onClick={() => setBackupSheet('export')}>
                  <span className="data-text"><span className="srow-title">Export everything</span><span className="srow-sub">Library, sessions, audio · {exportSize}</span></span>
                  <Icon.Download size={18} />
                </button>
                <label className="data-row" htmlFor="settings-import" role="button" tabIndex={0} onKeyDown={keyClick}>
                  <span className="data-text"><span className="srow-title">Import library</span><span className="srow-sub">A Mock export, or markdown files</span></span>
                  <Icon.Upload size={18} />
                  <input id="settings-import" type="file" multiple accept=".zip,.mockbackup,.json,.zst,.md,.markdown,.txt,.csv" hidden onChange={(e) => pick(e, (l) => void importLibrary(l))} />
                </label>
                <button className="data-row" onClick={() => setBackupSheet('backup')}>
                  <span className="data-text"><span className="srow-title">Back up everything</span><span className="srow-sub">A zip of every table + settings · {storeNote}{lastBackup}</span></span>
                  <span className="link">Download</span>
                </button>
                <label className="data-row" htmlFor="settings-restore" role="button" tabIndex={0} onKeyDown={keyClick}>
                  <span className="data-text"><span className="srow-title">Restore a backup</span><span className="srow-sub">A Mock backup · replace or merge</span></span>
                  <span className="link">Choose file</span>
                  <input id="settings-restore" type="file" accept=".zip,.mockbackup,.json" hidden onChange={(e) => pick(e, restore)} />
                </label>
                <button className="data-row" onClick={() => void downloadRecs()}>
                  <span className="data-text"><span className="srow-title">Download recordings</span><span className="srow-sub">{plural(recKeys.length, 'session recording')} · {dbMode === 'duckdb' ? 'kept in IndexedDB' : 'in memory only'}</span></span>
                  <span className="link">Download</span>
                </button>
                <button className="data-row" onClick={() => void setupAgain()}>
                  <span className="srow-title">Run first-run setup again</span>
                  <span className="link">Open</span>
                </button>
                {import.meta.env.DEV && (
                  <button className="data-row" onClick={() => void loadSample()}>
                    <span className="data-text"><span className="srow-title">Load sample data</span><span className="srow-sub">Dev builds only · the invented library, 8 sessions</span></span>
                    <span className="link">Load</span>
                  </button>
                )}
                <button className="data-row danger" onClick={() => void deleteAll()}>
                  <span className="srow-title">Delete all data</span>
                  <span className="note">asks twice</span>
                </button>
              </div>
            </div>
          </div>

          {storage && <span className="foot-line">{storage}</span>}
          <span className="foot-line">Mock 0.9 · everything stays on this device unless you export it.</span>
        </div>
      </div>
      <BackupSheet open={!!backupSheet} onClose={() => setBackupSheet(null)} recordingsDefault={backupSheet === 'export'} recordingCount={recKeys.length} />
      <RestoreSheet file={restoring} onClose={() => setRestoring(null)} />
    </div>
  );
}
