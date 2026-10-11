// LP detail (board 3 · "LP detail · Dive Deep" and "Desktop library · LPs"): name + verdict chip,
// description, Edit (inline name/description → repo.updateLp), mapped stories with role chips
// (tap a chip to swap primary ↔ secondary, ✕ to unmap, "+ Add" to map an existing story or
// create one, "Map a story in the grid →"), the question bank for this LP (tap to ask it now,
// ✦ model answer, last-verdict glyph, "+ Add", "Upload" → import review), the verdict history
// of the last 8 sessions from data.heat, the best attempt (Play · session N · M:SS · story ·
// verdict · quote) and "Practise this LP". Desktop: 440 px LpList master + two-column detail.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { BackHead, Icon, Input, Sheet, VerdictChip, fmtClock, v } from '../components/ui.tsx';
import type { Exchange, LpRole, QuestionSource } from '../domain/types.ts';
import type { LpRow, QuestionRow, StoryRow } from '../domain/selectors.ts';
import { verdictPoints } from '../domain/verdict.ts';
import { fileKind, parseQuestionsFromCsv, parsedQuestionsFromText, type ParsedQuestion } from '../domain/parsers.ts';
import { LpList } from './Library.tsx';
import ImportReview, { prepareReview, type ReviewData } from './ImportReview.tsx';
import '../styles/screens/library-detail.css';

