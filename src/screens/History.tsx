// Mock — History (board 4). The session list with search and mode filters, and the session
// detail: the report (verdict tiles, "Focus next"), the recording player with one chapter per
// question, the transcript that follows playback (click a line to seek) and the analysis
// cards. Phone: list → detail, Transcript / Analysis · N at the bottom. Desktop (≥ 900 px):
// the sidebar (App.tsx) + a 300 px session list + the detail with the transcript on the
// left and the analysis on the right. A verdict cell anywhere is a link to that answer.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Icon, Input, Seg, download, fmt, v } from '../components/ui.tsx';
import AnalysisCard, { cardFromExchange, iNote, starNote, type AnalysisCardData } from '../components/AnalysisCard.tsx';
import Transcript from '../components/Transcript.tsx';
import Player, { usePlayback, useWaveform, type Chapter, type PlaybackSpan } from '../components/Player.tsx';
import { fmtDuration, fmtSessionDate, sessionModeLabel } from '../domain/selectors.ts';
import { buildBackup, backupFileName } from '../db/backup.ts';
import { reportInput } from '../live/reporter.ts';
import { analysisPipeline } from '../gemini/setup.ts';
import { textLlm } from '../live/make-pipeline.ts';
import { MODE_LABEL, type Exchange, type Lp, type Mode, type Session, type Story, type TranscriptEvent } from '../domain/types.ts';
import { VERDICT_LABEL } from '../domain/verdict.ts';
import '../styles/screens/history.css';

type Tab = 'transcript' | 'analysis';

// ---------- helpers ----------
const DESK = '(min-width: 900px)';
function useDesktop(): boolean {
  const [d, setD] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(DESK).matches);
  useEffect(() => {
    const m = matchMedia(DESK); const l = () => setD(m.matches);
    m.addEventListener('change', l); return () => m.removeEventListener('change', l);
  }, []);
  return d;
}

const sessionMs = (s: Session | null): number => (s?.endedAt ? Math.max(0, Date.parse(s.endedAt) - Date.parse(s.startedAt)) : 0);
/** The detail header's duration: mono mm:ss ("48:12"), unlike the list's "48 min". */
const fmtSessionClock = (s: Session): string => (s.endedAt ? fmt(sessionMs(s) / 1000) : '—');
const exchangesOf = (all: Exchange[], sessionId: string): Exchange[] => all.filter((e) => e.sessionId === sessionId).sort((a, b) => a.index - b.index);
const lpNameOf = (lps: Lp[], id: string | null): string => (id ? lps.find((l) => l.id === id)?.name ?? id : '');
const lpShortOf = (lps: Lp[], id: string | null): string => (id ? lps.find((l) => l.id === id)?.short ?? '—' : '—');
const firstName = (name: string): string => name.split(' ')[0] ?? name;

/** "Dana · interviewer" · "You" · "Coach" */
function whoOf(t: TranscriptEvent, xs: Exchange[]): string {
  if (t.speaker === 'me') return 'You';
  if (t.speaker === 'coach') return 'Coach';
  const ex = t.exchangeId ? xs.find((e) => e.id === t.exchangeId) : xs.find((e) => t.tMs >= e.startMs && (e.endMs == null || t.tMs < e.endMs));
  return (ex ? firstName(ex.interviewer.name) : 'Interviewer') + ' · interviewer';
}

function chaptersOf(xs: Exchange[], lps: Lp[], totalMs: number): Chapter[] {
  return xs.map((e, i) => ({ id: e.id, index: i, label: 'Q' + (i + 1), lp: e.analysis?.lp || lpNameOf(lps, e.lpId) || '—', startMs: e.startMs, endMs: e.endMs ?? xs[i + 1]?.startMs ?? totalMs }));
}

/** Scrolls the nearest scrolling ancestor so `el` is visible (centred when it was out of view); never the page. */
function scrollWithin(el: HTMLElement): void {
  let c: HTMLElement | null = el.parentElement;
  while (c && !/(auto|scroll)/.test(getComputedStyle(c).overflowY)) c = c.parentElement;
  if (!c) return;
  const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
  if (er.top >= cr.top + 8 && er.bottom <= cr.bottom - 8) return;
  const tall = er.height > cr.height * 0.8;
  c.scrollTo({ top: c.scrollTop + (er.top - cr.top) - (tall ? 8 : (cr.height - er.height) / 2), behavior: 'smooth' });
}

