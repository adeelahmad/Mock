// Mock — the live session screen (presentational). Hands-free: coaching starts when you
// stop talking; the next question follows after coaching. Every prop is derived from the
// session state machine by screens/Live.tsx; this file only draws:
//
//   states   connecting · interviewer · answering · thinking · coaching · end
//            (+ paused scrim, reconnecting banner, hint, story-notes peek, transcript sheet)
//   layouts  stage (default) · transcript-first · split — phone only; desktop uses the board
//   desktop  ≥ 900 px: answering with the transcript + story notes on the right; coaching
//            with the analysis card on the right; keys Space · R · N · H · Esc.
import React, { useEffect, useRef, useState } from 'react';
import Viz, { type VizAccent, type VizWho } from './Viz.tsx';
import AnalysisCard, { type AnalysisCardData } from './AnalysisCard.tsx';
import { Icon, Sheet, VerdictChip, fmt } from './ui.tsx';
import type { Interviewer, Mode, UiPrefs, Verdict } from '../domain/types.ts';
import type { Speaker } from '../domain/session-machine.ts';
import '../styles/screens/live.css';

export type LivePhase = 'connecting' | 'interviewer' | 'answering' | 'thinking' | 'coaching' | 'end';
export type LiveLayout = UiPrefs['liveLayout'];
export type LiveVoice = UiPrefs['voiceVisual'];
export type LiveAction = 'pause' | 'resume' | 'redo' | 'next' | 'hint' | 'dismissHint' | 'feedback' | 'end' | 'restart' | 'review';

export interface LiveTurn { speaker: 'interviewer' | 'coach' | 'me'; text: string; mono: string }
export interface LiveNote { t: string; n: string }
export interface LiveRecapRow { mono: string; name: string; role: string; lp: string; verdict: Verdict | null }
export interface LiveRecap { headline: string; durationSec: number; questions: number; fixes: number; rows: LiveRecapRow[]; focus: string }

/** The analysis card's data contract — one definition, owned by AnalysisCard.tsx. */
export type { AnalysisCardData };

export interface LiveCoaching {
  /** null until the analysis lands. */
  strength: string | null;
  fixes: string[];
  /** How many fixes have been spoken so far (they arrive one by one). */
  fixesShown: number;
  verdict: Verdict | null;
  verdictShown: boolean;
  /** "Coach is speaking…" */
  speaking: boolean;
  card: AnalysisCardData | null;
  /** One line when the spoken verdict and the written card disagree. */
  mismatchNote: string | null;
  /** Under "Next question": auto in 5 s · say "redo" to retry / or just say "next". */
  nextAuto: string;
}

export interface LiveScreenProps {
  phase: LivePhase;
  paused: boolean;
  reconnecting: boolean;
  /** No Gemini key: the scripted demo on the simulated transport. */
  demo: boolean;
  layout: LiveLayout;
  voice: LiveVoice;
  mode: Mode;
  modeLabel: string;
  sessionNumber: number;
  loopSize: number;
  elapsedSec: number;
  interviewer: Interviewer;
  qLabel: string;
  qText: string;
  /** Words of qText revealed so far while the interviewer speaks. */
  revealedWords: number;
  lpName: string;
  speaker: Speaker;
  answerSec: number;
  turns: LiveTurn[];
  hint: boolean;
  hintText: string;
  notes: LiveNote[];
  /** The session's story-notes setting. */
  notesAllowed: boolean;
  coaching: LiveCoaching;
  recap: LiveRecap;
  micNote: string;
  onAction: (action: LiveAction) => void;
  /** Analysis card footer. Absent = disabled. */
  onPlay?: () => void;
  onSaveBest?: () => void;
  onDrill?: () => void;
}

function useDesktop(): boolean {
  const [desk, setDesk] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 900px)');
    const on = () => setDesk(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return desk;
}

