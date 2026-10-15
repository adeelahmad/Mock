import { describe, expect, it } from 'vitest';
import { CanvasLog, verdictOf } from './session.ts';
import { boardSvg, wrap } from './board-image.ts';
import { addNote, addStroke, emptyCanvas, undoStroke, type Phrase } from '../domain/canvas.ts';
import { MemoryRepo, emptyData } from '../db/memory.ts';

const ph = (mark: Phrase['mark'], text = 'words'): Phrase => ({ id: Math.random().toString(36), text, mark, note: '', by: 'ai' });

describe('a canvas sitting in History', () => {
  it('saves each answered question as an exchange, with the transcript in order', async () => {
    let t = 1_000_000;
    const repo = new MemoryRepo(emptyData());
    await repo.init();
    const log = await CanvasLog.begin(repo, { meet: true }, () => t);
    expect(log.session.mode).toBe('canvas');

    log.startAnswer({ questionId: 'q1', questionText: 'Tell me about a time you cut costs.', lpId: 'frugality' });
    t += 2000; log.say('me', 'I cut our AWS bill by 40 percent.');
    t += 1000; log.say('coach', 'Strong number.');
    t += 1000; log.endAnswer([ph('match'), ph('match')]);
    // A redo with nothing said is dropped.
    log.startAnswer({ questionId: 'q1', questionText: 'Tell me about a time you cut costs.', lpId: 'frugality' });
    log.endAnswer([]);
    log.startAnswer({ questionId: 'q2', questionText: 'A time you disagreed?', lpId: 'backbone' });
    t += 5000; log.say('me', 'We usually agree.');
    const done = await log.finish([ph('drift'), ph('redo'), ph('redo')]);

    expect(done?.answers).toBe(2);
    const session = await repo.session(log.session.id);
    expect(session?.endedAt).toBeTruthy();
    expect(session?.focus).toBe('meet');
    const xs = (await repo.exchanges(log.session.id)).sort((a, b) => a.index - b.index);
    expect(xs.map((x) => [x.index, x.questionId, x.verdict])).toEqual([[0, 'q1', 'strong_hire'], [1, 'q2', 'strong_no_hire']]);
    expect(xs[0].endMs).toBe(4000);
    const tr = await repo.transcript(log.session.id);
    expect(tr.map((e) => e.speaker + ':' + e.text)).toEqual(expect.arrayContaining(['interviewer:Tell me about a time you cut costs.', 'me:I cut our AWS bill by 40 percent.', 'coach:Strong number.', 'interviewer:A time you disagreed?']));
    expect(tr.find((e) => e.text === 'Strong number.')?.exchangeId).toBe(xs[0].id);
  });

  it('deletes a sitting where nothing was said', async () => {
    const repo = new MemoryRepo(emptyData());
    await repo.init();
    const log = await CanvasLog.begin(repo, { meet: false });
    log.startAnswer({ questionId: 'q1', questionText: 'Q', lpId: null });
    expect(await log.finish([])).toBeNull();
    expect(await repo.sessions()).toEqual([]);
  });

  it('gives an answer a verdict from its marks', () => {
    expect(verdictOf([])).toBeNull();
    expect(verdictOf([ph('pending')])).toBeNull();
    expect(verdictOf([ph('match'), ph('match')])).toBe('strong_hire');
    expect(verdictOf([ph('match'), ph('match'), ph('match'), ph('drift')])).toBe('inclined');
    expect(verdictOf([ph('match'), ph('drift')])).toBe('not_inclined');
    expect(verdictOf([ph('redo'), ph('match')])).toBe('strong_no_hire');
  });
});

describe('the whiteboard', () => {
  it('undoes only your own last stroke', () => {
    let s = addStroke(emptyCanvas(), [0, 0, 10, 10], 'me');
    s = addStroke(s, [5, 5, 20, 20], 'ai');
    s = undoStroke(s);
    expect(s.strokes.map((x) => x.by)).toEqual(['ai']);
    expect(undoStroke(s)).toBe(s);
  });

  it('draws as an SVG picture with escaped, wrapped notes', () => {
    const s = addNote(addStroke(emptyCanvas(), [0, 0, 10, 10], 'me'), 'S <then> T & A: a very long note that has to wrap over lines', 'ai');
    const svg = boardSvg(s.notes, s.strokes);
    expect(svg).toContain('<path d="M0 0L10 10"');
    expect(svg).toContain('S &lt;then&gt; T &amp; A:');
    expect(svg).not.toContain('<then>');
    expect(wrap('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc']);
    expect(wrap('x'.repeat(12), 5)).toEqual(['xxxxx', 'xxxxx', 'xx']);
  });
});