const extOf = (mime: string | null): string => (mime?.includes('ogg') ? 'ogg' : mime?.includes('mp4') ? 'm4a' : mime?.includes('wav') ? 'wav' : mime?.includes('mpeg') ? 'mp3' : 'webm');
const fmtBytes = (n: number): string => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/** The session as Markdown: header, report, one section per answer, the transcript. */
export function sessionMarkdown(s: Session, modeLabel: string, xs: Exchange[], cards: AnalysisCardData[], events: TranscriptEvent[]): string {
  const L: string[] = [];
  const ivs = new Set(xs.map((e) => e.interviewer.name)).size;
  L.push('# Session ' + s.number + ' — ' + fmtSessionDate(s), '', modeLabel + ' · ' + fmtSessionClock(s) + ' · ' + xs.length + ' questions' + (s.mode === 'loop' ? ' · ' + ivs + ' interviewers' : ''), '');
  const r = s.report;
  if (r) {
    L.push('## Report', '');
    if (r.summary) L.push(r.summary, '');
    if (r.nextFocus) L.push('**Focus next:** ' + r.nextFocus, '');
    if (r.improvement) L.push('**Improved:** ' + r.improvement, '');
    if (r.fixes.length) { L.push('**Fixes**', ''); r.fixes.forEach((f, i) => L.push(i + 1 + '. ' + f)); L.push(''); }
    if (r.verdicts.length) { L.push('**Verdicts**', ''); r.verdicts.forEach((x) => L.push('- ' + x.lpName + ': ' + VERDICT_LABEL[x.verdict])); L.push(''); }
    if (r.votes.length) { L.push('**Votes**', ''); r.votes.forEach((x) => L.push('- ' + x.interviewer.name + ' (' + x.interviewer.role + ') · ' + x.lpName + ': ' + VERDICT_LABEL[x.verdict] + (x.reason ? ' — ' + x.reason : ''))); L.push(''); }
    if (r.storySwaps.length) { L.push('**Story swaps**', ''); r.storySwaps.forEach((x) => L.push('- ' + x.lpName + ': use ' + x.useStory + (x.insteadOf ? ' instead of ' + x.insteadOf : ''))); L.push(''); }
  }
  if (cards.length) L.push('## Answers', '');
  cards.forEach((c, i) => {
    const d = v(c.verdict);
    L.push('### ' + c.q + ' · ' + c.lp + ' · ' + d.vGlyph + ' ' + d.vLabel, '', c.question, '', '- Story used: ' + c.story);
    if (xs[i]?.interviewer) L.push('- Asked by: ' + xs[i].interviewer.name + ' (' + xs[i].interviewer.role + ')');
    if (c.better) L.push('- Better story: ' + c.better + (c.reason ? ' — ' + c.reason : ''));
    if (c.missed.length) { L.push('- Numbers you missed:'); c.missed.forEach((m) => L.push('  - ' + m.notes + ' → ' + m.said)); }
    if (c.strength) {
      L.push('- STAR: S ' + c.star.s + '% · T ' + c.star.t + '% · A ' + c.star.a + '% · R ' + c.star.r + '% (' + starNote(c.star) + ')', '- “I”: ' + c.iPct + '% (' + iNote(c.iPct) + ')', '- Delivery: ' + c.pace + ' wpm · ' + c.paceNote + ' · ' + c.fillers + ' fillers · ' + c.length + ' · ' + c.lengthNote, '- Strength: ' + c.strength);
    }
    if (c.fixes.length) { L.push('- Fixes:'); c.fixes.forEach((f, j) => L.push('  ' + (j + 1) + '. ' + f)); }
    if (c.isBest) L.push('- Saved as the best attempt');
    L.push('');
  });
  if (events.length) { L.push('## Transcript', ''); events.forEach((t) => L.push('- `' + fmt(t.tMs / 1000) + '` **' + whoOf(t, xs) + ':** ' + t.text)); L.push(''); }
  L.push('_Exported from Mock on ' + new Date().toISOString().slice(0, 10) + '._', '');
  return L.join('\n');
}