/** Two-sided transcript; sticks to the newest turn. */
function Turns({ turns, className = '' }: { turns: LiveTurn[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [turns.length, last?.text]);
  return (
    <div ref={ref} className={'live-turns ' + className}>
      <span className="live-spacer" />
      {turns.length === 0 && <span className="sub" style={{ textAlign: 'center', padding: 12 }}>Nothing said yet.</span>}
      {turns.map((t, i) => (
        <div key={i} className={'bubble-row' + (t.speaker === 'me' ? ' me' : t.speaker === 'coach' ? ' coach' : '')}>
          {t.speaker !== 'me' && <span className="avatar">{t.speaker === 'coach' ? 'Co' : t.mono}</span>}
          <div className="bubble">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

function NoteRows({ notes }: { notes: LiveNote[] }) {
  if (notes.length === 0) return <div className="live-note-empty sub">No stories mapped to this LP yet.</div>;
  return (
    <>
      {notes.map((n, i) => (
        <div key={i} className="live-note-row"><span className="live-note-t">{n.t}</span><span className="live-note-n">{n.n}</span></div>
      ))}
    </>
  );
}

export default function LiveScreen(p: LiveScreenProps) {
  const desktop = useDesktop();
  const [tOpen, setTOpen] = useState(false);
  const [nOpen, setNOpen] = useState(false);
  const [aOpen, setAOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'transcript' | 'notes'>('transcript');

  const { phase, paused, coaching: c, recap: r } = p;
  const layout: LiveLayout = desktop ? 'stage' : p.layout;
  const isConnecting = phase === 'connecting';
  const isInterviewer = phase === 'interviewer';
  const isThinking = phase === 'thinking';
  const isMine = phase === 'answering' || isThinking;
  const isCoaching = phase === 'coaching';
  const isEnd = phase === 'end';
  const accent: VizAccent = isCoaching || isEnd ? 'cool' : 'warm';
  // Nobody is speaking while connecting, in the thinking pause, paused or after the end (Foundations 1a–1c).
  const who: VizWho = isEnd || paused || isConnecting || isThinking ? 'none' : p.speaker;

  const words = p.qText.split(/\s+/).filter(Boolean);
  const revealing = isInterviewer && p.revealedWords < words.length;
  const qShown = isInterviewer ? words.slice(0, Math.max(0, p.revealedWords)).join(' ') : p.qText;
  const cue = p.answerSec >= 180;
  const ivKnown = p.interviewer.n > 0;
  const first = ivKnown ? p.interviewer.name.split(' ')[0] : 'your interviewer';
  const timerNote = isThinking ? 'Still listening — coaching starts when you’re done' : cue ? '3:00 passed · start wrapping up' : 'Your answer';
  const listenDot = isThinking ? 'var(--m-fg3)' : who === 'me' ? 'var(--m-fg)' : 'var(--live-fg)';
  const nowText = isInterviewer ? first + ' is speaking' : isThinking ? 'Still listening' : 'You’re answering';
  const nowSub = isInterviewer ? p.interviewer.role : isThinking ? 'Pause detected · mic open' : 'Mic open';
  const mono = isCoaching ? 'Co' : isEnd ? 'M' : p.interviewer.mono;
  const roundLabel = isCoaching
    ? 'Coach · after ' + p.qLabel + (desktop && p.lpName ? ' · ' + p.lpName : '')
    : isEnd ? 'Session ' + p.sessionNumber + ' · complete'
    : ivKnown ? 'Interviewer ' + p.interviewer.n + ' of ' + p.loopSize + ' · ' + p.interviewer.role : 'Interviewer';
  const headName = isCoaching ? 'Coaching' : isEnd ? 'Mock' : ivKnown ? p.interviewer.name : 'Mock';
  const showLp = p.mode !== 'loop' && !isCoaching && !isEnd && !!p.lpName;
  const showHandles = isInterviewer || isMine;
  const notesVisible = nOpen && p.notesAllowed && showHandles;
  const sideNotes = p.notesAllowed && sideTab === 'notes';

  // Sheets close when the moment has passed.
  useEffect(() => { if (isEnd || isCoaching) setTOpen(false); }, [isEnd, isCoaching]);
  useEffect(() => { if (!c.card) setAOpen(false); }, [c.card]);
  useEffect(() => { if (!p.notesAllowed) setSideTab('transcript'); }, [p.notesAllowed]);

  // Keyboard (desktop): Space pause/resume · R redo · N next · H hint · Esc end (Esc closes a sheet first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { if (isEnd || isConnecting) return; e.preventDefault(); p.onAction(paused ? 'resume' : 'pause'); }
      else if (k === 'r') { if (!isEnd && !isConnecting) p.onAction('redo'); }
      else if (k === 'n') { if (!isEnd && !isConnecting) p.onAction('next'); }
      else if (k === 'h') { if (showHandles && !paused) p.onAction('hint'); }
      else if (k === 'escape') { if (aOpen) setAOpen(false); else if (tOpen) setTOpen(false); else if (!isEnd) p.onAction('end'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const caret = <span className="live-caret" aria-hidden="true" />;
  const vizMain = <Viz kind={p.voice} who={who} accent={accent} size={desktop ? 260 : 200} />;
  const vizSmall = <Viz kind={p.voice} who={who} accent={accent} size={48} w={48} h={22} />;
  const timerEl = (extra = '') => <span className={'live-timer' + extra + (cue ? ' cue' : '')}>{fmt(p.answerSec)}</span>;
  const roundBtn = (label: string, aria: string, icon: React.ReactNode, action: LiveAction, big = false) => (
    <div className={'live-ctl' + (big ? ' big' : '')}>
      <button type="button" aria-label={aria} onClick={() => p.onAction(action)}>{icon}</button>
      <span>{label}</span>
    </div>
  );
  const card = (compact = false) => c.card
    ? <AnalysisCard data={c.card} compact={compact} onPlay={p.onPlay} onSaveBest={p.onSaveBest} onDrill={p.onDrill} />
    : <div className="card pad sub live-card-wait"><span className="spinner cool" />Writing the analysis…</div>;

  const rootClass = ['live', accent === 'cool' ? 'cool' : '', p.demo ? 'demo' : '', desktop ? 'desk' : '', desktop && isCoaching ? 'wide' : '', desktop && (isConnecting || isEnd) ? 'single' : ''].filter(Boolean).join(' ');

  return (
    <div className={rootClass} data-phase={phase} data-paused={paused || undefined}>
      <div className="live-edge" />
      {p.demo && <div className="demo-banner" role="status">Demo · add a Gemini key in Settings to go live</div>}

      <div className="live-main">
        <header className="live-head">
          <div className="hstack" style={{ gap: 12, minWidth: 0 }}>
            <span className={'live-mono' + (who === 'ai' ? ' speaking' : '')} aria-hidden="true">{mono}</span>
            <div className="stack" style={{ gap: 3, minWidth: 0 }}>
              <span className="live-round">{roundLabel}</span>
              <span className="live-name">{headName}</span>
            </div>
            {desktop && isCoaching && <Viz kind="wave" who={who} accent="cool" size={64} w={64} h={24} />}
          </div>
          <div className="hstack" style={{ gap: desktop ? 14 : 8 }}>
            {!desktop && isCoaching && <Viz kind="wave" who={who} accent="cool" size={56} w={56} h={22} />}
            {showLp && <span className="chip lg">{p.lpName}</span>}
            {!isEnd && !isConnecting && <span className="live-elapsed">Session {p.sessionNumber} · <span className="mono">{fmt(p.elapsedSec)}</span> elapsed</span>}
            {!isEnd && <button type="button" className="live-end" onClick={() => p.onAction('end')}>End</button>}
          </div>
        </header>

        {p.reconnecting && (
          <div className="live-recon" role="status">
            <span className="spinner gold" style={{ width: 14, height: 14 }} />
            <span>Reconnecting… your answer is still being recorded.</span>
          </div>
        )}

        <div className="live-body">
          {isConnecting && (
            <div className="live-fill live-center live-single" style={{ gap: 22 }}>
              {vizMain}
              <div className="stack g6">
                <span className="live-connect-title">Connecting to {ivKnown ? p.interviewer.name : 'your interviewer'}…</span>
                <span className="sub" style={{ fontSize: 14, lineHeight: 1.4 }}>Session {p.sessionNumber} · {p.modeLabel}{p.mode === 'loop' ? ' · ' + p.loopSize + ' interviewers' : ''}</span>
              </div>
              <div className="card live-checks">
                <div className="hstack between"><span className="hstack"><span className="ok"><Icon.Check size={14} /></span>Microphone ready</span><span className="muted">{p.micNote}</span></div>
                <div className="hstack between"><span className="hstack"><span className="ok"><Icon.Check size={14} /></span>Earbuds connected</span><span className="muted">level ok</span></div>
                <div className="sub" style={{ fontWeight: 500 }}>Nothing to tap — {first} starts in a moment.</div>
              </div>
            </div>
          )}

          {layout === 'stage' && isInterviewer && (
            <div className="live-fill" style={{ gap: 16 }}>
              <div className="live-q" aria-live="polite">{qShown}{revealing && caret}</div>
              <div className="live-centre">
                <div className="live-viz">{vizMain}</div>
                <div className="live-now"><span className="live-dot" />{first} is speaking</div>
              </div>
            </div>
          )}

          {layout === 'stage' && isMine && (
            <div className="live-fill" style={{ gap: 14 }}>
              <div className="live-q answering">{p.qText}</div>
              <div className="live-centre">
                <div className="live-viz">{vizMain}</div>
                <div className="live-timer-wrap">
                  {timerEl()}
                  <span className={'live-note' + (cue ? ' cue' : '')}><span className="live-dot" style={{ background: listenDot }} />{timerNote}{desktop && !isThinking && !cue ? ' · mic open' : ''}</span>
                </div>
              </div>
            </div>
          )}

          {layout === 'transcript' && showHandles && (
            <div className="live-fill" style={{ gap: 12 }}>
              <div className="live-pinned"><div className="label">{p.qLabel} · pinned</div><div className="live-pinned-q">{p.qText}</div></div>
              <Turns turns={p.turns} />
              <div className="live-nowrow">
                {vizSmall}
                <div className="stack g2 grow"><span className="live-nowrow-t">{nowText}</span><span className="sub" style={{ fontSize: 12 }}>{nowSub}</span></div>
                {isMine && timerEl(' sm')}
              </div>
            </div>
          )}

          {layout === 'split' && showHandles && (
            <div className="live-fill" style={{ gap: 18 }}>
              <div className="card pad stack g12">
                <div className="hstack between" style={{ gap: 10 }}>
                  <span className="live-note"><span className="live-dot" style={{ background: listenDot }} />{nowText}</span>
                  {isMine && timerEl(' xs')}
                </div>
                <div className="live-band"><Viz kind="wave" who={who} accent={accent} size={310} w={310} h={64} /></div>
              </div>
              <div className="live-q split" aria-live="polite">{qShown}{revealing && caret}</div>
              <div style={{ flex: 1 }} />
              {isMine && <div className={'live-note' + (cue ? ' cue' : '')}>{timerNote}</div>}
            </div>
          )}

          {isCoaching && (
            <div className="live-coach">
              <div className="stack g4">
                <span className="label">{p.qLabel}{p.lpName ? ' · ' + p.lpName : ''} · {first}’s question</span>
                <span className="live-coach-q">{p.qText}</span>
              </div>
              {c.strength !== null && (
                <div className="live-strength">
                  <span className="live-badge green"><Icon.Check size={13} /></span>
                  <div className="stack" style={{ gap: 3 }}><span className="label green">Strength</span><span className="live-coach-text">{c.strength}</span></div>
                </div>
              )}
              {c.fixes.slice(0, c.fixesShown).map((t, i) => (
                <div key={i} className="live-fix">
                  <span className="live-badge cool">{i + 1}</span>
                  <div className="stack" style={{ gap: 3 }}><span className="label cool">Fix {i + 1}</span><span className="live-coach-text">{t}</span></div>
                </div>
              ))}
              {c.verdictShown && (
                <>
                  <div className="live-verdict-row">
                    <span className="label">{p.lpName} verdict</span>
                    <VerdictChip code={c.verdict} size="lg" />
                  </div>
                  {c.mismatchNote && <span className="live-mismatch">{c.mismatchNote}</span>}
                  {!desktop && <button type="button" className="live-link" onClick={() => setAOpen(true)} disabled={!c.card}>Full analysis →</button>}
                </>
              )}
              {c.speaking && <div className="live-typing" role="status"><span className="live-typing-dot" />Coach is speaking…</div>}
            </div>
          )}

          {isEnd && (
            <div className="live-recap live-single">
              <div className="stack g4"><span className="label">Session {p.sessionNumber} · {p.modeLabel}</span><span className="live-recap-h">{r.headline}</span></div>
              <div className="live-stats">
                <div className="live-stat"><span className="mono">{fmt(r.durationSec)}</span><span className="sub">duration</span></div>
                <div className="live-stat"><span className="mono">{r.questions}</span><span className="sub">questions</span></div>
                <div className="live-stat"><span className="mono">{r.fixes}</span><span className="sub">fixes to drill</span></div>
              </div>
              {r.rows.length > 0 ? (
                <div className="list r12">
                  {r.rows.map((row, i) => (
                    <div key={i} className="row live-recap-row">
                      <span className="avatar lg">{row.mono}</span>
                      <div className="stack grow" style={{ gap: 1 }}><span className="ellipsis live-recap-lp">{row.lp}</span><span className="sub" style={{ fontSize: 11 }}>{row.name} · {row.role}</span></div>
                      <VerdictChip code={row.verdict} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card pad sub">No answer was scored in this session.</div>
              )}
              <div className="tint cool stack g2"><span className="label cool">Suggested focus · session {p.sessionNumber + 1}</span><span className="live-focus">{r.focus}</span></div>
            </div>
          )}
        </div>

        {p.hint && showHandles && (
          <div className="live-hint" role="status">
            <span className="ic-warm"><Icon.Bulb size={18} /></span>
            <span className="live-hint-text">{p.hintText}</span>
            <button type="button" className="icon-btn xs" aria-label="Dismiss hint" onClick={() => p.onAction('dismissHint')}><Icon.Close size={16} /></button>
          </div>
        )}

        {!desktop && notesVisible && (
          <div className="live-notes">
            <button type="button" className="live-notes-head" onClick={() => setNOpen(false)} aria-expanded="true"><span>Story notes{p.lpName ? ' · ' + p.lpName : ''}</span><Icon.Up size={16} /></button>
            <NoteRows notes={p.notes} />
          </div>
        )}

        {showHandles && (
          <>
            {!desktop && (
              <div className="live-handles">
                <button type="button" className="live-handle grow" onClick={() => setTOpen(!tOpen)} aria-expanded={tOpen}><span className="live-handle-t">Transcript · {p.turns.length} {p.turns.length === 1 ? 'turn' : 'turns'}</span><Icon.Up size={14} /></button>
                {p.notesAllowed && !nOpen && <button type="button" className="live-handle" onClick={() => setNOpen(true)}>Notes</button>}
                <button type="button" className="live-handle" onClick={() => p.onAction('hint')}>Hint</button>
                {isMine && <button type="button" className="live-handle" onClick={() => p.onAction('feedback')} title="Done — coach me now">Feedback</button>}
              </div>
            )}
            <div className="live-hf">Hands-free: say “redo”, “next” or “hint”. Coaching starts when you stop talking.{desktop ? ' Keys: Space pause · R redo · N next · H hint · Esc end.' : ''}</div>
            <div className="live-controls">
              {roundBtn(desktop ? 'Redo · R' : 'Redo', 'Redo this question', <Icon.Redo size={22} />, 'redo')}
              {roundBtn(desktop ? 'Pause · Space' : 'Pause', 'Pause', <Icon.Pause size={desktop ? 30 : 28} />, 'pause', true)}
              {roundBtn(desktop ? 'Next · N' : 'Next', 'Next question', <Icon.Next size={22} />, 'next')}
            </div>
          </>
        )}

        {isCoaching && (
          <div className="live-coach-btns">
            <button type="button" className="btn lg cool" onClick={() => p.onAction('redo')}><Icon.Redo size={18} />Redo answer{desktop ? ' · R' : ''}</button>
            <button type="button" className="btn lg" style={{ flexDirection: 'column', gap: 3 }} onClick={() => p.onAction('next')}>Next question{desktop ? ' · N' : ''}{!desktop && <span className="live-next-sub">{c.nextAuto}</span>}</button>
          </div>
        )}

        {isEnd && (
          <div className="live-end-btns">
            <button type="button" className="btn lg primary" onClick={() => p.onAction('restart')}>Start session {p.sessionNumber + 1}</button>
            <button type="button" className="btn" onClick={() => p.onAction('review')}>Review in History</button>
          </div>
        )}
      </div>

      {desktop && showHandles && (
        <aside className="live-side" aria-label="Transcript and story notes">
          <div className="live-side-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={sideTab === 'transcript'} className={'live-tab' + (sideTab === 'transcript' ? ' on' : '')} onClick={() => setSideTab('transcript')}>Transcript</button>
            {p.notesAllowed && <button type="button" role="tab" aria-selected={sideTab === 'notes'} className={'live-tab' + (sideTab === 'notes' ? ' on' : '')} onClick={() => setSideTab('notes')}>Story notes</button>}
            <span style={{ flex: 1 }} />
            <span className="live-side-count">Live · {p.turns.length} turns</span>
          </div>
          {!sideNotes && (
            <>
              <div className="live-pinned"><div className="label">{p.qLabel} · pinned</div><div className="live-pinned-q">{p.qText}</div></div>
              <Turns turns={p.turns} />
              {p.notesAllowed && (
                <div className="live-side-notes">
                  <div className="live-notes-head"><span>Story notes{p.lpName ? ' · ' + p.lpName : ''}</span><span className="live-hidden">hidden from the interviewer</span></div>
                  <NoteRows notes={p.notes} />
                </div>
              )}
            </>
          )}
          {sideNotes && (
            <div className="live-side-notes full">
              <div className="live-notes-head"><span>Story notes{p.lpName ? ' · ' + p.lpName : ''}</span><span className="live-hidden">hidden from the interviewer</span></div>
              <NoteRows notes={p.notes} />
            </div>
          )}
        </aside>
      )}

      {desktop && isCoaching && (
        <aside className="live-side wide" aria-label="Analysis">
          <div className="live-side-head"><span className="live-side-title">Analysis · {p.qLabel}</span><span className="live-side-count" style={{ padding: 0, height: 'auto' }}>saved to History</span></div>
          <div className="live-side-scroll">
            {card()}
            {c.mismatchNote && <span className="live-mismatch">{c.mismatchNote}</span>}
          </div>
        </aside>
      )}

      {paused && (
        <div className="live-pause" role="dialog" aria-modal="true" aria-label="Paused">
          <span className="live-pause-label"><Icon.MicOff size={14} />Mic off · timer held</span>
          <span className="live-pause-title">Paused</span>
          <span className="live-pause-timer">{fmt(p.answerSec)}</span>
          <button type="button" className="btn primary" onClick={() => p.onAction('resume')}><Icon.Play size={20} />Resume</button>
          <button type="button" className="btn ghost danger" style={{ height: 44 }} onClick={() => p.onAction('end')}>End session</button>
        </div>
      )}

      {!desktop && tOpen && !isEnd && (
        <div className="live-sheet" role="dialog" aria-label="Transcript">
          <div className="live-sheet-head"><span className="live-sheet-title">Transcript</span><button type="button" className="icon-btn sm" aria-label="Close transcript" onClick={() => setTOpen(false)}><Icon.Close size={18} /></button></div>
          <div className="live-pinned"><div className="label">{p.qLabel} · pinned</div><div className="live-pinned-q">{p.qText}</div></div>
          <Turns turns={p.turns} />
        </div>
      )}

      <Sheet open={!desktop && aOpen && !!c.card} onClose={() => setAOpen(false)} tall title={'Analysis · ' + p.qLabel} eyebrow="saved to History" zIndex={8}>
        {card()}
        {c.mismatchNote && <span className="live-mismatch">{c.mismatchNote}</span>}
        <div style={{ height: 8 }} />
      </Sheet>
    </div>
  );
}
