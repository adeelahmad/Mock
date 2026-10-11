// First run (board 5) — three steps: drop, say hello, start. One drop zone takes everything
// (files or a whole folder) and sorts it by content: stories, questions, the JD, notes from
// past loops. Mic, level and voice are one screen. Only the last step is required: Mock works
// with the LPs and the common bank, it just coaches less precisely. The choice is remembered
// in settings.onboarded and never re-asked ("Run first-run setup again" lives in Settings).

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Icon } from '../components/ui.tsx';
import Viz from '../components/Viz.tsx';
import { latestSessionNumber, type LpRow } from '../domain/selectors.ts';
import { practiceQueue } from '../domain/readiness.ts';
import type { HelloResult } from '../live/hello.ts';
import { KeyField, ModelField, VOICES, personaFor, useVoicePreview, importPrepFiles, importSummary, typeLabel, useHelloTest, keyClick, fmtPause, plural, type PrepImport } from './Settings.tsx';
import '../styles/screens/settings.css';

type Step = 1 | 2 | 3;

// ---------- Dropped folders: walk the directory entries (Chromium/Safari), else take the files ----------
function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null));
  const plain = Array.from(dt.files ?? []);
  if (!entries.some((e) => e && e.isDirectory)) return Promise.resolve(plain);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)).catch(() => null);
      if (f) out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej)).catch(() => []);
        if (!batch.length) break;
        for (const c of batch) if (!c.name.startsWith('.')) await walk(c);
      }
    }
  };
  return (async () => { for (const e of entries) if (e) await walk(e); return out; })();
}

