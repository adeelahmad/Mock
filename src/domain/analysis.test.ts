import { describe, it, expect } from 'vitest';
import { extractSpokenVerdict, measureDelivery, normalizeAnalysis, normalizeStar, paceNoteFor, lengthNoteFor } from './analysis.ts';
import { STORIES } from '../fixtures/sample.ts';

describe('spoken verdict', () => {
  it('reads each verdict and never confuses the longer phrases', () => {
    expect(extractSpokenVerdict('Verdict on Dive Deep: not inclined. Redo it?')).toBe('not_inclined');
    expect(extractSpokenVerdict('That is a strong hire from me.')).toBe('strong_hire');
    expect(extractSpokenVerdict('Honestly, strong no hire.')).toBe('strong_no_hire');
    expect(extractSpokenVerdict('Strong-no-hire as it stands')).toBe('strong_no_hire');
    expect(extractSpokenVerdict('I am inclined.')).toBe('inclined');
    expect(extractSpokenVerdict('No verdict yet.')).toBeNull();
  });
  it('takes the last verdict named', () => {
    expect(extractSpokenVerdict('Last time not inclined; today, inclined.')).toBe('inclined');
  });
});

describe('measured delivery', () => {
  it('counts words, pace and fillers of my turns only', () => {
    const turns = [
      { speaker: 'interviewer' as const, text: 'Tell me about a time.', tMs: 0 },
      { speaker: 'me' as const, text: 'Um so basically I ' + 'word '.repeat(296), tMs: 1000 },
    ];
    const d = measureDelivery(turns, 120);
    expect(d.words).toBe(300);
    expect(d.paceWpm).toBe(150);
    expect(d.paceNote).toBe('good');
    expect(d.lengthNote).toBe('good');
    expect(d.fillers).toBe(2);
  });
  it('notes slow/fast and short/long at the edges', () => {
    expect(paceNoteFor(120)).toBe('slow');
    expect(paceNoteFor(190)).toBe('fast');
    expect(lengthNoteFor(60)).toBe('short');
    expect(lengthNoteFor(200)).toBe('long');
  });
});

describe('normalizeAnalysis', () => {
  const measured = measureDelivery([{ speaker: 'me', text: 'I did it. '.repeat(50), tMs: 0 }], 100);
  it('repairs a sloppy reply and keeps measured delivery', () => {
    const a = normalizeAnalysis({
      lp: '', storyUsed: 'payments outage', betterStory: { title: 'Payments outage', reason: 'same' },
      numbersMissed: [{ notes: '41 min', said: '' }, { notes: '' }], star: { s: 50, t: 50, a: 50, r: 0 },
      iWeRatio: 1.7, delivery: { paceWpm: 999, confidence: '0.8' }, verdict: 'meh', fixes: ['a', 'b', 'c', 'd', ''],
    }, { measured, stories: STORIES, lpName: 'Dive Deep', coachText: 'Verdict: inclined.' });
    expect(a.lp).toBe('Dive Deep');
    expect(a.storyUsed).toBe('Payments outage');
    expect(a.betterStory).toBeNull(); // same story is not "better"
    expect(a.numbersMissed).toEqual([{ notes: '41 min', said: 'not said' }]);
    expect(a.star.s + a.star.t + a.star.a + a.star.r).toBe(100);
    expect(a.iWeRatio).toBe(1);
    expect(a.delivery.paceWpm).toBe(measured.paceWpm);
    expect(a.delivery.durationSec).toBe(100);
    expect(a.delivery.confidence).toBe(0.8);
    expect(a.verdict).toBe('not_inclined');
    expect(a.spokenVerdict).toBe('inclined');
    expect(a.fixes).toEqual(['a', 'b', 'c']);
  });
  it('maps a better story to its id', () => {
    const a = normalizeAnalysis({ verdict: 'inclined', storyUsed: 'none', betterStory: { title: 'Observability cost cut', reason: 'Frugal' } }, { measured, stories: STORIES, lpName: 'Frugality', coachText: '' });
    expect(a.storyUsed).toBeNull();
    expect(a.betterStory).toEqual({ storyId: 'logging', title: 'Observability cost cut', reason: 'Frugal' });
  });
  it('splits STAR evenly when empty and rounds to 100', () => {
    expect(normalizeStar(null)).toEqual({ s: 25, t: 25, a: 25, r: 25 });
    const x = normalizeStar({ s: 1, t: 1, a: 1, r: 0 });
    expect(x.s + x.t + x.a + x.r).toBe(100);
  });
});
