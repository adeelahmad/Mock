import { describe, expect, it } from 'vitest';
import { areaAccuracy, bestPlay, dealRound, maxScore, playable, rng, roleOf, scoreAnswer, tally, withPlay, GAME_HISTORY, type GamePlay } from './game.ts';
import type { Question } from './types.ts';

const q = (id: string, lpIds: string[]): Question => ({ id, text: id, lpIds, source: 'common', difficulty: 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: '' });

describe('game scoring', () => {
  const Q = q('q1', ['ownership', 'bias', 'deliver']);
  it('first tag is primary, the rest secondary', () => {
    expect(roleOf(Q, 'ownership')).toBe('primary');
    expect(roleOf(Q, 'deliver')).toBe('secondary');
    expect(roleOf(Q, 'frugality')).toBeNull();
  });
  it('+5 primary, +2 secondary, -2 invalid per picked area', () => {
    expect(scoreAnswer(Q, ['ownership']).score).toBe(5);
    expect(scoreAnswer(Q, ['bias']).score).toBe(2);
    expect(scoreAnswer(Q, ['frugality']).score).toBe(-2);
    const s = scoreAnswer(Q, ['ownership', 'bias', 'frugality', 'ownership']);
    expect(s.score).toBe(5);
    expect(s.missed).toEqual([{ areaId: 'deliver', role: 'secondary' }]);
    expect(s.max).toBe(9);
    expect(maxScore(q('x', ['a']))).toBe(5);
  });
  it('tallies hits, misses and wrong picks per area', () => {
    const t = tally({}, scoreAnswer(Q, ['ownership', 'frugality']));
    expect(t).toEqual({ ownership: { hit: 1, miss: 0, wrong: 0 }, frugality: { hit: 0, miss: 0, wrong: 1 }, bias: { hit: 0, miss: 1, wrong: 0 }, deliver: { hit: 0, miss: 1, wrong: 0 } });
  });
});

describe('game rounds and history', () => {
  it('skips untagged questions and unknown areas; deals distinct questions', () => {
    const qs = [q('a', ['x']), q('b', []), q('c', ['y']), q('d', ['zz'])];
    expect(playable(qs, new Set(['x', 'y'])).map((x) => x.id)).toEqual(['a', 'c']);
    const r = dealRound(qs, 3, rng(1));
    expect(r).toHaveLength(3);
    expect(new Set(r.map((x) => x.id)).size).toBe(3);
  });
  it('best score, accuracy worst first, history capped', () => {
    const p = (id: string, score: number, areas: GamePlay['areas']): GamePlay => ({ id, startedAt: '', endedAt: '', questions: 1, score, max: 10, areas });
    const plays = [p('1', 3, { a: { hit: 1, miss: 1, wrong: 0 } }), p('2', 7, { a: { hit: 1, miss: 0, wrong: 0 }, b: { hit: 0, miss: 1, wrong: 1 } })];
    expect(bestPlay(plays)?.id).toBe('2');
    expect(areaAccuracy(plays)).toEqual([{ areaId: 'b', hit: 0, miss: 1, wrong: 1, pct: 0 }, { areaId: 'a', hit: 2, miss: 1, wrong: 0, pct: 67 }]);
    let h: GamePlay[] = [];
    for (let i = 0; i < GAME_HISTORY + 5; i++) h = withPlay(h, p(String(i), i, {}));
    expect(h).toHaveLength(GAME_HISTORY);
    expect(h[0].id).toBe('5');
  });
});
