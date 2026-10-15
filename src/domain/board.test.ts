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

describe('following on the board', () => {
  it('shares who leads and their view; only the leader stops it', async () => {
    const { lead, stopLead, NO_LEAD } = await import('./board.ts');
    const led = lead(emptyBoard(), 'p1', 'the host', { zoom: 1.5, x: 0.4, y: 2 }, 50);
    expect(led.lead).toEqual({ who: 'p1', name: 'the host', zoom: 1.5, x: 0.4, y: 1, t: 50 });
    const theirs = mergeBoards(emptyBoard(), led);
    expect(theirs.lead.who).toBe('p1');
    expect(stopLead(theirs, 'p2')).toBe(theirs);
    const stopped = stopLead(theirs, 'p1', 60);
    expect(stopped.lead).toEqual({ ...NO_LEAD, t: 60 });
    expect(mergeBoards(led, stopped).lead.who).toBe('');
    expect(hasMore(stopped, led)).toBe(true);
  });
});

describe('a video everyone watches', () => {
  it('reads YouTube and video file links', async () => {
    const { videoSource } = await import('./board.ts');
    for (const l of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'])
      expect(videoSource(l)).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&playsinline=1&rel=0' });
    expect(videoSource('https://cdn.example.com/talk.mp4')).toEqual({ kind: 'file', url: 'https://cdn.example.com/talk.mp4' });
    expect(videoSource('http://cdn.example.com/talk.mp4')).toBeNull();
    expect(videoSource('https://example.com/page')).toBeNull();
    expect(videoSource('javascript:alert(1)')).toBeNull();
    expect(videoSource('https://youtu.be/<bad>')).toBeNull();
    expect(videoSource('https://cdn.example.com/live/index.m3u8?token=1')).toEqual({ kind: 'hls', url: 'https://cdn.example.com/live/index.m3u8?token=1' });
    expect(videoSource('https://cam.example.com/mjpeg')?.kind).toBe('mjpeg');
    expect(videoSource('https://cam.example.com/axis-cgi/mjpg/video.cgi')?.kind).toBe('mjpeg');
    expect(videoSource('https://cam.example.com/?action=stream')?.kind).toBe('mjpeg');
    expect(videoSource('http://cam.example.com/live.m3u8')).toBeNull();
    expect(videoSource('rtsp://cam.local/stream')).toBeNull();
    const { videoProblem } = await import('./board.ts');
    expect(videoProblem('rtsp://cam.local/stream')).toMatch(/RTSP.*HLS/);
    expect(videoProblem('http://cam.local/live.m3u8')).toMatch(/https/);
  });

  it('plays and pauses for everyone from a shared position', async () => {
    const { setVideo, playVideo, videoPosition } = await import('./board.ts');
    const b = setVideo(emptyBoard(), 'https://youtu.be/dQw4w9WgXcQ', 1000);
    const playing = playVideo(b, true, 30, 2000);
    expect(videoPosition(playing.video, 12_000)).toBe(40);
    const paused = playVideo(playing, false, 41, 13_000);
    expect(videoPosition(paused.video, 99_000)).toBe(41);
    expect(mergeBoards(playing, paused).video.playing).toBe(false);
    expect(playVideo(emptyBoard(), true, 5)).toEqual(emptyBoard());
    expect(setVideo(paused, null, 14_000).video.url).toBe('');
  });
});