const PHONE_ROWS = 3;
const plural = (n: number, one: string, many = one + 's'): string => n + ' ' + (n === 1 ? one : many);
const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** "Practised today" · "Practised yesterday" · "Practised N days ago" · "Never practised". */
export const practisedLabel = (iso: string | null, now = new Date()): string => {
  if (!iso) return 'Never practised';
  const d = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86400000);
  return d <= 0 ? 'Practised today' : d === 1 ? 'Practised yesterday' : 'Practised ' + d + ' days ago';
};
const shorten = (s: string, max = 44): string => (s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');

/** The best attempt for an LP: the saved one, else the highest verdict (latest on a tie). */
export function bestAttempt(exchanges: Exchange[], lpId: string): Exchange | null {
  const mine = exchanges.filter((e) => e.lpId === lpId && e.verdict);
  if (!mine.length) return null;
  return mine.find((e) => e.isBest) ?? mine.slice().sort((a, b) => verdictPoints(b.verdict!) - verdictPoints(a.verdict!) || (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))[0];
}

const attemptSeconds = (e: Exchange): number | null => {
  if (e.endMs != null) return Math.max(0, Math.round((e.endMs - e.startMs) / 1000));
  if (e.endedAt) return Math.max(0, Math.round((Date.parse(e.endedAt) - Date.parse(e.startedAt)) / 1000));
  return null;
};

export default function LpDetail({ id }: { id: string }) {
  const { data, repo, refresh, go, toast, live, openSheet, dbMode } = useApp();
  const { lpRows, storyRows, questionRows, exchanges, sessions, heat } = data;
  const lp: LpRow | undefined = lpRows.find((l) => l.id === id);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picker, setPicker] = useState(false);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [playing, setPlaying] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { setEditing(false); setShowAll(false); setPicker(false); setReview(null); }, [id]);
  useEffect(() => () => { const a = audio.current; if (a) { a.pause(); URL.revokeObjectURL(a.src); audio.current = null; } }, []);

  // ---- derived
  const mapped = useMemo(() => storyRows.filter((s) => s.links.some((k) => k.lpId === id)).map((s) => ({ story: s, role: (s.primary.includes(id) ? 'primary' : 'secondary') as LpRole })), [storyRows, id]);
  const unmapped = useMemo(() => storyRows.filter((s) => !s.links.some((k) => k.lpId === id)), [storyRows, id]);
  const questions = useMemo(() => questionRows.filter((q) => q.lpIds.includes(id)), [questionRows, id]);
  const askedTotal = questions.reduce((n, q) => n + q.timesAsked, 0);
  const hist = heat.rows.find((r) => r.lp.id === id);
  const cells = hist?.cells ?? [];
  const best = useMemo(() => bestAttempt(exchanges, id), [exchanges, id]);
  const bestSession = best ? sessions.find((s) => s.id === best.sessionId) ?? null : null;
  const bestSecs = best ? attemptSeconds(best) : null;
  const bestRecording = !!(best?.clipKey || bestSession?.recordingKey);

  if (!lp) {
    return (
      <div className="screen">
        <BackHead onBack={() => go(paths.library('lps'))} label="LPs" />
        <div className="screen-body"><div className="card pad sub">That Leadership Principle is not in your library any more.</div></div>
      </div>
    );
  }

  // ---- actions
  const startEdit = () => { setName(lp.name); setDesc(lp.description); setEditing(true); };
  const saveEdit = async () => {
    const n = name.trim(), d = desc.trim();
    if (!n) { toast('Give the LP a name'); return; }
    if (n !== lp.name || d !== lp.description) { await repo.updateLp(id, { name: n, description: d }); await refresh(); toast('Saved ' + n); }
    setEditing(false);
  };
  const setRole = async (s: StoryRow, role: LpRole | null) => {
    await repo.setStoryLp(s.id, id, role); await refresh();
    toast(role ? s.title + ' · ' + role + ' for ' + lp.name : 'Unmapped ' + s.title + ' from ' + lp.name);
  };
  const mapExisting = async (s: StoryRow) => { setPicker(false); await setRole(s, mapped.length ? 'secondary' : 'primary'); };
  const askNow = (q: QuestionRow) => { void live.start({ mode: 'question_set', focus: q.id, questionText: q.text, focusLabel: lp.name }); };
  const practise = () => { void live.start({ mode: 'lp', focus: id, focusLabel: lp.name }); };
  const onUpload = async (list: File[]) => {
    const rows: ParsedQuestion[] = [];
    let source: QuestionSource = 'custom';
    for (const f of list) {
      const text = await f.text();
      const found = fileKind(f.name) === 'csv' ? parseQuestionsFromCsv(text, data.lps) : parsedQuestionsFromText(text, 'custom', data.lps);
      for (const r of found) {
        if (r.source === 'previous') source = 'previous';
        // Uploaded from this LP's bank: every row is tagged with this LP unless the file said otherwise.
        const tagged: ParsedQuestion = r.lpId && r.confidence === 'high' && r.lpId !== id ? r : { ...r, lpId: id, confidence: 'high', alternatives: r.alternatives.filter((a) => a !== id) };
        if (!rows.some((x) => x.text === tagged.text)) rows.push(tagged);
      }
    }
    if (!rows.length) { toast('No questions found in ' + list.map((f) => f.name).join(', ')); return; }
    setReview(prepareReview(rows, { fileName: list.length === 1 ? list[0].name : list[0].name + ' + ' + (list.length - 1) + ' more', source, existing: data.questions }));
  };
  const stopAudio = () => {
    const a = audio.current;
    if (!a) return;
    a.pause();
    URL.revokeObjectURL(a.src);
    audio.current = null;
  };
  const play = async () => {
    // M4: the clip player over the session recording (waveform, ±15 s). Here: play the blob when one exists.
    if (!best) return;
    if (playing) { stopAudio(); setPlaying(false); return; }
    const key = best.clipKey ?? bestSession?.recordingKey ?? null;
    const blob = key ? await repo.getBlob(key) : null;
    if (!blob) { toast('No recording for this attempt yet — recordings arrive in M4'); return; }
    stopAudio();
    const a = new Audio(URL.createObjectURL(blob));
    audio.current = a;
    a.onended = () => { setPlaying(false); stopAudio(); };
    setPlaying(true);
    await a.play().catch(() => { setPlaying(false); stopAudio(); toast('Could not play the recording'); });
  };

  if (review) return <ImportReview review={review} onCancel={() => setReview(null)} onSaved={(n) => { setReview(null); toast('Added ' + plural(n, 'question') + ' to ' + lp.name); }} />;

  const bestVerdict = best ? v(best.verdict) : null;
  const quote = best?.analysis?.strength ? '“' + shorten(best.analysis.strength) + '”' : '';
  const sessionNumbers = heat.columns;
  const histLabel = sessionNumbers.length ? 'sessions ' + sessionNumbers[0] + '–' + sessionNumbers[sessionNumbers.length - 1] : 'no sessions yet';

  const editButton = <button type="button" className="lpd-edit-btn" onClick={() => (editing ? void saveEdit() : startEdit())}>{editing ? 'Save' : 'Edit'}</button>;

  const detail = (
    <div className="lpd-detail">
      <div className="lpd-back"><BackHead onBack={() => go(paths.library('lps'))} label="LPs" right={editButton} /></div>
      <div className="screen-body lpd-body">
        <div className="lpd-top">
          {editing ? (
            <div className="lpd-edit-form">
              <Input className="title-field" label="Name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus style={{ width: '100%' }} />
              <Input label="Description" multiline rows={3} value={desc} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDesc(e.target.value)} hint="One line, in your own words — the coach reads it when it judges you." />
              <div className="hstack" style={{ gap: 8 }}>
                <button type="button" className="btn md ink" onClick={() => void saveEdit()}>Save</button>
                <button type="button" className="btn md ghost" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="lpd-top-text">
              <div className="lpd-title-row"><span className="lpd-title">{lp.name}</span><VerdictChip code={lp.verdict} size="md" style={{ flex: 'none' }} /></div>
              <span className="lpd-desc">{lp.description}</span>
              <span className="lpd-meta">{practisedLabel(lp.lastAt)} · {plural(questions.length, 'question')} · asked {askedTotal} {askedTotal === 1 ? 'time' : 'times'}</span>
            </div>
          )}
          <div className="lpd-actions">
            <button type="button" className="btn md" style={{ height: 40, fontSize: 14 }} onClick={() => (editing ? void saveEdit() : startEdit())}>{editing ? 'Save' : 'Edit'}</button>
            <button type="button" className="btn md primary" style={{ height: 40, fontSize: 14, padding: '0 18px' }} onClick={practise}>Practise this LP</button>
          </div>
        </div>

        <div className="lpd-cols">
          {/* ---- mapped stories */}
          <section className="lpd-sec stories" aria-label="Mapped stories">
            <div className="lpd-sec-head"><span className="label">Mapped stories · {mapped.length}</span><button type="button" className="lpd-link" onClick={() => setPicker(true)}>+ Add</button></div>
            <div className="list r12">
              {mapped.map(({ story, role }) => (
                <div key={story.id} className="lpd-story-row">
                  <button type="button" className="lpd-story-main" onClick={() => go(paths.story(story.id))}>
                    <span className="lpd-story-title">{story.title}</span>
                    {story.numbers.length > 0 && <span className="lpd-story-nums">{story.numbers.map((n) => (n.label ? n.label + ' ' + n.value : n.value)).join(' · ')}</span>}
                  </button>
                  <button type="button" className={'role-chip ' + role} title={role === 'primary' ? 'Make it secondary' : 'Make it primary'} aria-label={story.title + ' · ' + role + ' · tap to make it ' + (role === 'primary' ? 'secondary' : 'primary')} onClick={() => void setRole(story, role === 'primary' ? 'secondary' : 'primary')}>{role}</button>
                  <button type="button" className="lpd-x" aria-label={'Remove ' + story.title + ' from ' + lp.name} title="Remove" onClick={() => void setRole(story, null)}><Icon.Close size={14} /></button>
                </div>
              ))}
              {mapped.length === 0 && <div className="lpd-empty">No story answers this LP yet. Map one below, or add a story.</div>}
              <button type="button" className="lpd-grid-link" onClick={() => go(paths.grid)}>Map a story in the grid →</button>
            </div>
          </section>

          {/* ---- question bank */}
          <section className="lpd-sec questions" aria-label="Question bank">
            <div className="lpd-sec-head">
              <span className="label">Question bank · {questions.length}</span>
              <span className="lpd-sec-links">
                <button type="button" className="lpd-link" onClick={() => openSheet('addQuestion')}>+ Add</button>
                <button type="button" className="lpd-link" onClick={() => upload.current?.click()}>Upload</button>
              </span>
            </div>
            <div className="list r12">
              {questions.map((q, i) => {
                const d = v(q.lastVerdict);
                return (
                  <div key={q.id} className={'lpd-q-row' + (i >= PHONE_ROWS ? ' lpd-q-extra' + (showAll ? ' open' : '') : '')}>
                    <button type="button" className="lpd-q-text" title="Ask me this now" onClick={() => askNow(q)}>{q.text}</button>
                    <span className="lpd-q-meta">{q.sourceLabel} · {q.askedLabel}</span>
                    <button type="button" className="lpd-star" aria-label="Model answer" title="✦ Model answer" onClick={() => openSheet('answer', q)}>✦</button>
                    <span className="lpd-q-glyph" role="img" style={{ color: d.vFg }} title={d.vLabel} aria-label={'Last verdict · ' + d.vLabel}>{d.vGlyph}</span>
                  </div>
                );
              })}
              {questions.length === 0 && <div className="lpd-empty">No questions tagged with {lp.name} yet. Add one, upload a file, or tag some in Library → Questions.</div>}
              {questions.length > PHONE_ROWS && <button type="button" className="lpd-more" onClick={() => setShowAll((x) => !x)}>{showAll ? 'Show fewer' : (questions.length - PHONE_ROWS) + ' more'}</button>}
            </div>
            <input ref={upload} type="file" multiple accept=".md,.txt,.csv" style={{ display: 'none' }} aria-hidden="true" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) void onUpload(l); }} />
          </section>

          {/* ---- verdict history · best attempt */}
          <section className="lpd-sec history" aria-label="Verdict history">
            <div className="lpd-sec-head"><span className="label"><span className="lpd-phone">Verdict history · best attempt</span><span className="lpd-desk">Verdict history · {histLabel}</span></span></div>
            <div className="card r12 lpd-hist">
              {cells.length > 0 ? (
                <>
                  <div className="lpd-hist-cells" role="img" aria-label={'Verdicts over ' + histLabel}>
                    {cells.map((c) => { const d = v(c.verdict); return <span key={c.sessionNumber} className="lpd-hist-cell" style={{ background: d.vFill, color: d.vOnFill }} title={'Session ' + c.sessionNumber + ' · ' + d.vLabel}>{d.vGlyph}</span>; })}
                  </div>
                  <div className="lpd-hist-labels"><span>S{sessionNumbers[0]}</span><span>S{sessionNumbers[sessionNumbers.length - 1]}</span></div>
                </>
              ) : <span className="sub">Not practised yet — the last 8 sessions show here.</span>}
              <div className="lpd-best">
                <button type="button" className="lpd-play" aria-label={playing ? 'Pause the best attempt' : 'Play the best attempt'} disabled={!best || !bestRecording} title={!best ? 'No attempt yet' : bestRecording ? (playing ? 'Pause' : 'Play') : 'No recording for this attempt — recordings arrive in M4'} onClick={() => void play()}>
                  {playing ? <Icon.Pause size={14} /> : <Icon.Play size={14} />}
                </button>
                {best && bestVerdict ? (
                  <div className="lpd-best-text">
                    <span className="lpd-best-1">Best attempt · session {bestSession?.number ?? '—'}{bestSecs != null && <span className="lpd-desk"> · {fmtClock(bestSecs)}</span>}</span>
                    <span className="lpd-best-2">
                      {best.storyTitle ?? 'No story'}{bestSecs != null && <span className="lpd-phone"> · {fmtClock(bestSecs)}</span>} · <span style={{ color: bestVerdict.vFg }}>{bestVerdict.vGlyph} {bestVerdict.vLabel}</span>{quote && <span className="lpd-desk"> · {quote}</span>}
                    </span>
                  </div>
                ) : (
                  <div className="lpd-best-text"><span className="lpd-best-1">No best attempt yet</span><span className="lpd-best-2">Practise this LP — the strongest answer is kept here.</span></div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
      <div className="screen-foot lpd-foot"><button type="button" className="btn lg primary block" onClick={practise}>Practise this LP</button></div>
    </div>
  );

  return (
    <div className="screen">
      <div className="lpd-md">
        <aside className="lpd-master" aria-label="Leadership Principles">
          <div className="lpd-master-head">
            <span className="lpd-master-title">LPs</span>
            <button type="button" className="btn sm" style={{ color: 'var(--m-fg2)' }} onClick={async () => { await repo.resetLps(); await refresh(); toast('The 16 LPs are back to their defaults'); }}>Reset to defaults</button>
          </div>
          <div className="lpd-master-list"><LpList lps={lpRows} selected={id} onOpen={(x) => go(paths.lp(x))} /></div>
          <span className="lpd-master-foot">{dbMode === 'duckdb' ? 'DuckDB-WASM ✓' : dbMode === 'memory' ? 'in-memory library' : 'starting'}</span>
        </aside>
        {detail}
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title={'Map a story to ' + lp.name} eyebrow="Mapped stories" zIndex={14}
        foot={<div className="hstack" style={{ gap: 8 }}><button type="button" className="btn md ink grow" onClick={() => { setPicker(false); openSheet('addStory'); }}>New story</button><button type="button" className="btn md grow" onClick={() => { setPicker(false); go(paths.grid); }}>Map in the grid →</button></div>}>
        <div className="list r12">
          {unmapped.map((s) => (
            <button key={s.id} type="button" className="row lpd-pick-row" onClick={() => void mapExisting(s)}>
              <div className="stack g2 grow"><span className="lpd-story-title">{s.title}</span><span className="lpd-story-nums">{s.numbers.map((n) => n.value).join(' · ') || s.summary}</span></div>
              <span className="chip plain" style={{ flex: 'none' }}>{s.lpShorts.length ? s.lpShorts.join(' ') : 'unmapped'}</span>
            </button>
          ))}
          {unmapped.length === 0 && <div className="lpd-empty">Every story is already mapped to {lp.name}.</div>}
        </div>
        <span className="sub">Tap a story to map it as {mapped.length ? 'secondary' : 'primary'}; the role chip on the row swaps it.</span>
      </Sheet>
    </div>
  );
}
