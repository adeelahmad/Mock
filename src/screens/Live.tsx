// Mock — the live session, mounted by App.tsx on #/live while a session runs. Reads the
// session state machine from the store (`useApp().live`), derives what the screen draws
// (visible phase, revealed question, coaching reveal, recap) and routes every control to
// the controller. The simulated transport drives the demo; nothing here is scripted.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { SpendBar } from '../components/Budget.tsx';
import LiveScreen, { type AnalysisCardData, type LiveAction, type LiveCoaching, type LivePhase, type LiveRecap, type LiveTurn } from '../components/LiveScreen.tsx';
import { fmtClock } from '../components/ui.tsx';
import { isPaused, visiblePhase, NO_ONE, type SessionState, type Turn } from '../domain/session-machine.ts';
import { MODE_LABEL, verdictCode, type Analysis, type Exchange, type Mode } from '../domain/types.ts';
import { VERDICT_LABEL, verdictPoints } from '../domain/verdict.ts';
import { SPOKEN_WPS } from '../live/script.ts';
import { LIVE_INPUT_TOKENS } from '../live/context.ts';

const AUTO_NEXT_SEC = 5;

// ---- the question types in word by word: how much of it has the interviewer said?
const normWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const normWords = (s: string): string[] => s.split(/\s+/).map(normWord).filter(Boolean);

/** Raw words of `qText` already present at the end of the interviewer's latest turn (0 when the transcript has not reached the question yet). */
export function spokenWordsOf(qText: string, turns: Turn[]): number {
  const q = normWords(qText);
  if (!q.length) return 0;
  let last: Turn | undefined;
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].speaker === 'interviewer') { last = turns[i]; break; }
  if (!last) return 0;
  const s = normWords(last.text);
  let k = 0;
  for (let n = Math.min(q.length, s.length); n > 0; n--) {
    // Transcript chunks can glue the previous sentence to the question's first word ("there.Tell"),
    // so the first word may match as a suffix once at least one more word confirms it.
    const head = s[s.length - n];
    let ok = head === q[0] || (n >= 2 && head.endsWith(q[0]));
    for (let i = 1; ok && i < n; i++) if (s[s.length - n + i] !== q[i]) ok = false;
    if (ok) { k = n; break; }
  }
  if (!k) return 0;
  // Map k normalised words back onto the raw words (punctuation-only tokens count for nothing).
  const raw = qText.split(/\s+/).filter(Boolean);
  let seen = 0, m = 0;
  for (let i = 0; i < raw.length && seen < k; i++) { if (normWord(raw[i])) seen++; m = i + 1; }
  return m;
}

/** Ramps a revealed-word count towards `target`, one word per `stepMs`; resets when the question changes. */
function useReveal(qText: string, target: number, stepMs: number): number {
  const [st, setSt] = useState({ q: qText, n: 0 });
  if (st.q !== qText) setSt({ q: qText, n: 0 });
  const n = st.q === qText ? st.n : 0;
  useEffect(() => {
    if (n >= target) return;
    const t = setTimeout(() => setSt((s) => (s.q === qText ? { q: s.q, n: Math.min(target, s.n + 1) } : s)), stepMs);
    return () => clearTimeout(t);
  }, [n, target, qText, stepMs]);
  return Math.min(n, target);
}

const lcFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The phase the screen draws, from the machine's visible phase:
 *  - idle/connecting, and the opening line before the first question → connecting
 *  - coaching, and everything after the analysis landed until the next question (the machine
 *    re-opens the answer clock when the coach's audio drains — the screen keeps the coaching view
 *    with the "auto in N s" beat instead) → coaching
 */
export function uiPhaseOf(s: SessionState | null): LivePhase {
  if (!s) return 'connecting';
  const vp = visiblePhase(s);
  if (vp === 'idle' || vp === 'connecting') return 'connecting';
  if (vp === 'ended') return 'end';
  if (vp === 'interviewer' && !s.qText) return 'connecting';
  if (vp === 'coaching' || s.analysis) return 'coaching';
  return vp;
}