function PrepDrop({ busy, onFiles }: { busy: boolean; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const take = (list: File[]) => { if (list.length) onFiles(list); };
  const dirAttr = { webkitdirectory: '' } as Record<string, string>;
  return (
    <div className={'dropzone ob-drop' + (over ? ' over' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void filesFromDrop(e.dataTransfer).then(take); }}>
      <label htmlFor="ob-files" className="ob-drop-main" role="button" tabIndex={0} onKeyDown={keyClick}>
        <span className="ob-drop-title">{busy ? 'Sorting…' : 'Drop files or a folder'}</span>
        <span className="ob-drop-sub">.md · .txt · .csv · .docx — anything, mixed</span>
        <input id="ob-files" type="file" multiple accept=".md,.markdown,.txt,.csv,.json,.docx,.zst" hidden disabled={busy} onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </label>
      <label htmlFor="ob-folder" className="ob-drop-link" role="button" tabIndex={0} onKeyDown={keyClick}>or pick a folder
        <input id="ob-folder" type="file" hidden disabled={busy} {...dirAttr} onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </label>
    </div>
  );
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const words = (n: number): string => WORDS[n] ?? String(n);
const joinAnd = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

export default function Onboarding() {
  const { data, repo, refresh, go, toast, gemini, setGemini, live, dbMode } = useApp();
  const { lps, lpRows, stories, questions, sessions, settings, covered } = data;
  const [step, setStep] = useState<Step>(1);
  const [info, setInfo] = useState<PrepImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState(gemini.key);
  useEffect(() => { setKeyDraft(gemini.key); }, [gemini.key]);
  const commitKey = () => { const k = keyDraft.trim(); if (k !== gemini.key) void setGemini({ key: k }); };
  const hello = useHelloTest();
  const preview = useVoicePreview();

  const nextN = latestSessionNumber(sessions) + 1;
  const persona = personaFor(gemini.voice) ?? VOICES[0];

  // The suggested drill: the top of the practice queue; on a fresh install, the first LP (in order) with a story and a question.
  const focus: LpRow | null = useMemo(() => {
    if (!lpRows.length) return null;
    if (!sessions.length) return lpRows.find((r) => r.storyCount && r.questionCount) ?? lpRows.find((r) => r.questionCount) ?? lpRows[0];
    const list = lpRows.map((r) => ({ lpId: r.id, readiness: r.readiness, latest: r.verdict, lastSessionNumber: r.lastSessionNumber, lastAt: r.lastAt, samples: r.readiness == null ? 0 : 1 }));
    const top = practiceQueue(list, new Date(), { limit: 1 })[0];
    return lpRows.find((r) => r.id === top?.lpId) ?? lpRows[0];
  }, [lpRows, sessions.length]);

  const yours = questions.filter((q) => q.source === 'custom' || q.source === 'previous').length;
  const untagged = questions.filter((q) => !q.lpIds.length).length;
  const gaps = Math.max(0, lps.length - covered.size);
  const laterParts = ['Interview date'];
  if (untagged) laterParts.push('the ' + (untagged === 1 ? 'one unchecked question tag' : words(untagged) + ' unchecked question tags'));
  if (gaps) laterParts.push('the ' + (gaps === 1 ? 'one LP gap' : words(gaps) + ' LP gaps'));
  const laterText = joinAnd(laterParts) + (laterParts.length > 1 ? ' are' : ' is') + ' waiting on the home tab — ' + (laterParts.length > 1 ? 'none of them block' : 'it does not block') + ' session ' + nextN + '.';
  const dbBadge = dbMode === 'duckdb' ? 'DuckDB-WASM ✓' : dbMode === 'memory' ? 'in-memory library' : 'starting';
  const gemBadge = gemini.hasKey ? 'Gemini Live configured · ' + gemini.model + ' · ' + persona.name : 'no Gemini key — the live screen runs the scripted demo';

  const onFiles = async (list: File[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await importPrepFiles(list, { repo, lps, stories, files: data.files });
      await refresh();
      setInfo((prev) => (prev ? {
        files: prev.files + r.files, skipped: [...prev.skipped, ...r.skipped], restored: prev.restored + r.restored,
        stories: { count: prev.stories.count + r.stories.count, lps: Math.max(prev.stories.lps, r.stories.lps), numbers: prev.stories.numbers + r.stories.numbers },
        questions: { count: prev.questions.count + r.questions.count, tagged: prev.questions.tagged + r.questions.tagged, toCheck: prev.questions.toCheck + r.questions.toCheck },
        types: [...prev.types, ...r.types],
      } : r));
      toast(importSummary(r));
    } finally { setBusy(false); }
  };
  const pickVoice = (p: typeof VOICES[number]) => { void setGemini({ voice: p.voice }); preview(p); };
  const finish = async () => { await repo.setSettings({ onboarded: true }); await refresh(); };
  const start = async () => {
    await finish();
    if (focus) await live.start({ mode: 'lp', focus: focus.id, focusLabel: focus.name });
    else go(paths.practice);
  };
  const explore = async () => { await finish(); go(paths.practice); };
  // "Later" leaves the setup unfinished: the home tab shows it again next time.
  const later = () => go(paths.library('lps'));

  return (
    <div className="screen onboarding">
      {step === 3 && <div className="ob-edge" aria-hidden="true" />}
      <div className="screen-head ob-head">
        <span className="wordmark">Mock</span>
        <div className="ob-dots" aria-label={'Step ' + step + ' of 3'} role="img">
          <span className="ob-dot on" /><span className={'ob-dot' + (step >= 2 ? ' on' : '')} /><span className={'ob-dot' + (step >= 3 ? ' warm' : '')} />
        </div>
      </div>

      <div className="screen-body ob-body">
        {step === 1 && (
          <>
            <div className="stack g8"><span className="ob-title">Your {lps.length} LPs are ready.</span><span className="ob-sub">Now drop whatever prep you have. Mock sorts it — stories, questions, your JD, notes from past loops.</span></div>
            <div className="ob-tiles">{lps.map((l) => <span key={l.id} className="ob-tile" title={l.name}>{l.short}</span>)}</div>
            <PrepDrop busy={busy} onFiles={(l) => void onFiles(l)} />
            {info && (
              <div className="list r12" aria-live="polite">
                <div className="ob-found-head"><span>Found in {plural(info.files, 'file')}</span><span className="ok">sorted automatically</span></div>
                {info.stories.count > 0 && <div className="ob-found-row"><span className="k">{plural(info.stories.count, 'story', 'stories')}</span><span className="v">mapped to {plural(info.stories.lps, 'LP')} · {plural(info.stories.numbers, 'number')}</span></div>}
                <div className="ob-found-row"><span className="k">{plural(info.questions.count, 'question')}</span><span className="v">{info.questions.count ? info.questions.tagged + ' tagged · ' + (info.questions.toCheck ? info.questions.toCheck + ' to check later' : 'by keyword, fix any in Library') : 'none found · the common bank still applies'}</span></div>
                {info.types.map((t, i) => <div key={t.name + i} className="ob-found-row"><span className="k">{typeLabel(t.type)}</span><span className="v">{t.sub}</span></div>)}
                {info.restored > 0 && <div className="ob-found-row"><span className="k">Mock export</span><span className="v">restored · library, sessions, settings</span></div>}
                {info.skipped.length > 0 && <div className="ob-found-row"><span className="k">{plural(info.skipped.length, 'file')} skipped</span><span className="v">.docx and .zst land in M2</span></div>}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="stack g8"><span className="ob-title">Say hello.</span><span className="ob-sub">Talk for a few seconds. This grants the microphone once, checks your earbuds and sets your level — sessions never ask again.</span></div>
            <div className="card ob-hello">
              <Viz kind="orb" who={hello.state === 'connecting' || hello.state === 'ok' ? 'me' : 'none'} size={120} />
              {hello.state === 'ok' ? (
                <div className="ob-hello-text">
                  <span className="ob-hello-title"><span style={{ color: 'var(--m-green)' }}>✓</span>Heard you</span>
                  <span className="ob-hello-sub">{helloSub(hello.result, settings.pauseMs)}</span>
                </div>
              ) : (
                <div className="ob-hello-text">
                  <button className="btn cool block" style={{ height: 48, fontSize: 15 }} disabled={hello.state === 'connecting'} onClick={() => hello.run(keyDraft)}>
                    {hello.state === 'connecting' ? 'Connecting…' : 'Say hello · test the connection'}
                  </button>
                  <span className="ob-hello-sub" role="status">{hello.text || 'One short turn with ' + persona.name + ' — mic, level and voice in one go.'}</span>
                </div>
              )}
            </div>
            <div className="card pad stack g12">
              <KeyField label="Gemini API key" value={keyDraft} onChange={setKeyDraft} onCommit={commitKey} hint="Kept in this browser only. Restrict the key to the Gemini API in Google AI Studio." />
              <ModelField />
              <span className="ob-nokey">No key? Skip — the live screen runs a scripted demo until you add one.</span>
            </div>
            <div className="stack g8"><span className="label">Who interviews you · tap to hear</span>
              <div className="ob-personas" role="radiogroup" aria-label="Who interviews you">
                {VOICES.map((p) => {
                  const on = p.voice === gemini.voice;
                  return (
                    <button key={p.voice} type="button" role="radio" aria-checked={on} className={'ob-persona' + (on ? ' on' : '')} onClick={() => pickVoice(p)}>
                      <span className="ob-persona-mono">{p.mono}</span><span className="ob-persona-name">{p.name}</span><span className="ob-persona-desc">{p.short}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="stack g8"><span className="ob-title">That’s it.</span><span className="ob-sub">Session {nextN} is short: up to three {focus?.name ?? 'LP'} questions, coaching after each. {persona.name} is ready when you are.</span></div>
            <div className="ob-stats">
              <div className="ob-stat"><span className="n">{lps.length}</span><span className="l">LPs · {covered.size} with a story</span></div>
              <div className="ob-stat"><span className="n">{questions.length}</span><span className="l">questions · {yours} yours</span></div>
            </div>
            <div className="ob-box tint cool"><span className="label cool">Later</span><span className="t">{laterText}</span></div>
            <div className="ob-box tint cool"><span className="label cool">Status</span><span className="t">{dbBadge} · {gemBadge}</span></div>
          </>
        )}
      </div>

      <div className="screen-foot ob-foot">
        {step === 1 && (
          <>
            <button className="btn lg ink" disabled={busy} onClick={() => setStep(2)}>Looks right</button>
            {!info && <button className="btn ghost" disabled={busy} onClick={() => setStep(2)}>Skip — start with the LPs and the question bank</button>}
          </>
        )}
        {step === 2 && <button className="btn lg ink" onClick={() => setStep(3)}>Next</button>}
        {step === 3 && (
          <>
            <button className="btn xl primary" onClick={() => void start()}><Icon.Mic size={22} style={{ strokeWidth: 2.2 }} />Start session {nextN}</button>
            <button className="btn ghost" onClick={() => void explore()}>Explore first</button>
            <button className="btn link later" onClick={later}>Later</button>
          </>
        )}
      </div>
    </div>
  );
}

/** The line under "Heard you": level and the pause measured from the hello turn (suggested, not applied). */
function helloSub(r: HelloResult | null, pauseMs: number): string {
  const level = r?.peakLevel == null ? 'level ok' : r.peakLevel < 0.08 ? 'level low — move the mic closer' : 'level ok';
  const pause = r?.suggestedPauseMs && r.suggestedPauseMs !== pauseMs ? 'from how you speak, try a ' + fmtPause(r.suggestedPauseMs) + ' pause in Settings' : 'pause length ' + fmtPause(pauseMs);
  return level[0].toUpperCase() + level.slice(1) + ' · ' + pause;
}
