import { describe, expect, it } from 'vitest';
import {
  addChat, addNote, addPhrases, addStroke, canvasQuestions, clearBoard, decodeCanvas, editNote, emptyCanvas, encodeCanvas, localMark,
  markPhrase, moveNote, nextQuestion, pickArea, referenceFor, removeNote, splitPhrases, summarize, withQuestion, BOARD_W, type Mark, type Phrase,
} from './canvas.ts';
import { rng } from './game.ts';
import { LPS, QUESTIONS, STORIES } from '../fixtures/sample.ts';
import type { Question } from './types.ts';

const q = (id: string, lpIds: string[], timesAsked = 0): Question => ({ id, text: 'Q ' + id, lpIds, source: 'common', difficulty: 2, timesAsked, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: '' });

describe('canvas questions and the area pick', () => {
  it('uses questions tagged with a known area; unseen and least asked first', () => {
    const qs = [q('a', ['x'], 3), q('b', []), q('c', ['y'], 1), q('d', ['zz'])];
    const pool = canvasQuestions(qs, new Set(['x', 'y']));
    expect(pool.map((x) => x.id)).toEqual(['a', 'c']);
    expect(nextQuestion(pool, new Set(), rng(1))?.id).toBe('c');
    expect(nextQuestion(pool, new Set(['c']), rng(1))?.id).toBe('a');
    expect(nextQuestion(pool, new Set(['a', 'c']), rng(1))?.id).toBe('c');
    expect(nextQuestion([], new Set())).toBeNull();
  });

  it('a wrong pick is remembered; a right one opens the answer with its role', () => {
    const Q = q('q1', ['own', 'bias']);
    let s = withQuestion(emptyCanvas(), Q);
    expect(s.phase).toBe('pick');
    let r = pickArea(s, Q, 'frugal');
    expect(r.ok).toBe(false);
    expect(r.state.misses).toEqual(['frugal']);
    s = pickArea(r.state, Q, 'frugal').state;
    expect(s.misses).toEqual(['frugal']);
    r = pickArea(s, Q, 'bias');
    expect(r).toMatchObject({ ok: true, role: 'secondary' });
    expect(r.state).toMatchObject({ phase: 'answer', areaId: 'bias', role: 'secondary' });
    // Once answering, picks change nothing.
    expect(pickArea(r.state, Q, 'own').state).toBe(r.state);
  });

  it('a new question keeps the board and the chat, clears the answer', () => {
    let s = addNote(addChat(emptyCanvas(), 'me', 'hi'), 'STAR', 'ai');
    s = addPhrases(pickArea(withQuestion(s, q('a', ['x'])), q('a', ['x']), 'x').state, ['one']).state;
    const n = withQuestion(s, q('b', ['y']));
    expect(n).toMatchObject({ questionId: 'b', phase: 'pick', areaId: null, phrases: [], misses: [] });
    expect(n.notes).toHaveLength(1);
    expect(n.chat).toHaveLength(1);
  });
});