function cardOf(a: Analysis, qLabel: string, qText: string, lpName: string, isBest?: boolean): AnalysisCardData {
  return {
    isBest,
    q: qLabel, question: qText, lp: a.lp || lpName, story: a.storyUsed ?? '—', verdict: verdictCode(a.verdict),
    better: a.betterStory?.title ?? '', reason: a.betterStory?.reason ?? '', missed: a.numbersMissed, star: a.star,
    iPct: Math.round(a.iWeRatio * 100), pace: a.delivery.paceWpm, paceNote: a.delivery.paceNote, fillers: a.delivery.fillers,
    length: fmtClock(a.delivery.durationSec), lengthNote: a.delivery.lengthNote, strength: a.strength, fixes: a.fixes,
  };
}

export default function Live() {
  const { live, prefs, data, go, toast, repo, refresh } = useApp();
  const { state, meta, controller, lastStart } = live;

  // A one-second clock for the elapsed time and the "auto in N s" countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // ---- the phase the screen draws
  const vp = state ? visiblePhase(state) : 'idle';
  const phase = uiPhaseOf(state);
  const paused = !!state && isPaused(state);

  // ---- the question reveal (from the transcript; time-based fallback when the transcript does not match — M3 real voices)
  const qText = state?.qText ?? '';
  const totalWords = qText.split(/\s+/).filter(Boolean).length;
  const matched = state ? spokenWordsOf(qText, state.turns) : 0;
  const timed = state && state.aiSpeaking && state.qAskedAt != null ? Math.min(totalWords, Math.floor(((now - state.qAskedAt) / 1000) * SPOKEN_WPS)) : 0;
  const target = phase !== 'interviewer' ? totalWords : matched > 0 ? matched : timed;
  const revealedWords = useReveal(qText, target, matched > 0 ? 130 : 320);

  // ---- the session this screen belongs to (for the recap's focus and the card's footer)
  const session = useMemo(() => data.sessions.find((s) => s.id === meta?.sessionId) ?? null, [data.sessions, meta?.sessionId]);
  const exchanges = useMemo(() => data.exchanges.filter((e) => e.sessionId === meta?.sessionId), [data.exchanges, meta?.sessionId]);
  const current: Exchange | null = useMemo(() => exchanges.filter((e) => e.questionText === qText).sort((a, b) => b.index - a.index)[0] ?? null, [exchanges, qText]);
  const isBest = !!current?.isBest;

  // ---- coaching: strength, fixes and the verdict arrive as the coach says them
  const coachDone = phase === 'coaching' && vp !== 'coaching';   // "Back to the interview" said; the next question has not arrived
  const coachQuiet = coachDone && state?.speaker !== 'ai';       // …and its audio has drained: the beat before the next question starts now
  const [doneAt, setDoneAt] = useState<number | null>(null);
  useEffect(() => { setDoneAt(coachQuiet ? Date.now() : null); }, [coachQuiet]);
  const shownRef = useRef({ q: -1, fixes: 0, verdict: false });
  const coaching: LiveCoaching = useMemo(() => {
    const a = state?.analysis ?? null;
    const text = state?.coachText ?? '';
    const qi = state?.qIndex ?? -1;
    if (shownRef.current.q !== qi) shownRef.current = { q: qi, fixes: 0, verdict: false };
    const mentions = (text.match(/\bfix\b/gi) ?? []).length;
    const fixesNow = a ? (coachDone ? a.fixes.length : Math.min(a.fixes.length, mentions)) : 0;
    const verdictNow = !!a && (coachDone || /\bverdict\b/i.test(text));
    shownRef.current.fixes = Math.max(shownRef.current.fixes, fixesNow);
    shownRef.current.verdict = shownRef.current.verdict || verdictNow;
    const cd = doneAt == null ? AUTO_NEXT_SEC : Math.max(0, AUTO_NEXT_SEC - Math.floor((now - doneAt) / 1000));
    // M3: the Gemini transport paces the next question itself; the countdown mirrors the simulated transport's 5 s beat.
    const nextAuto = doneAt != null ? (cd > 0 ? 'auto in ' + cd + ' s · say “redo” to retry' : 'or just say “next”') : 'auto after coaching';
    const mismatch = a && a.spokenVerdict && a.spokenVerdict !== a.verdict
      ? 'The coach said “' + VERDICT_LABEL[a.spokenVerdict] + '” aloud; the written card says “' + VERDICT_LABEL[a.verdict] + '” — the card is what History keeps.'
      : null;
    return {
      strength: a ? a.strength : null,
      fixes: a?.fixes ?? [],
      fixesShown: a ? shownRef.current.fixes : 0,
      verdict: a?.verdict ?? null,
      verdictShown: !!a && shownRef.current.verdict,
      speaking: phase === 'coaching' && state?.speaker === 'ai',
      card: a && state ? cardOf(a, state.qLabel, state.qText, state.lpName, isBest) : null,
      mismatchNote: mismatch,
      nextAuto,
    };
  }, [state, coachDone, doneAt, now, phase, isBest]);

  const mode: Mode = lastStart?.mode ?? 'loop';
  const focusLabel = lastStart?.focusLabel ?? data.lps.find((l) => l.id === lastStart?.focus)?.name ?? data.stories.find((s) => s.id === lastStart?.focus)?.title ?? lastStart?.questionText ?? '';
  const modeLabel = mode === 'loop' ? 'Full loop' : MODE_LABEL[mode] + (focusLabel ? ' · ' + focusLabel : '');

  const recap: LiveRecap = useMemo(() => {
    const answers = state?.answers ?? [];
    // The written report's focus wins once it lands; until then the spoken recap's, then the weakest answer's first fix.
    const weakest = exchanges.filter((e) => e.analysis).sort((a, b) => verdictPoints(a.analysis!.verdict) - verdictPoints(b.analysis!.verdict) || a.index - b.index)[0];
    const local = weakest?.analysis
      ? (weakest.analysis.lp || data.lps.find((l) => l.id === weakest.lpId)?.name || 'Next time') + ' — ' + lcFirst(weakest.analysis.fixes[0] ?? 'redo it with the numbers first.')
      : 'Keep going — start the next session when you’re ready.';
    const endedAt = state?.endedAt ?? now;
    return {
      headline: mode === 'loop' ? 'Loop complete.' : 'Session complete.',
      durationSec: state ? Math.max(0, Math.round((endedAt - state.startedAt) / 1000)) : 0,
      questions: answers.length,
      fixes: answers.reduce((n, a) => n + a.fixes, 0),
      rows: answers.map((a) => ({ mono: a.interviewer.mono, name: a.interviewer.name, role: a.interviewer.role, lp: a.lpName, verdict: a.verdict })),
      focus: session?.report?.nextFocus || state?.focus || local,
    };
  }, [state, exchanges, data.lps, session, mode, now]);

  const turns: LiveTurn[] = useMemo(() => (state?.turns ?? []).map((t) => ({ speaker: t.speaker, text: t.text, mono: state?.interviewer.mono ?? 'AI' })), [state]);

  // ---- errors surface as toasts; the session carries on
  useEffect(() => { if (state?.error) { toast(state.error); controller?.clearError(); } }, [state?.error, controller, toast]);

  // ---- leaving the screen after the recap releases the controller (the session is already saved)
  const phaseRef = useRef<SessionState['phase'] | undefined>(state?.phase);
  phaseRef.current = state?.phase;
  const exitRef = useRef(live.exit);
  exitRef.current = live.exit;
  useEffect(() => () => { if (phaseRef.current === 'ended') exitRef.current(); }, []);

  // ---- controls
  const onAction = useCallback((a: LiveAction) => {
    if (!controller) return;
    switch (a) {
      case 'pause': controller.pause(); break;
      case 'resume': controller.resume(); break;
      case 'redo': controller.redo(); break;
      case 'next': controller.next(); break;
      case 'feedback': controller.feedback(); break;
      case 'hint': controller.hint(); break;
      case 'dismissHint': controller.dismissHint(); break;
      case 'end': void controller.end(); break;
      case 'restart':
        if (lastStart) void live.start(lastStart);
        else { live.exit(); go(paths.practice); }
        break;
      case 'review': {
        const id = meta?.sessionId;
        live.exit();
        go(id ? paths.session(id) : paths.history);
        break;
      }
    }
  }, [controller, lastStart, live, go, meta?.sessionId]);

  const lpName = state?.lpName ?? '';
  const onSaveBest = useCallback(async () => {
    if (!current?.analysis) { toast('Nothing to save yet — the analysis is still being written.'); return; }
    await repo.setBestAttempt(current.id);
    await refresh();
    toast('Saved as your best attempt' + (lpName ? ' for ' + lpName : '') + '.');
  }, [current, repo, refresh, toast, lpName]);
  const onDrill = useCallback(async () => {
    const name = state?.analysis?.lp || lpName;
    const lp = data.lps.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!lp || !controller) { toast('Finish this session, then drill from History.'); return; }
    await controller.end();
    toast('Session ' + (meta?.sessionNumber ?? '') + ' saved · drilling ' + lp.name + '.');
    await live.start({ mode: 'lp', focus: lp.id, focusLabel: lp.name });
  }, [state?.analysis?.lp, lpName, data.lps, controller, toast, meta?.sessionNumber, live]);
  // M4: "Play answer" replays the exchange clip (saved under clip:{exchangeId} when the exchange closes).
  const onPlay = undefined;

  // ---- context debug panel (D): the system prompt's tokens against its budget and what was trimmed
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'd') setDebug((d) => !d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!state || !meta) return null;

  return (
    <>
    {debug && <ContextPanel meta={meta} onClose={() => setDebug(false)} />}
    <LiveScreen
      spend={<SpendBar variant="compact" />}
      phase={phase}
      paused={paused}
      reconnecting={state.reconnecting}
      demo={meta.demo}
      layout={prefs.liveLayout}
      voice={prefs.voiceVisual}
      mode={mode}
      modeLabel={modeLabel}
      sessionNumber={meta.sessionNumber}
      loopSize={data.settings.loopSize}
      elapsedSec={Math.max(0, Math.round(((state.endedAt ?? now) - state.startedAt) / 1000))}
      interviewer={state.interviewer && state.interviewer.n > 0 ? state.interviewer : (meta?.interviewer ?? NO_ONE)}
      qLabel={state.qLabel}
      qText={qText}
      revealedWords={revealedWords}
      lpName={lpName}
      speaker={state.speaker}
      answerSec={state.answerSec}
      turns={turns}
      hint={state.hint}
      hintText={state.hintText}
      notes={meta.storyNotes ? meta.notes : []}
      notesAllowed={meta.storyNotes}
      coaching={coaching}
      recap={recap}
      micNote={meta.demo ? 'not needed in the demo' : 'granted at setup'}
      onAction={onAction}
      onPlay={onPlay}
      onSaveBest={current ? onSaveBest : undefined}
      onDrill={state.analysis ? onDrill : undefined}
    />
    </>
  );
}

function ContextPanel({ meta, onClose }: { meta: NonNullable<ReturnType<typeof useApp>['live']['meta']>; onClose: () => void }) {
  const c = meta.context;
  const n = (x: number) => x.toLocaleString('en-US');
  return (
    <div className="ctx-debug" role="dialog" aria-label="Context debug">
      <div className="ctx-debug-head"><span>Context · {meta.demo ? 'demo' : 'Gemini Live'}</span><button type="button" onClick={onClose} aria-label="Close">×</button></div>
      {c ? (
        <>
          <div>System prompt ≈ {n(c.estimated)} tokens (estimate){c.counted != null ? ' · ' + n(c.counted) + ' counted' : ''}</div>
          <div>Budget {n(c.budget)} of {n(LIVE_INPUT_TOKENS)} · audio ≈ 32 tokens/s, compression on</div>
          <div>{c.trimmed.length ? 'Trimmed: ' + c.trimmed.join(' · ') : 'Nothing trimmed'}</div>
        </>
      ) : <div>No context built yet.</div>}
    </div>
  );
}
