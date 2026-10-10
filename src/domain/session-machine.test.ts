import { describe, it, expect } from 'vitest';
import { initialState, reduce, visiblePhase, isPaused, type SessionEvent, type SessionState } from './session-machine.ts';
import type { Analysis } from './types.ts';

const dana = { n: 3, name: 'Dana Whitfield', role: 'Bar Raiser', mono: 'DW' };
const analysis: Analysis = {
  lp: 'Dive Deep', storyUsed: 'Payments outage', betterStory: null, numbersMissed: [], star: { s: 35, t: 10, a: 40, r: 15 }, iWeRatio: 0.38,
  delivery: { paceWpm: 168, paceNote: 'fast', durationSec: 252, lengthNote: 'long', fillers: 11, confidence: 0.6, notes: '' },
  verdict: 'not_inclined', spokenVerdict: 'not_inclined', strength: 'Named the component.', fixes: ['Open with the numbers.', 'Cut the setup.'], createdAt: '2026-10-10T00:00:00Z',
};

function run(events: SessionEvent[], from: SessionState = initialState(0)): SessionState {
  return events.reduce(reduce, from);
}
const ask = (now: number): SessionEvent => ({ type: 'NEW_QUESTION', now, interviewer: dana, question: 'Tell me about a time you found a problem others had missed.', lp: 'Dive Deep', questionId: 'q3', hint: 'Try the Payments outage story.' });

