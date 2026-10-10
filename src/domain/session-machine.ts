// Mock — the live session state machine. One explicit, pure reducer: every state the
// design shows is driven by real events (transport, VAD, transcript sentinels, the
// new_question tool, timers, button tags). No I/O here; the session controller feeds it.
//
//   idle → connecting → interviewer ⇄ answering ⇄ thinking → coaching → interviewer … → ended
//
// `paused` and `reconnecting` are overlays: they remember the state underneath and restore
// it. `hint` is a flag. `error` is a message the UI toasts; it does not change the state.

import type { Analysis, Interviewer, Verdict } from './types.ts';

export type Phase = 'idle' | 'connecting' | 'interviewer' | 'answering' | 'thinking' | 'coaching' | 'ended';
export type Speaker = 'ai' | 'me' | 'none';

export interface Turn { speaker: 'interviewer' | 'coach' | 'me'; text: string; tMs: number }

export interface SessionState {
  phase: Phase;
  /** State underneath a pause; null when not paused. */
  pausedFrom: Phase | null;
  reconnecting: boolean;
  hint: boolean;
  hintText: string;
  /** Current exchange. */
  qIndex: number;           // 0-based count of main questions asked so far − 1
  qLabel: string;           // "Q1"
  qText: string;
  lpName: string;
  questionId: string | null;
  interviewer: Interviewer;
  /** ms, session clock */
  startedAt: number;
  qAskedAt: number | null;
  answerStartedAt: number | null;
  lastVoiceAt: number | null;
  answerSec: number;
  speaker: Speaker;
  aiSpeaking: boolean;
  meSpeaking: boolean;
  /** Coaching: what has been said so far (grows as the transcript arrives) and the card. */
  coachText: string;
  analysis: Analysis | null;
  spokenVerdict: Verdict | null;
  turns: Turn[];
  /** Verdicts so far, in question order, for the recap. */
  answers: { qIndex: number; lpName: string; verdict: Verdict | null; interviewer: Interviewer; fixes: number }[];
  endedAt: number | null;
  focus: string;
  error: string | null;
  /** Monotonic count of main questions, used for ids. */
  questionsAsked: number;
}

export type SessionEvent =
  | { type: 'CONNECT'; now: number }
  | { type: 'READY'; now: number }
  | { type: 'NEW_QUESTION'; now: number; interviewer: Interviewer; question: string; lp: string; questionId?: string | null; hint?: string }
  | { type: 'AI_SPEAKING'; now: number; speaking: boolean }
  | { type: 'ME_SPEAKING'; now: number; speaking: boolean }
  | { type: 'TICK'; now: number; pauseMs: number }
  | { type: 'INPUT_TRANSCRIPT'; now: number; text: string }
  | { type: 'OUTPUT_TRANSCRIPT'; now: number; text: string }
  | { type: 'COACHING_START'; now: number }
  | { type: 'COACHING_END'; now: number }
  | { type: 'ANALYSIS'; now: number; analysis: Analysis }
  | { type: 'HINT'; now: number; text?: string }
  | { type: 'DISMISS_HINT'; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'DISCONNECTED'; now: number; reason?: string }
  | { type: 'RECONNECTED'; now: number }
  | { type: 'END'; now: number; focus?: string }
  | { type: 'ERROR'; now: number; message: string }
  | { type: 'CLEAR_ERROR'; now: number };

export const NO_ONE: Interviewer = { n: 0, name: 'Interviewer', role: 'Interviewer', mono: 'AI' };

export function initialState(now = 0): SessionState {
  return {
    phase: 'idle', pausedFrom: null, reconnecting: false, hint: false, hintText: '',
    qIndex: -1, qLabel: 'Q1', qText: '', lpName: '', questionId: null, interviewer: NO_ONE,
    startedAt: now, qAskedAt: null, answerStartedAt: null, lastVoiceAt: null, answerSec: 0,
    speaker: 'none', aiSpeaking: false, meSpeaking: false,
    coachText: '', analysis: null, spokenVerdict: null, turns: [], answers: [],
    endedAt: null, focus: '', error: null, questionsAsked: 0,
  };
}