// ---------- the list ----------
export function SessionList({ sessions, selected, onOpen, empty }: { sessions: Session[]; selected?: string | null; onOpen: (id: string) => void; empty?: React.ReactNode }) {
  const { data, go } = useApp();
  const bySession = useMemo(() => {
    const m = new Map<string, Exchange[]>();
    for (const e of data.exchanges) { const a = m.get(e.sessionId); if (a) a.push(e); else m.set(e.sessionId, [e]); }
    for (const a of m.values()) a.sort((x, y) => x.index - y.index);
    return m;
  }, [data.exchanges]);
  return (
    <div className="list hist-list">
      {sessions.map((s) => {
        const xs = bySession.get(s.id) ?? [];
        const on = selected === s.id;
        return (
          <div key={s.id} className={'row sess-row' + (on ? ' active' : '')} style={{ ['--cells' as string]: xs.length } as React.CSSProperties}>
            <button type="button" className="sess-main" onClick={() => onOpen(s.id)} aria-current={on ? 'true' : undefined}>
              <span className="sess-top"><span className="sess-title">Session {s.number}</span><span className="sess-date">{fmtSessionDate(s)}</span></span>
              <span className="sess-sub ellipsis">{sessionModeLabel(s, data.lps, data.stories, data.questions, data.files)} · <span className="mono">{fmtDuration(s)}</span></span>
            </button>
            {xs.length > 0 && (
              <div className="sess-cells" role="group" aria-label={'Answers in session ' + s.number}>
                {xs.map((e, i) => {
                  const d = v(e.verdict); const lp = e.analysis?.lp || lpNameOf(data.lps, e.lpId);
                  return <button key={e.id} type="button" className="sess-cell" style={{ background: d.vFill, color: d.vOnFill }} title={'Q' + (i + 1) + ' · ' + lp + ' · ' + d.vLabel} aria-label={'Open Q' + (i + 1) + ', ' + lp + ', ' + d.vLabel} onClick={() => go(paths.session(s.id) + '?q=' + i)}>{d.vGlyph}</button>;
                })}
              </div>
            )}
            <Icon.Forward size={16} className="sess-chev" />
          </div>
        );
      })}
      {sessions.length === 0 && <div className="row sub hist-empty">{empty ?? 'No sessions yet — run one from Practice.'}</div>}
    </div>
  );
}

