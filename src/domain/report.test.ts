import { describe, it, expect } from 'vitest';
import { localReport, meanVerdict, normalizeReport, topFixes, type ReportInput } from './report.ts';
import { LPS, STORIES, INTERVIEWERS } from '../fixtures/sample.ts';
import type { Analysis, Exchange, Session, Verdict } from './types.ts';

const session = (n: number): Session => ({ id: 's' + n, number: n, mode: 'loop', focus: null, coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, startedAt: '2026-10-0' + n + 'T09:00:00Z', endedAt: null, recordingKey: null, recordingMime: null, report: null });
const analysis = (verdict: Verdict, fixes: string[], extra: Partial<Analysis> = {}): Analysis => ({
  lp: '', storyUsed: null, betterStory: null, numbersMissed: [], star: { s: 25, t: 25, a: 25, r: 25 }, iWeRatio: 0.5,
  delivery: { paceWpm: 150, paceNote: 'good', durationSec: 120, lengthNote: 'good', fixes: 0, fillers: 0, confidence: 0.5, notes: '' } as Analysis['delivery'],
  verdict, spokenVerdict: null, strength: 'Clear numbers.', fixes, createdAt: '', ...extra,
});
const ex = (sid: string, index: number, lpId: string, verdict: Verdict, fixes: string[], iv = 0, extra: Partial<Exchange> = {}, a: Partial<Analysis> = {}): Exchange => ({
  id: sid + '-' + index, sessionId: sid, index, questionId: null, questionText: 'Q' + index, interviewer: INTERVIEWERS[iv], lpId, storyId: null, storyTitle: null,
  startedAt: '', endedAt: null, startMs: 0, endMs: null, clipKey: null, analysis: analysis(verdict, fixes, a), verdict, isBest: false, ...extra,
});

describe('meanVerdict', () => {
  it('rounds toward the weaker verdict on a tie', () => {
    expect(meanVerdict(['strong_hire', 'inclined'])).toBe('inclined');
    expect(meanVerdict(['strong_hire', 'strong_hire', 'inclined'])).toBe('strong_hire');
    expect(meanVerdict(['not_inclined'])).toBe('not_inclined');
  });
});

describe('localReport', () => {
  const s1 = session(1), s2 = session(2);
  const prev = [ex('s1', 0, 'deep', 'not_inclined', ['Open with the numbers.'])];
  const now = [
    ex('s2', 0, 'deep', 'inclined', ['Open with the numbers.', 'Cut the setup.'], 0),
    ex('s2', 1, 'bias', 'not_inclined', ['Name the trip-wire.', 'Say "I".'], 1, { storyTitle: 'Payments outage' }, { betterStory: { storyId: 'mvp', title: 'Launch under ambiguity', reason: 'Fits Bias for Action' } }),
    ex('s2', 2, 'bias', 'strong_no_hire', ['Pick a real story.'], 1),
  ];
  const input: ReportInput = { session: s2, exchanges: now, previous: [{ session: s1, exchanges: prev }], lps: LPS, stories: STORIES, now: new Date('2026-10-02T10:00:00Z') };
  const r = localReport(input);

  it('verdicts per LP and one vote per interviewer', () => {
    expect(r.verdicts).toEqual([{ lpId: 'deep', lpName: 'Dive Deep', verdict: 'inclined' }, { lpId: 'bias', lpName: 'Bias for Action', verdict: 'strong_no_hire' }]);
    expect(r.votes.map((v) => [v.interviewer.name, v.verdict])).toEqual([[INTERVIEWERS[0].name, 'inclined'], [INTERVIEWERS[1].name, 'strong_no_hire']]);
    expect(r.votes[1].reason).toBe('Pick a real story.');
  });
  it('finds the biggest improvement against the last attempt', () => {
    expect(r.improvement).toBe('Dive Deep — not inclined → inclined');
  });
  it('takes three fixes, weakest answers first, no repeats', () => {
    expect(r.fixes).toEqual(['Pick a real story.', 'Name the trip-wire.', 'Open with the numbers.']);
    expect(topFixes([...now, ex('s2', 3, 'deep', 'strong_no_hire', ['Pick a real story!'])])).toHaveLength(3);
  });
  it('story swaps, next focus and its LP', () => {
    expect(r.storySwaps).toEqual([{ lpName: 'Bias for Action', useStory: 'Launch under ambiguity', insteadOf: 'Payments outage' }]);
    expect(r.nextFocus).toBe('Bias for Action — pick a real story.');
    expect(r.nextFocusLpId).toBe('bias');
    expect(r.summary).toBe('3 answers · 1 inclined, 1 not inclined, 1 strong no hire.');
  });
  it('merges a model reply but keeps the verdicts', () => {
    const m = normalizeReport({ summary: 'Good.', votes: [{ interviewer: INTERVIEWERS[1].name.split(' ')[0], reason: 'No owned story.' }], fixes: ['Lead with the number.'], storySwaps: [{ lpName: 'Frugality', useStory: 'Not a story', insteadOf: null }], nextFocus: 'Dive Deep — say the blast radius first.', verdicts: [{ lpName: 'Dive Deep', verdict: 'strong_hire' }] }, input);
    expect(m.verdicts).toEqual(r.verdicts);
    expect(m.summary).toBe('Good.');
    expect(m.votes[1].reason).toBe('No owned story.');
    expect(m.fixes).toEqual(['Lead with the number.']);
    expect(m.storySwaps).toEqual(r.storySwaps); // unknown story dropped → local swaps
    expect(m.nextFocusLpId).toBe('deep');
  });
});