/** Sentinels the coach must say; matched loosely because transcription drops punctuation. */
const PAUSING = /pausing\s+the\s+interview/i;
const BACK = /back\s+to\s+the\s+interview/i;
export const hasPausingSentinel = (text: string): boolean => PAUSING.test(text);
export const hasBackSentinel = (text: string): boolean => BACK.test(text);

const MAX_TURNS = 400;

function appendTurn(turns: Turn[], speaker: Turn['speaker'], text: string, tMs: number): Turn[] {
  const last = turns[turns.length - 1];
  // Transcript chunks arrive in pieces; merge consecutive pieces from the same speaker within 5 s.
  if (last && last.speaker === speaker && tMs - last.tMs < 5000) {
    const merged = turns.slice(0, -1);
    const glue = /\s$/.test(last.text) || /^[\s,.;:!?)]/.test(text) || !last.text ? '' : ' ';
    merged.push({ ...last, text: last.text + glue + text, tMs });
    return merged;
  }
  return [...turns, { speaker, text, tMs }].slice(-MAX_TURNS);
}

const speakerOf = (s: SessionState): Speaker => (s.aiSpeaking ? 'ai' : s.meSpeaking ? 'me' : 'none');

export function reduce(s: SessionState, e: SessionEvent): SessionState {
  // Everything after END is final; only CLEAR_ERROR still applies.
  if (s.phase === 'ended' && e.type !== 'CLEAR_ERROR') return s;

  switch (e.type) {
    case 'CONNECT':
      return { ...initialState(e.now), phase: 'connecting' };

    case 'READY':
      return s.phase === 'connecting' ? { ...s, phase: 'interviewer', reconnecting: false } : { ...s, reconnecting: false };

    case 'NEW_QUESTION': {
      // Closes the previous exchange (the controller persists it) and opens a new one.
      const live = s.pausedFrom ? s.pausedFrom : s.phase;
      const next: SessionState = {
        ...s,
        phase: s.pausedFrom ? s.phase : 'interviewer',
        pausedFrom: s.pausedFrom ? 'interviewer' : null,
        qIndex: s.qIndex + 1, qLabel: 'Q' + (s.qIndex + 2), qText: e.question, lpName: e.lp,
        questionId: e.questionId ?? null, interviewer: e.interviewer,
        qAskedAt: e.now, answerStartedAt: null, lastVoiceAt: null, answerSec: 0,
        hint: false, hintText: e.hint ?? s.hintText,
        coachText: '', analysis: null, spokenVerdict: null,
        questionsAsked: s.questionsAsked + 1,
      };
      void live;
      return next;
    }

    case 'AI_SPEAKING': {
      let n: SessionState = { ...s, aiSpeaking: e.speaking };
      n.speaker = speakerOf(n);
      // The interviewer has finished asking: my turn starts when the audio stops.
      if (!e.speaking && n.phase === 'interviewer' && n.qText && n.qAskedAt != null) {
        n = { ...n, phase: 'answering', answerStartedAt: e.now, lastVoiceAt: e.now, answerSec: 0 };
      }
      return n;
    }

    case 'ME_SPEAKING': {
      let n: SessionState = { ...s, meSpeaking: e.speaking };
      // Silence is measured from the end of my last speech, so both edges update the clock.
      n.lastVoiceAt = e.now;
      n.speaker = speakerOf(n);
      if (e.speaking && n.phase === 'thinking') n.phase = 'answering';
      if (e.speaking && n.phase === 'interviewer' && n.qText && !n.aiSpeaking && n.qAskedAt != null) {
        // Barge-in or an early start: the answer clock starts now.
        n = { ...n, phase: 'answering', answerStartedAt: n.answerStartedAt ?? e.now };
      }
      return n;
    }

    case 'TICK': {
      if (s.pausedFrom) return s;
      if (s.phase !== 'answering' && s.phase !== 'thinking') return s;
      const start = s.answerStartedAt ?? e.now;
      const answerSec = Math.floor((e.now - start) / 1000);
      const quietFor = e.now - (s.lastVoiceAt ?? start);
      const phase: Phase = s.meSpeaking ? 'answering' : quietFor > e.pauseMs ? 'thinking' : s.phase;
      return { ...s, answerSec, phase };
    }

    case 'INPUT_TRANSCRIPT':
      return { ...s, turns: appendTurn(s.turns, 'me', e.text, e.now - s.startedAt) };

    case 'OUTPUT_TRANSCRIPT': {
      const coach = s.phase === 'coaching' || (s.pausedFrom === 'coaching');
      let n: SessionState = { ...s, turns: appendTurn(s.turns, coach ? 'coach' : 'interviewer', e.text, e.now - s.startedAt) };
      if (coach) n.coachText = s.coachText + e.text;
      // The sentinels can arrive inside a chunk; honour them here too.
      if (!coach && hasPausingSentinel(e.text)) n = reduce(n, { type: 'COACHING_START', now: e.now });
      else if (coach && hasBackSentinel(e.text)) n = reduce(n, { type: 'COACHING_END', now: e.now });
      return n;
    }

    case 'COACHING_START': {
      if (s.phase === 'coaching' || s.pausedFrom === 'coaching') return s;
      if (s.pausedFrom) return { ...s, pausedFrom: 'coaching' };
      return { ...s, phase: 'coaching', coachText: '', meSpeaking: false, speaker: s.aiSpeaking ? 'ai' : 'none' };
    }

    case 'COACHING_END': {
      if (s.phase !== 'coaching' && s.pausedFrom !== 'coaching') return s;
      // The coached question is finished: clear its answer clock so the next AI pause does not reopen it.
      if (s.pausedFrom) return { ...s, pausedFrom: 'interviewer', qAskedAt: null };
      return { ...s, phase: 'interviewer', qAskedAt: null };
    }

    case 'ANALYSIS': {
      const answers = s.answers.filter((a) => a.qIndex !== s.qIndex);
      answers.push({ qIndex: s.qIndex, lpName: e.analysis.lp || s.lpName, verdict: e.analysis.verdict, interviewer: s.interviewer, fixes: e.analysis.fixes.length });
      answers.sort((a, b) => a.qIndex - b.qIndex);
      return { ...s, analysis: e.analysis, spokenVerdict: e.analysis.spokenVerdict, answers };
    }

    case 'HINT':
      return { ...s, hint: true, hintText: e.text ?? s.hintText };
    case 'DISMISS_HINT':
      return { ...s, hint: false };

    case 'PAUSE':
      if (s.pausedFrom || s.phase === 'idle' || s.phase === 'connecting') return s;
      return { ...s, pausedFrom: s.phase, speaker: 'none', aiSpeaking: false, meSpeaking: false };
    case 'RESUME': {
      if (!s.pausedFrom) return s;
      const back = s.pausedFrom;
      // The pause held the timer: shift the answer clock so the paused time is not counted.
      const shift = (back === 'answering' || back === 'thinking') && s.answerStartedAt != null ? e.now - (s.answerStartedAt + s.answerSec * 1000) : 0;
      return { ...s, phase: back, pausedFrom: null, answerStartedAt: s.answerStartedAt == null ? null : s.answerStartedAt + shift, lastVoiceAt: e.now };
    }

    case 'DISCONNECTED':
      if (s.phase === 'idle') return s;
      return { ...s, reconnecting: true, aiSpeaking: false, speaker: s.meSpeaking ? 'me' : 'none' };
    case 'RECONNECTED':
      return { ...s, reconnecting: false };

    case 'END':
      return { ...s, phase: 'ended', pausedFrom: null, reconnecting: false, hint: false, speaker: 'none', aiSpeaking: false, meSpeaking: false, endedAt: e.now, focus: e.focus ?? s.focus };

    case 'ERROR':
      return { ...s, error: e.message };
    case 'CLEAR_ERROR':
      return { ...s, error: null };
  }
}

/** The phase the UI should draw: the one underneath a pause. */
export const visiblePhase = (s: SessionState): Phase => s.pausedFrom ?? s.phase;
export const isPaused = (s: SessionState): boolean => s.pausedFrom !== null;