function ListPanel({ selected, master }: { selected: string | null; master: boolean }) {
  const { data, go } = useApp();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<Mode | 'all'>('all');
  const modes = useMemo(() => (Object.keys(MODE_LABEL) as Mode[]).filter((m) => data.sessions.some((s) => s.mode === m)), [data.sessions]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byS = new Map<string, Exchange[]>();
    for (const e of data.exchanges) { const a = byS.get(e.sessionId); if (a) a.push(e); else byS.set(e.sessionId, [e]); }
    const hit = (s: Session): boolean => {
      if (!q) return true;
      if (('session ' + s.number).includes(q) || sessionModeLabel(s, data.lps, data.stories, data.questions, data.files).toLowerCase().includes(q)) return true;
      return (byS.get(s.id) ?? []).some((e) => e.questionText.toLowerCase().includes(q) || lpNameOf(data.lps, e.lpId).toLowerCase().includes(q) || (e.analysis?.lp ?? '').toLowerCase().includes(q) || (e.storyTitle ?? '').toLowerCase().includes(q));
    };
    return data.sessions.slice().sort((a, b) => b.number - a.number).filter((s) => (mode === 'all' || s.mode === mode) && hit(s));
  }, [data, query, mode]);
  const filtered = mode !== 'all' || !!query.trim();
  return (
    <>
      <div className={master ? 'hist-master-head' : 'screen-head column hist-head'}>
        <div className="hist-head-row">
          <span className={master ? 'hist-master-title' : 'h1'}>History</span>
          <button type="button" className="icon-btn" aria-label={searching ? 'Close search' : 'Search'} aria-pressed={searching} onClick={() => { setSearching((x) => !x); if (searching) setQuery(''); }}>{searching ? <Icon.Close size={20} /> : <Icon.Search size={22} />}</button>
        </div>
        {searching && <Input type="search" placeholder="Search questions, areas or stories" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Search sessions" />}
        <div className="filter-row hist-filters" role="group" aria-label="Filter by mode">
          <button type="button" className={'filter' + (mode === 'all' ? ' on' : '')} onClick={() => setMode('all')}>All · {data.sessions.length}</button>
          {modes.map((m) => <button key={m} type="button" className={'filter' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>)}
        </div>
      </div>
      <div className={'screen-body hist-body' + (master ? ' master-body' : '')}>
        <SessionList sessions={rows} selected={selected} onOpen={(id) => go(paths.session(id))} empty={filtered && data.sessions.length > 0 ? 'No sessions match.' : undefined} />
      </div>
    </>
  );
}

// ---------- the detail ----------
function Detail({ id, desktop }: { id: string; desktop: boolean }) {
  const { data, repo, refresh, back, go, toast, live, route, gemini, providers } = useApp();
  const [writing, setWriting] = useState(false);
  const session = data.sessions.find((s) => s.id === id) ?? null;
  const xs = useMemo(() => exchangesOf(data.exchanges, id), [data.exchanges, id]);
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [rec, setRec] = useState<{ url: string; blob: Blob } | null>(null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [focus, setFocus] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pendingCard, setPendingCard] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { let alive = true; void repo.transcript(id).then((ev) => { if (alive) setEvents(ev); }); return () => { alive = false; }; }, [repo, id]);

  const recordingKey = session?.recordingKey ?? null;
  useEffect(() => {
    let alive = true; let url: string | null = null;
    setRec(null);
    if (!recordingKey) return;
    void repo.getBlob(recordingKey).then((b) => { if (!alive || !b) return; url = URL.createObjectURL(b); setRec({ url, blob: b }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [repo, recordingKey]);

  const totalMs = useMemo(() => Math.max(sessionMs(session), ...xs.map((e) => e.endMs ?? e.startMs + 1000), ...events.map((t) => t.tMs + 5000), 1000), [session, xs, events]);
  const chapters = useMemo(() => chaptersOf(xs, data.lps, totalMs), [xs, data.lps, totalMs]);
  const skipSpans = useMemo<PlaybackSpan[]>(() => events.flatMap((t, i) => {
    if (t.speaker !== 'me') return [];
    const ex = t.exchangeId ? xs.find((e) => e.id === t.exchangeId) : undefined;
    return [{ startMs: t.tMs, endMs: events[i + 1]?.tMs ?? ex?.endMs ?? totalMs }];
  }), [events, xs, totalMs]);
  const pb = usePlayback({ src: rec?.url ?? null, totalMs, skipSpans });
  const peaks = useWaveform(rec?.blob ?? null, 72);
  const current = useMemo(() => chapters.reduce<Chapter | null>((acc, c) => (c.startMs <= pb.positionMs ? c : acc), null), [chapters, pb.positionMs]);
  const curLine = useMemo(() => events.reduce((acc, t, i) => (t.tMs <= pb.positionMs ? i : acc), -1), [events, pb.positionMs]);
  const cards = useMemo(() => xs.map((e, i) => cardFromExchange(e, i, lpNameOf(data.lps, e.lpId))), [xs, data.lps]);
  const modeLabel = session ? sessionModeLabel(session, data.lps, data.stories, data.questions, data.files) : '';
  const interviewers = new Set(xs.map((e) => e.interviewer.name)).size;
  const report = session?.report ?? null;

  // ?q=N — a verdict cell was tapped: seek to that answer and show its card.
  const q = route.query.get('q');
  useEffect(() => {
    if (q == null) return;
    const i = Number(q);
    if (!Number.isInteger(i) || !xs[i]) return;
    const c = chapters[i]; if (c) pb.seek(c.startMs);
    setFocus(i); setShowAll(false); setTab('analysis'); setPendingCard(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, id, xs.length, chapters.length]);
  useEffect(() => {
    if (pendingCard == null) return;
    const el = cardRefs.current[pendingCard];
    if (el) { scrollWithin(el); setPendingCard(null); }
  }, [pendingCard, tab, showAll, desktop]);

  // The transcript follows playback; so does the desktop card column (back to the top of the new card).
  useEffect(() => { if (!pb.playing) return; const el = lineRefs.current[curLine]; if (el) scrollWithin(el); }, [curLine, pb.playing]);
  const curIndex = current?.index ?? -1;
  useEffect(() => { if (desktop && !showAll && pendingCard == null) cardsRef.current?.scrollTo({ top: 0 }); }, [curIndex, desktop, showAll, pendingCard]);

  // The export menu closes on an outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [menu]);

  const openAnswer = useCallback((i: number) => {
    const c = chapters[i]; if (c) pb.seek(c.startMs);
    setFocus(i); setShowAll(false);
  }, [chapters, pb]);
  const playAnswer = (i: number) => { const c = chapters[i]; if (!c) return; pb.seek(c.startMs); pb.play(); setFocus(i); if (!desktop) setTab('transcript'); };
  const saveBest = async (e: Exchange) => { await repo.setBestAttempt(e.id); await refresh(); toast('Saved as your best attempt for this question'); };
  const drill = (e: Exchange) => {
    if (!e.lpId) { toast('This answer has no area to drill'); return; }
    void live.start({ mode: 'lp', focus: e.lpId, focusLabel: lpNameOf(data.lps, e.lpId) });
  };
  const exportMarkdown = () => { if (!session) return; download('mock-session-' + session.number + '.md', new Blob([sessionMarkdown(session, modeLabel, xs, cards, events)], { type: 'text/markdown' })); setMenu(false); };
  const exportRecording = () => { if (!session || !rec) return; download('mock-session-' + session.number + '.' + extOf(session.recordingMime), rec.blob); setMenu(false); };
  const exportBackup = async () => { setMenu(false); const b = await buildBackup(repo); download(backupFileName(), new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' })); toast('Backup downloaded'); }; // M2: zip with Parquet tables + recordings

  const exportMenu = (large: boolean) => (
    <div className="hist-export" ref={menuRef}>
      <button type="button" className={'btn hist-export-btn' + (large ? ' lg' : '')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon.Download size={16} />Export <span className="hist-caret" aria-hidden="true">▾</span></button>
      {menu && (
        <div className="hist-menu" role="menu" aria-label="Export">
          <button type="button" role="menuitem" onClick={exportMarkdown}>Session as Markdown<span className="menu-sub">Report, transcript and cards · .md</span></button>
          <button type="button" role="menuitem" onClick={exportRecording} disabled={!rec}>Recording<span className="menu-sub">{rec ? fmtBytes(rec.blob.size) + ' · .' + extOf(session?.recordingMime ?? null) : 'No recording for this session'}</span></button>
          <button type="button" role="menuitem" onClick={exportBackup}>Backup JSON<span className="menu-sub">Everything on this device</span></button>
        </div>
      )}
    </div>
  );

  if (!session) {
    return (
      <div className={desktop ? 'hist-detail hist-detail-empty' : 'screen'}>
        {!desktop && <div className="screen-head back"><button type="button" className="back-btn" onClick={() => back(paths.history)}><Icon.Back />History</button></div>}
        <div className={desktop ? 'stack g8' : 'screen-body'}><span className="h3">This session is gone.</span><span className="sub">It may have been deleted or never finished saving.</span><button type="button" className="btn md" onClick={() => go(paths.history, true)}>Back to History</button></div>
      </div>
    );
  }

  const sub = <>{fmtSessionDate(session)} · {modeLabel} · <span className="mono">{fmtSessionClock(session)}</span> · {xs.length} questions{session.mode === 'loop' && interviewers > 0 ? ' · ' + interviewers + ' interviewers' : ''}</>;
  const playerNote = rec ? undefined : xs.length ? 'No recording for this session — playback follows the transcript timings.' : undefined; // live sessions record (M3); the sample sessions have no audio
  const player = <div className={'card hist-player' + (desktop ? ' desk' : '')}><Player pb={pb} chapters={chapters} seed={id} current={current} note={playerNote} peaks={peaks} /></div>;

  const writeReport = async () => {
    setWriting(true);
    try {
      const input = await reportInput(repo, id);
      if (!input) return;
      const llm = textLlm(providers.settings, providers.settings, providers.keys);
      const { reporter } = analysisPipeline({ key: gemini.key || null, llm, textModel: data.settings.textModel, lps: data.lps, stories: data.stories, script: null, onFallback: (_w, err) => toast((llm ? 'Report' : 'Flash report') + ' failed — wrote it offline (' + err.message + ')') });
      await repo.updateSession(id, { report: await reporter.report(input) });
      await refresh();
    } finally { setWriting(false); }
  };
  const canWrite = !report && xs.some((e) => e.verdict);
  const writeButton = canWrite && <button type="button" className="btn md hist-write" disabled={writing} onClick={() => void writeReport()}>{writing ? 'Writing the report…' : 'Write the report'}</button>;

  const reportRows = report ? (
    <>
      {!!report.summary && <span className="sub hist-summary">{report.summary}</span>}
      {!!report.nextFocus && <div className="hist-focus"><span className="label cool">Focus next</span><span className="hist-focus-text">{report.nextFocus}</span></div>}
      {!!report.improvement && <div className="hist-focus"><span className="label green">Improved</span><span className="hist-focus-text">{report.improvement}</span></div>}
      {report.fixes.length > 0 && <div className="hist-focus"><span className="label">Fixes</span><span className="hist-fixes">{report.fixes.map((f, i) => <span key={i}><span className="mono muted">{i + 1}</span> {f}</span>)}</span></div>}
      {report.storySwaps.length > 0 && <div className="hist-focus"><span className="label">Story swaps</span><span className="hist-fixes">{report.storySwaps.map((x, i) => <span key={i}>{x.lpName}: use <b>{x.useStory}</b>{x.insteadOf ? ' instead of ' + x.insteadOf : ''}</span>)}</span></div>}
    </>
  ) : writeButton;

  const transcriptRows = <Transcript sessionId={id} events={events} xs={xs} lps={data.lps} curLine={curLine} who={(t) => whoOf(t, xs)} onSeek={pb.seek} lineRef={(i, el) => { lineRefs.current[i] = el; }} />;

  const card = (i: number, compact: boolean) => {
    const e = xs[i]; const c = cards[i]; if (!e || !c) return null;
    return (
      <div key={e.id} ref={(el) => { cardRefs.current[i] = el; }} className={'hist-card' + (i === focus ? ' on' : '')}>
        <AnalysisCard data={c} compact={compact} onPlay={() => playAnswer(i)} onSaveBest={() => { void saveBest(e); }} onDrill={() => drill(e)} />
      </div>
    );
  };

  if (desktop) {
    const cur = current?.index ?? (xs.length ? 0 : -1);
    return (
      <div className="hist-detail">
        <div className="hist-dhead">
          <div className="hist-title">
            <span className="h2">Session {session.number}</span>
            <span className="hist-sub">{sub}</span>
            {!!report?.nextFocus && <span className="hist-focus inline"><span className="label cool">Focus next</span><span className="hist-focus-text">{report.nextFocus}</span></span>}
            {writeButton}
          </div>
          <div className="hist-dright">
            {xs.length > 0 && (
              <div className="hist-dtiles" role="group" aria-label="Answers">
                {xs.map((e, i) => { const d = v(e.verdict); const lp = e.analysis?.lp || lpNameOf(data.lps, e.lpId); return <button key={e.id} type="button" className={'hist-dtile' + (i === cur ? ' on' : '')} style={{ background: d.vFill, color: d.vOnFill }} title={'Q' + (i + 1) + ' · ' + lp + ' · ' + e.interviewer.name + ' · ' + d.vLabel} aria-label={'Q' + (i + 1) + ', ' + lp + ', ' + d.vLabel} onClick={() => openAnswer(i)}>{d.vGlyph}</button>; })}
              </div>
            )}
            {exportMenu(true)}
          </div>
        </div>
        {player}
        <div className="hist-cols">
          <section className="hist-col" aria-label="Transcript">
            <div className="hist-sec-head"><span className="label">Transcript · follows playback</span><span className="hist-sec-note">click a line to seek</span></div>
            <div className="hist-scroll tr-list">{transcriptRows}</div>
          </section>
          <section className="hist-col" aria-label="Analysis">
            <div className="hist-sec-head">
              <span className="label">{xs.length ? 'Analysis · Q' + (cur + 1) + ' of ' + xs.length : 'Analysis'}</span>
              {xs.length > 1 && <button type="button" className="hist-link" onClick={() => setShowAll((x) => !x)}>{showAll ? 'Follow playback' : 'All ' + xs.length}</button>}
            </div>
            <div className="hist-scroll hist-cards" ref={cardsRef}>
              {xs.length === 0 && <span className="sub hist-none">No analysis for this session.</span>}
              {showAll ? xs.map((_, i) => card(i, i !== cur)) : cur >= 0 && card(cur, false)}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="screen hist-screen">
      <div className="screen-head back">
        <button type="button" className="back-btn" onClick={() => back(paths.history)}><Icon.Back />History</button>
        {tab === 'analysis' && <span className="hist-center-title">Session {session.number}</span>}
        {exportMenu(false)}
      </div>
      <div className="screen-body hist-screen-body">
        <div className={tab === 'transcript' ? 'stack g12' : 'hist-hidden'}>
          <div className="hist-title"><span className="h2">Session {session.number}</span><span className="hist-sub">{sub}</span></div>
          <div className="card hist-report">
            <div className="hist-tiles" role="group" aria-label="Answers">
              {xs.map((e, i) => { const d = v(e.verdict); const lp = e.analysis?.lp || lpNameOf(data.lps, e.lpId); const label = session.mode === 'loop' ? e.interviewer.mono : lpShortOf(data.lps, e.lpId); return (
                <button key={e.id} type="button" className={'hist-tile' + (current?.index === i ? ' on' : '')} title={'Q' + (i + 1) + ' · ' + lp + ' · ' + e.interviewer.name + ' · ' + d.vLabel} aria-label={'Q' + (i + 1) + ', ' + lp + ', ' + d.vLabel} onClick={() => openAnswer(i)}>
                  <span className="hist-tile-cell" style={{ background: d.vFill, color: d.vOnFill }}>{d.vGlyph}</span><span className="hist-tile-label ellipsis">{label}</span>
                </button>
              ); })}
              {xs.length === 0 && <span className="sub">No answers were recorded in this session.</span>}
            </div>
            {reportRows}
          </div>
          {player}
          <div className="hist-sec-head"><span className="label">Transcript{current ? ' · ' + current.label + ' · ' + firstName(xs[current.index]?.interviewer.name ?? '') : ''}</span><span className="hist-sec-note">follows playback</span></div>
          <div className="tr-list">{transcriptRows}</div>
        </div>
        <div className={tab === 'analysis' ? 'hist-cards' : 'hist-hidden'}>
          {xs.length === 0 && <span className="sub hist-none">No analysis for this session.</span>}
          {xs.map((_, i) => card(i, i !== focus))}
        </div>
      </div>
      <div className="screen-foot hist-foot">
        <Seg<Tab> className="h34" value={tab} onChange={setTab} options={[['transcript', 'Transcript'], ['analysis', 'Analysis · ' + xs.length]]} />
      </div>
    </div>
  );
}

// ---------- screens ----------
function HistoryScreen({ id }: { id: string | null }) {
  const { data } = useApp();
  const desktop = useDesktop();
  const latest = useMemo(() => data.sessions.slice().sort((a, b) => b.number - a.number)[0]?.id ?? null, [data.sessions]);
  if (!desktop) {
    if (id) return <Detail key={id} id={id} desktop={false} />;
    return <div className="screen hist-screen"><ListPanel selected={null} master={false} /></div>;
  }
  const sel = id ?? latest;
  return (
    <div className="screen hist-screen">
      <div className="master-detail hist-md">
        <div className="master"><ListPanel selected={sel} master /></div>
        <div className="detail">
          {sel ? <Detail key={sel} id={sel} desktop /> : (
            <div className="hist-detail hist-detail-empty"><span className="h3">No sessions yet.</span><span className="sub">Run one from Practice — it lands here with its recording, transcript and analysis.</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function History() { return <HistoryScreen id={null} />; }
export function SessionDetail({ id }: { id: string }) { return <HistoryScreen id={id} />; }