describe('phrases and marks', () => {
  it('cuts speech into sentences and long sentences at commas', () => {
    expect(splitPhrases('I led the team.  We shipped it!  Then?')).toEqual(['I led the team.', 'We shipped it!', 'Then?']);
    const long = 'In my last role at the payments company, I noticed the retry queue was growing every night, so I traced it to a bad timeout and fixed it with the owning team the same week';
    const parts = splitPhrases(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toBe(long);
    expect(splitPhrases('   ')).toEqual([]);
  });

  it('offline: hedges and filler are redo, first-person action or numbers on track, general talk drifts', () => {
    const ref = new Set(['latency', 'cache']);
    expect(localMark("Honestly I don't know.", ref).mark).toBe('redo');
    expect(localMark('um like you know basically um', ref).mark).toBe('redo');
    expect(localMark('I traced it and cut p99 by 40 percent.', ref)).toEqual({ mark: 'match', note: 'Your action and a number.' });
    expect(localMark('The latency came from the cache layer.', ref).mark).toBe('match');
    expect(localMark('We usually follow best practice in general.', ref).mark).toBe('drift');
    expect(localMark('The team was fine and things were good.', ref).note).toMatch(/Drifting/);
    expect(localMark('We were fine and things were good.', ref).note).toMatch(/Say I, not we/);
  });

  it('the reference is the area, the question and the best story for it', () => {
    const area = LPS[0];
    const r = referenceFor(area.id, LPS, STORIES, 'Tell me about a time');
    expect(r.area?.id).toBe(area.id);
    if (r.story) expect(r.story.links.some((l) => l.lpId === area.id)).toBe(true);
    expect(r.words.size).toBeGreaterThan(3);
    expect(referenceFor(null, LPS, STORIES, '').area).toBeNull();
  });

  it('marks land on their phrase; the summary weighs them', () => {
    let { state: s, added } = addPhrases(emptyCanvas(), ['a', 'b', 'c', 'd', 'e']);
    expect(added.every((p) => p.mark === 'pending')).toBe(true);
    expect(summarize(s.phrases)).toMatchObject({ pending: 5, overall: null, line: 'Listening…' });
    s = ['match', 'match', 'match', 'drift', 'redo'].reduce((x, m, i) => markPhrase(x, added[i].id, m as Mark, 'n', 'local'), s);
    expect(summarize(s.phrases)).toMatchObject({ match: 3, drift: 1, redo: 1, overall: 'match' });
    const redo = (['redo', 'redo', 'match'] as const).map((mark, i): Phrase => ({ id: String(i), text: '', mark, note: '', by: 'local' }));
    expect(summarize(redo).overall).toBe('redo');
    expect(summarize([{ id: '1', text: '', mark: 'drift', note: '', by: 'ai' }, { id: '2', text: '', mark: 'match', note: '', by: 'ai' }]).overall).toBe('drift');
    expect(summarize([]).line).toMatch(/Answer out loud/);
  });
});

describe('board and chat', () => {
  it('notes are placed, moved inside the board, edited and removed; short strokes are dropped', () => {
    let s = addNote(emptyCanvas(), '  Outline  ', 'ai');
    const n = s.notes[0];
    expect(n).toMatchObject({ text: 'Outline', by: 'ai' });
    s = moveNote(s, n.id, 5000, -20);
    expect(s.notes[0].x).toBe(BOARD_W - 200);
    expect(s.notes[0].y).toBe(0);
    s = editNote(s, n.id, 'S T A R');
    expect(s.notes[0].text).toBe('S T A R');
    s = addStroke(addStroke(s, [1, 2], 'me'), [1.4, 2.6, 10, 20], 'me');
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0].points).toEqual([1, 3, 10, 20]);
    expect(removeNote(s, n.id).notes).toEqual([]);
    expect(clearBoard(s)).toMatchObject({ notes: [], strokes: [] });
  });

  it('shares as bytes and drops old strokes to fit', () => {
    let s = addChat(withQuestion(emptyCanvas(), QUESTIONS[0]), 'me', 'hello', true);
    const back = decodeCanvas(encodeCanvas(s));
    expect(back).toEqual(s);
    for (let i = 0; i < 200; i++) s = addStroke(s, Array.from({ length: 80 }, (_, k) => k * 7 + i), 'me');
    const bytes = encodeCanvas(s, 20_000);
    expect(bytes.length).toBeLessThanOrEqual(20_000);
    const small = decodeCanvas(bytes)!;
    expect(small.strokes.length).toBeLessThan(200);
    expect(small.strokes[small.strokes.length - 1]).toEqual(s.strokes[s.strokes.length - 1]);
    expect(decodeCanvas(new TextEncoder().encode('{"v":2}'))).toBeNull();
    expect(decodeCanvas(new TextEncoder().encode('nope'))).toBeNull();
  });
});
