import { describe, expect, it } from 'vitest';
import {
  addNote, addShape, addStroke, addTemplate, clearBoard, emptyBoard, hasMore, hitAt, mergeBoards, moveNote, remove, restore, setTimer, undoStroke, voteNote, boardOf,
} from './board.ts';
import { emptyCanvas, receiveShared, decodeShared, encodeCanvas, withQuestion } from './canvas.ts';

describe('the shared whiteboard', () => {
  it('merges two people’s edits: both additions survive, the newest change wins, removals stick', () => {
    const base = addNote(emptyBoard(), 'shared', 'me');
    const id = base.notes[0].id;
    let a = addStroke(base, [0, 0, 50, 50], 'me');
    let b = addShape(base, 'rect', 10, 10, 200, 100, 'blue', 'me');
    a = { ...moveNote(a, id, 300, 200) };
    a.notes[0].t = 100; // older move
    b = { ...voteNote(b, id) }; b.notes[0].t = 200; // newer vote
    const m = mergeBoards(a, b);
    expect(m.strokes).toHaveLength(1);
    expect(m.shapes).toHaveLength(1);
    expect(m.notes[0].votes).toBe(1);
    const gone = remove(m, [m.strokes[0].id]);
    expect(mergeBoards(gone, m).strokes).toHaveLength(0);
    expect(mergeBoards(m, gone).strokes).toHaveLength(0);
    expect(hasMore(m, b)).toBe(true);
    expect(hasMore(b, m)).toBe(false);
  });

  it('takes the question from the driver but keeps everyone’s board', () => {
    const mine = addNote(emptyCanvas(), 'my note', 'me');
    const theirs = addStroke(withQuestion(emptyCanvas(), { id: 'q9', text: 'Q nine' }), [0, 0, 9, 9], 'me');
    const viewer = receiveShared(mine, theirs, true, false);
    expect(viewer.questionId).toBe('q9');
    expect(viewer.notes).toHaveLength(1);
    expect(viewer.strokes).toHaveLength(1);
    const driver = receiveShared(mine, theirs, false, true);
    expect(driver.questionId).toBe('');
    expect(driver.strokes).toHaveLength(1);
    const msg = decodeShared(encodeCanvas(theirs, undefined, false));
    expect(msg?.driver).toBe(false);
    expect(msg?.state.shapes).toEqual([]);
  });

  it('undo and redo come back as ordinary changes', () => {
    const b0 = addNote(emptyBoard(), 'keep', 'me');
    const b1 = addStroke(clearBoard(b0), [0, 0, 20, 20], 'me');
    const back = restore(b1, boardOf(b0));
    expect(back.notes.map((n) => n.text)).toEqual(['keep']);
    expect(back.strokes).toHaveLength(0);
    // Someone who saw the clear gets the note back.
    expect(mergeBoards(b1, back).notes).toHaveLength(1);
  });

  it('finds what the eraser touches and undoes your last stroke or shape', () => {
    let b = addStroke(emptyBoard(), [0, 0, 100, 0], 'me');
    b = addShape(b, 'rect', 200, 200, 400, 300, 'red', 'me');
    expect(hitAt(b, 50, 4)).toBe(b.strokes[0].id);
    expect(hitAt(b, 200, 250)).toBe(b.shapes[0].id);
    expect(hitAt(b, 300, 250)).toBeNull(); // inside a rectangle is empty
    b.shapes[0].t = (b.strokes[0].t ?? 0) + 1;
    expect(undoStroke(b).shapes).toHaveLength(0);
  });

  it('lays templates and runs a timer', () => {
    const star = addTemplate(emptyBoard(), 'star');
    expect(star.shapes).toHaveLength(4);
    expect(star.notes.filter((n) => n.kind === 'text').map((n) => n.text)).toEqual(['Situation', 'Task', 'Action', 'Result']);
    for (const t of ['pros', 'timeline', 'map'] as const) expect(addTemplate(emptyBoard(), t).notes.length).toBeGreaterThan(1);
    const timed = setTimer(emptyBoard(), 120_000, 1000);
    expect(timed.timer).toEqual({ end: 121_000, t: 1000 });
    expect(mergeBoards(emptyBoard(), timed).timer.end).toBe(121_000);
  });
});