describe('session machine', () => {
  it('starts idle, connects, becomes interviewer on READY', () => {
    let s = initialState(0);
    expect(s.phase).toBe('idle');
    s = reduce(s, { type: 'CONNECT', now: 0 });
    expect(s.phase).toBe('connecting');
    s = reduce(s, { type: 'READY', now: 100 });
    expect(s.phase).toBe('interviewer');
  });

  it('new_question opens an exchange and resets the answer clock', () => {
    const s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000)]);
    expect(s.phase).toBe('interviewer');
    expect(s.qLabel).toBe('Q1');
    expect(s.qIndex).toBe(0);
    expect(s.qText).toMatch(/found a problem/);
    expect(s.lpName).toBe('Dive Deep');
    expect(s.interviewer.mono).toBe('DW');
    expect(s.answerSec).toBe(0);
    expect(s.analysis).toBeNull();
    const s2 = reduce(s, ask(5000));
    expect(s2.qLabel).toBe('Q2');
    expect(s2.questionsAsked).toBe(2);
  });

  it('my turn starts when the interviewer stops speaking', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'AI_SPEAKING', now: 1000, speaking: true }]);
    expect(s.phase).toBe('interviewer');
    expect(s.speaker).toBe('ai');
    s = reduce(s, { type: 'AI_SPEAKING', now: 4000, speaking: false });
    expect(s.phase).toBe('answering');
    expect(s.answerStartedAt).toBe(4000);
    expect(s.speaker).toBe('none');
  });

  it('a thinking pause does not end my turn; speaking again returns to answering', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'AI_SPEAKING', now: 1000, speaking: true }, { type: 'AI_SPEAKING', now: 4000, speaking: false }, { type: 'ME_SPEAKING', now: 4500, speaking: true }]);
    expect(s.phase).toBe('answering');
    expect(s.speaker).toBe('me');
    s = reduce(s, { type: 'ME_SPEAKING', now: 10000, speaking: false });
    s = reduce(s, { type: 'TICK', now: 11000, pauseMs: 2500 });
    expect(s.phase).toBe('answering'); // 1 s quiet < 2.5 s
    s = reduce(s, { type: 'TICK', now: 13000, pauseMs: 2500 });
    expect(s.phase).toBe('thinking');
    expect(s.answerSec).toBe(9);
    s = reduce(s, { type: 'ME_SPEAKING', now: 14000, speaking: true });
    expect(s.phase).toBe('answering');
  });

  it('coaching starts on "Pausing the interview." and ends on "Back to the interview."', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'AI_SPEAKING', now: 1000, speaking: true }, { type: 'AI_SPEAKING', now: 4000, speaking: false }]);
    s = reduce(s, { type: 'OUTPUT_TRANSCRIPT', now: 30000, text: 'Thanks. Pausing the interview' });
    expect(s.phase).toBe('coaching');
    s = reduce(s, { type: 'OUTPUT_TRANSCRIPT', now: 31000, text: ' One strength: you named the component.' });
    expect(s.coachText).toContain('named the component');
    expect(s.turns[s.turns.length - 1].speaker).toBe('coach');
    s = reduce(s, { type: 'OUTPUT_TRANSCRIPT', now: 40000, text: ' Back to the interview.' });
    expect(s.phase).toBe('interviewer');
    // sentinel matching is loose
    expect(reduce(s, { type: 'OUTPUT_TRANSCRIPT', now: 41000, text: 'pausing   the Interview, okay' }).phase).toBe('coaching');
  });

  it('the analysis card lands in the current exchange and the recap', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'COACHING_START', now: 2000 }]);
    s = reduce(s, { type: 'ANALYSIS', now: 3000, analysis });
    expect(s.analysis?.verdict).toBe('not_inclined');
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0]).toMatchObject({ qIndex: 0, lpName: 'Dive Deep', verdict: 'not_inclined', fixes: 2 });
    // a redo replaces the answer for the same question index
    s = reduce(s, { type: 'ANALYSIS', now: 4000, analysis: { ...analysis, verdict: 'inclined' } });
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0].verdict).toBe('inclined');
  });

  it('hint shows and dismisses', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000)]);
    s = reduce(s, { type: 'HINT', now: 2000 });
    expect(s.hint).toBe(true);
    expect(s.hintText).toMatch(/Payments outage/);
    s = reduce(s, { type: 'DISMISS_HINT', now: 2500 });
    expect(s.hint).toBe(false);
  });

  it('pause is an overlay that holds the timer; resume restores the state underneath', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'AI_SPEAKING', now: 1000, speaking: true }, { type: 'AI_SPEAKING', now: 4000, speaking: false }, { type: 'ME_SPEAKING', now: 4500, speaking: true }, { type: 'TICK', now: 14000, pauseMs: 2500 }]);
    expect(s.answerSec).toBe(10);
    s = reduce(s, { type: 'PAUSE', now: 14000 });
    expect(isPaused(s)).toBe(true);
    expect(s.phase).toBe('answering');
    expect(visiblePhase(s)).toBe('answering');
    s = reduce(s, { type: 'TICK', now: 30000, pauseMs: 2500 });
    expect(s.answerSec).toBe(10); // held
    s = reduce(s, { type: 'RESUME', now: 30000 });
    expect(isPaused(s)).toBe(false);
    s = reduce(s, { type: 'TICK', now: 31000, pauseMs: 2500 });
    expect(s.answerSec).toBe(11); // paused time not counted
  });

  it('cannot pause before the session has started', () => {
    const s = run([{ type: 'CONNECT', now: 0 }, { type: 'PAUSE', now: 1 }]);
    expect(isPaused(s)).toBe(false);
  });

  it('a new question arriving while paused is applied underneath', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'PAUSE', now: 2000 }, ask(3000)]);
    expect(isPaused(s)).toBe(true);
    expect(s.qLabel).toBe('Q2');
    s = reduce(s, { type: 'RESUME', now: 4000 });
    expect(s.phase).toBe('interviewer');
  });

  it('reconnecting is a non-blocking overlay', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'AI_SPEAKING', now: 1000, speaking: true }, { type: 'AI_SPEAKING', now: 4000, speaking: false }, { type: 'ME_SPEAKING', now: 5000, speaking: true }]);
    s = reduce(s, { type: 'DISCONNECTED', now: 6000, reason: 'goAway' });
    expect(s.reconnecting).toBe(true);
    expect(s.phase).toBe('answering'); // keeps recording my answer
    expect(s.speaker).toBe('me');
    s = reduce(s, { type: 'READY', now: 7000 });
    expect(s.reconnecting).toBe(false);
    expect(s.phase).toBe('answering');
  });

  it('transcript turns merge consecutive chunks and keep the speaker', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000)]);
    s = reduce(s, { type: 'OUTPUT_TRANSCRIPT', now: 1000, text: 'Tell me about' });
    s = reduce(s, { type: 'OUTPUT_TRANSCRIPT', now: 1500, text: ' a time.' });
    s = reduce(s, { type: 'INPUT_TRANSCRIPT', now: 5000, text: 'Sure.' });
    expect(s.turns).toEqual([{ speaker: 'interviewer', text: 'Tell me about a time.', tMs: 1500 }, { speaker: 'me', text: 'Sure.', tMs: 5000 }]);
  });

  it('END is final and records the focus', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'END', now: 9000, focus: 'Dive Deep — numbers first.' }]);
    expect(s.phase).toBe('ended');
    expect(s.focus).toMatch(/numbers first/);
    expect(s.endedAt).toBe(9000);
    expect(reduce(s, ask(10000)).phase).toBe('ended');
    expect(reduce(s, { type: 'PAUSE', now: 10000 }).phase).toBe('ended');
  });

  it('errors are surfaced without changing the phase', () => {
    let s = run([{ type: 'CONNECT', now: 0 }, { type: 'READY', now: 1 }, ask(1000), { type: 'ERROR', now: 2000, message: 'socket' }]);
    expect(s.error).toBe('socket');
    expect(s.phase).toBe('interviewer');
    s = reduce(s, { type: 'CLEAR_ERROR', now: 2500 });
    expect(s.error).toBeNull();
  });
});
