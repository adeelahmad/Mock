// Mock — a canvas sitting saved to History. From the first Listen until Stop (or leaving the
// canvas) the sitting is one session: each answered question is an exchange with its marked
// phrases and the AI's words in the transcript, and the audio the canvas heard (the mic, or the
// Meet call) is recorded and saved with it, so History plays it back like a practice session.
// Answers' verdicts come from their marks (domain/canvas.ts summarize).

import type { Repo } from '../db/repo.ts';
import { newId } from '../db/repo.ts';
import { summarize, type Mark, type Phrase } from '../domain/canvas.ts';
import type { Exchange, Interviewer, Session, TranscriptEvent, Verdict } from '../domain/types.ts';
import { recorderMime } from '../live/audio.ts';

export const CANVAS_COACH: Interviewer = { n: 0, name: 'Canvas AI', role: 'Coach', mono: 'AI' };

/** An answer's verdict from its marks: all on track is strong, mostly on track inclined. */
export function verdictOf(phrases: Phrase[]): Verdict | null {
  const s = summarize(phrases);
  if (!s.overall) return null;
  const v: Record<Mark, Verdict> = { match: s.drift + s.redo === 0 ? 'strong_hire' : 'inclined', drift: 'not_inclined', redo: 'strong_no_hire' };
  return v[s.overall];
}

export interface AnswerStart { questionId: string | null; questionText: string; lpId: string | null }

/** Records audio from one stream, in order; `blob()` stops it and returns the whole recording. */
export class StreamRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  constructor(stream: MediaStream) {
    if (typeof MediaRecorder === 'undefined') return;
    const mimeType = recorderMime();
    try {
      this.rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.rec.start(1000);
    } catch { this.rec = null; }
  }
  pause(on: boolean): void {
    const r = this.rec; if (!r) return;
    try { if (on && r.state === 'recording') r.pause(); else if (!on && r.state === 'paused') r.resume(); } catch { /* unsupported */ }
  }
  async blob(): Promise<Blob | null> {
    const r = this.rec; this.rec = null;
    if (r && r.state !== 'inactive') await new Promise<void>((res) => { r.addEventListener('stop', () => res(), { once: true }); r.stop(); });
    return this.chunks.length ? new Blob(this.chunks, { type: r?.mimeType || this.chunks[0].type }) : null;
  }
}

/** The session being written. Writes are queued so they land in order. */
export class CanvasLog {
  readonly session: Session;
  private t0: number;
  private exchange: Exchange | null = null;
  private index = 0;
  private answered = 0;
  private events = 0;
  private q: Promise<unknown> = Promise.resolve();
  private recorder: StreamRecorder | null = null;
  private ended = false;

  private constructor(private repo: Repo, session: Session, private now: () => number) { this.session = session; this.t0 = now(); }

  static async begin(repo: Repo, opts: { meet: boolean }, now: () => number = Date.now): Promise<CanvasLog> {
    const number = await repo.nextSessionNumber();
    const session: Session = {
      id: newId('s'), number, mode: 'canvas', focus: opts.meet ? 'meet' : null, coaching: 'after_each', questionSource: 'bank', storyNotes: false, seed: 0,
      startedAt: new Date(now()).toISOString(), endedAt: null, recordingKey: null, recordingMime: null, report: null,
    };
    await repo.insertSession(session);
    return new CanvasLog(repo, session, now);
  }

  private ms(): number { return Math.max(0, this.now() - this.t0); }
  private run(f: () => Promise<unknown>): void { this.q = this.q.then(f).catch(() => { /* a failed write never stops the canvas */ }); }

  /** Elapsed time, ms. */
  elapsed(): number { return this.ms(); }
  /** Answers saved so far. */
  count(): number { return this.answered + (this.exchange ? 1 : 0); }

  record(stream: MediaStream | null): void { if (stream && !this.recorder) this.recorder = new StreamRecorder(stream); }
  pauseRecording(on: boolean): void { this.recorder?.pause(on); }

  /** An answer starts (the right area was picked). An open one is closed first. Nothing is written until it has words. */
  startAnswer(a: AnswerStart, phrases: Phrase[] = []): void {
    if (this.ended) return;
    if (this.exchange) this.endAnswer(phrases);
    this.exchange = {
      id: newId('x'), sessionId: this.session.id, index: this.index, questionId: a.questionId, questionText: a.questionText, interviewer: CANVAS_COACH,
      lpId: a.lpId, storyId: null, storyTitle: null, startedAt: new Date(this.now()).toISOString(), endedAt: null, startMs: this.ms(), endMs: null,
      clipKey: null, analysis: null, verdict: null, isBest: false,
    };
  }

  /** The open answer ends: saved with its verdict from the marks, the question first in the transcript. Empty answers are dropped. */
  endAnswer(phrases: Phrase[]): void {
    const x = this.exchange; if (!x) return;
    this.exchange = null;
    if (!phrases.length) return;
    this.index++; this.answered++;
    const done: Exchange = { ...x, endMs: this.ms(), endedAt: new Date(this.now()).toISOString(), verdict: verdictOf(phrases) };
    const q: TranscriptEvent = { id: newId('t'), sessionId: this.session.id, exchangeId: x.id, tMs: x.startMs, speaker: 'interviewer', text: x.questionText };
    this.events++;
    this.run(async () => { await this.repo.insertExchange(done); await this.repo.appendTranscript([q]); });
  }

  /** A line for the transcript: the candidate's words, the AI's chat, the question. */
  say(speaker: TranscriptEvent['speaker'], text: string): void {
    const t = text.trim(); if (!t || this.ended) return;
    this.events++;
    const e: TranscriptEvent = { id: newId('t'), sessionId: this.session.id, exchangeId: this.exchange?.id ?? null, tMs: this.ms(), speaker, text: t };
    this.run(() => this.repo.appendTranscript([e]));
  }

  /**
   * Ends the sitting: the open answer closes, the recording is saved. A sitting with nothing said
   * is deleted. Returns the saved session, or null.
   */
  async finish(phrases: Phrase[] = []): Promise<{ session: Session; recording: Blob | null; answers: number } | null> {
    if (this.ended) return null;
    if (this.exchange) this.endAnswer(phrases);
    this.ended = true;
    const recording = this.recorder ? await this.recorder.blob() : null;
    await this.q;
    if (!this.events && !this.answered) { await this.repo.deleteSession(this.session.id).catch(() => undefined); return null; }
    const patch: Partial<Session> = { endedAt: new Date(this.now()).toISOString() };
    if (recording?.size) {
      const key = 'rec:' + this.session.id;
      if (await this.repo.putBlob(key, recording)) { patch.recordingKey = key; patch.recordingMime = recording.type || null; }
    }
    await this.repo.updateSession(this.session.id, patch);
    return { session: { ...this.session, ...patch }, recording: recording?.size ? recording : null, answers: this.answered };
  }
}
