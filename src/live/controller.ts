// Mock — the session controller. Wires a LiveTransport to the state machine and the
// repository: transport events become machine events; tool calls open exchanges; closing an
// exchange persists it and asks the Analyzer for the card; the transcript is saved as it
// arrives; the control buttons send text tags. The UI subscribes to the state.

import { initialState, reduce, type SessionEvent, type SessionState } from '../domain/session-machine.ts';
import type { Analysis, Coaching, Exchange, Interviewer, Lp, Mode, QuestionSourceSetting, Session, Story, TranscriptEvent } from '../domain/types.ts';
import type { Repo } from '../db/repo.ts';
import { newId } from '../db/repo.ts';
import { NEW_QUESTION_TOOL, type LiveTransport, type ToolCall, type TransportEvent } from './transport.ts';
import type { Analyzer } from './analyzer.ts';

export interface StartOptions {
  mode: Mode;
  focus: string | null;           // LP id, story id, or question-set key
  focusLabel: string;             // human name of the focus
  coaching: Coaching;
  questionSource: QuestionSourceSetting;
  storyNotes: boolean;
  seed: number;
  systemInstruction: string;
  interviewers: Interviewer[];
  lps: Lp[];
  stories: Story[];
  pauseMs: number;
  model: string;
  voice: string;
  /** A fixed first question (the "ask me this live" path). */
  questionText?: string | null;
}

export type Listener = (s: SessionState, meta: ControllerMeta) => void;
export interface ControllerMeta { sessionId: string | null; sessionNumber: number; storyNotes: boolean; notes: { t: string; n: string }[]; demo: boolean }

const SPEECH_ON = 0.05, SPEECH_OFF = 0.025; // mic level hysteresis

export class SessionController {
  state: SessionState = initialState(0);
  meta: ControllerMeta = { sessionId: null, sessionNumber: 0, storyNotes: true, notes: [], demo: false };
  private listeners = new Set<Listener>();
  private off: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private exchange: Exchange | null = null;
  private exchangeIndex = -1;
  private speaking = false;
  private opts: StartOptions | null = null;
  private session: Session | null = null;
  private transcriptBuffer: TranscriptEvent[] = [];
  private lastTranscriptAt = 0;
  private resumptionHandle: string | null = null;
  private ended = false;

  private tickMs: number;
  constructor(private transport: LiveTransport, private analyzer: Analyzer, private repo: Repo, private now: () => number = () => Date.now(), demo = false, opts: { tickMs?: number } = {}) {
    this.meta.demo = demo;
    this.tickMs = opts.tickMs ?? 250;
  }

  subscribe(l: Listener): () => void { this.listeners.add(l); l(this.state, this.meta); return () => this.listeners.delete(l); }
  private emit(): void { for (const l of Array.from(this.listeners)) l(this.state, this.meta); }
  private dispatch(e: SessionEvent): void { const next = reduce(this.state, e); if (next !== this.state) { this.state = next; this.emit(); } }

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.ended = false;
    const number = await this.repo.nextSessionNumber();
    const session: Session = {
      id: newId('s'), number, mode: opts.mode, focus: opts.focus, coaching: opts.coaching, questionSource: opts.questionSource, storyNotes: opts.storyNotes, seed: opts.seed,
      startedAt: new Date(this.now()).toISOString(), endedAt: null, recordingKey: null, recordingMime: null, report: null,
    };
    this.session = session;
    this.meta = { ...this.meta, sessionId: session.id, sessionNumber: number, storyNotes: opts.storyNotes, notes: [] };
    await this.repo.insertSession(session);
    this.dispatch({ type: 'CONNECT', now: this.now() });
    this.off = this.transport.on((e) => this.onTransport(e));
    try {
      await this.transport.connect({ model: opts.model, voice: opts.voice, systemInstruction: opts.systemInstruction, tools: [NEW_QUESTION_TOOL], silenceDurationMs: opts.pauseMs, resumptionHandle: null, seed: opts.seed });
    } catch (err) {
      this.dispatch({ type: 'ERROR', now: this.now(), message: (err as Error).message || 'Could not connect' });
      await this.end('');
      return;
    }
    this.tick = setInterval(() => this.dispatch({ type: 'TICK', now: this.now(), pauseMs: this.opts?.pauseMs ?? 2500 }), this.tickMs);
  }

  // ---- controls (buttons and keys). Voice commands are the model's job.
  pause(): void { this.transport.setMuted(true); this.transport.stopPlayback(); this.transport.sendText('[PAUSE]'); this.dispatch({ type: 'PAUSE', now: this.now() }); }
  resume(): void { this.transport.setMuted(false); this.dispatch({ type: 'RESUME', now: this.now() }); this.transport.sendText('Resuming. Continue where we were.'); }
  redo(): void { this.transport.stopPlayback(); this.transport.sendText('[REDO]'); }
  next(): void { this.transport.stopPlayback(); this.transport.sendText('[NEXT]'); }
  feedback(): void { this.transport.sendText('[FEEDBACK]'); }
  hint(): void { this.dispatch({ type: 'HINT', now: this.now(), text: this.hintFor(this.state.lpName) }); this.transport.sendText('[HINT]'); }
  dismissHint(): void { this.dispatch({ type: 'DISMISS_HINT', now: this.now() }); }
  clearError(): void { this.dispatch({ type: 'CLEAR_ERROR', now: this.now() }); }

  async end(focus = ''): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    const now = this.now();
    try { this.transport.sendText('[END]'); } catch { /* closed */ }
    await this.closeExchange(now);
    await this.flushTranscript();
    this.dispatch({ type: 'END', now, focus: focus || this.state.focus });
    if (this.session) {
      const blob = this.transport.recordingBlob ? await this.transport.recordingBlob() : null;
      let recordingKey: string | null = null, recordingMime: string | null = null;
      if (blob && blob.size) { recordingKey = 'rec:' + this.session.id; recordingMime = blob.type; await this.repo.putBlob(recordingKey, blob); }
      await this.repo.updateSession(this.session.id, { endedAt: new Date(now).toISOString(), recordingKey, recordingMime });
    }
    // Let the goodbye play out, then close.
    setTimeout(() => this.destroy(), 2500);
  }

  destroy(): void {
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    this.off?.(); this.off = null;
    try { this.transport.close(); } catch { /* ignore */ }
  }

  // ---- transport → machine
  private onTransport(e: TransportEvent): void {
    const now = this.now();
    switch (e.type) {
      case 'ready':
        this.dispatch({ type: 'READY', now });
        if (this.state.questionsAsked === 0 && !this.ended) this.transport.sendText('[START]');
        break;
      case 'aiSpeaking': this.dispatch({ type: 'AI_SPEAKING', now, speaking: e.speaking }); break;
      case 'level': {
        const on = this.speaking ? e.value > SPEECH_OFF : e.value > SPEECH_ON;
        if (on !== this.speaking) { this.speaking = on; this.dispatch({ type: 'ME_SPEAKING', now, speaking: on }); }
        break;
      }
      case 'inputTranscript': this.dispatch({ type: 'INPUT_TRANSCRIPT', now, text: e.text }); this.bufferTranscript('me', e.text, now); break;
      case 'outputTranscript': {
        const wasCoaching = this.state.phase === 'coaching' || this.state.pausedFrom === 'coaching';
        this.dispatch({ type: 'OUTPUT_TRANSCRIPT', now, text: e.text });
        const isCoaching = this.state.phase === 'coaching' || this.state.pausedFrom === 'coaching';
        this.bufferTranscript(wasCoaching || isCoaching ? 'coach' : 'interviewer', e.text, now);
        // The coach has started: the answer is complete → analyse the exchange.
        if (!wasCoaching && isCoaching) void this.analyseCurrent(now);
        break;
      }
      case 'toolCall': void this.onTools(e.calls, now); break;
      case 'interrupted': this.transport.stopPlayback(); this.dispatch({ type: 'AI_SPEAKING', now, speaking: false }); break;
      case 'goAway': this.dispatch({ type: 'DISCONNECTED', now, reason: 'goAway' }); break;
      case 'resumption': this.resumptionHandle = e.handle; break;
      case 'closed': if (!this.ended) this.dispatch({ type: 'DISCONNECTED', now, reason: e.reason }); break;
      case 'error': this.dispatch({ type: 'ERROR', now, message: e.message }); break;
      case 'turnComplete': break;
      case 'toolCallCancellation': break;
    }
  }

  private async onTools(calls: ToolCall[], now: number): Promise<void> {
    const responses = [];
    for (const c of calls) {
      if (c.name === 'new_question') {
        const a = c.args as { interviewer?: string; question?: string; lp?: string; question_id?: string };
        const iv = this.interviewerFor(a.interviewer ?? '');
        await this.closeExchange(now);
        this.dispatch({ type: 'NEW_QUESTION', now, interviewer: iv, question: a.question ?? '', lp: a.lp ?? '', questionId: a.question_id ?? null, hint: this.hintFor(a.lp ?? '') });
        this.openExchange(a.question ?? '', a.lp ?? '', a.question_id ?? null, iv, now);
        this.meta = { ...this.meta, notes: this.notesFor(a.lp ?? '') };
        this.emit();
        responses.push({ id: c.id, name: c.name, response: { ok: true, scheduling: 'SILENT' } });
      } else {
        responses.push({ id: c.id, name: c.name, response: { ok: false, error: 'unknown tool' } });
      }
    }
    this.transport.sendToolResponse(responses);
  }

  // ---- exchanges
  private openExchange(question: string, lp: string, questionId: string | null, iv: Interviewer, now: number): void {
    if (!this.session) return;
    this.exchangeIndex += 1;
    const lpRow = this.lpFor(lp);
    const ex: Exchange = {
      id: newId('e'), sessionId: this.session.id, index: this.exchangeIndex, questionId, questionText: question, interviewer: iv, lpId: lpRow?.id ?? null,
      storyId: null, storyTitle: null, startedAt: new Date(now).toISOString(), endedAt: null, startMs: now - this.state.startedAt, endMs: null, clipKey: null, analysis: null, verdict: null, isBest: false,
    };
    this.exchange = ex;
    void this.repo.insertExchange(ex);
  }

  private async closeExchange(now: number): Promise<void> {
    const ex = this.exchange; if (!ex) return;
    this.exchange = null;
    await this.flushTranscript();
    await this.repo.updateExchange(ex.id, { endedAt: new Date(now).toISOString(), endMs: now - this.state.startedAt });
  }

  /** Called when coaching starts: the candidate's answer (with follow-ups) is complete. */
  private async analyseCurrent(now: number): Promise<void> {
    const ex = this.exchange; if (!ex || ex.analysis) return;
    const transcript = this.state.turns.filter((t) => t.tMs >= ex.startMs);
    const durationSec = this.state.answerSec || Math.max(0, (now - this.state.startedAt - ex.startMs) / 1000);
    try {
      const analysis: Analysis = await this.analyzer.analyze({ exchange: ex, transcript, coachText: this.state.coachText, clip: null, durationSec });
      ex.analysis = analysis; ex.verdict = analysis.verdict;
      if (analysis.storyUsed) { const st = this.opts?.stories.find((s) => s.title === analysis.storyUsed); ex.storyId = st?.id ?? null; ex.storyTitle = analysis.storyUsed; }
      await this.repo.setAnalysis(ex.id, analysis);
      if (ex.storyTitle) await this.repo.updateExchange(ex.id, { storyId: ex.storyId, storyTitle: ex.storyTitle });
      // Only land it if we are still on the same question.
      if (this.state.qText === ex.questionText) this.dispatch({ type: 'ANALYSIS', now: this.now(), analysis });
    } catch (err) {
      this.dispatch({ type: 'ERROR', now: this.now(), message: 'Analysis failed: ' + ((err as Error).message || 'unknown') });
    }
  }

  // ---- transcript persistence (batched)
  private bufferTranscript(speaker: TranscriptEvent['speaker'], text: string, now: number): void {
    if (!this.session) return;
    const last = this.transcriptBuffer[this.transcriptBuffer.length - 1];
    if (last && last.speaker === speaker && now - this.lastTranscriptAt < 5000) last.text += text;
    else this.transcriptBuffer.push({ id: newId('t'), sessionId: this.session.id, exchangeId: this.exchange?.id ?? null, tMs: now - this.state.startedAt, speaker, text });
    this.lastTranscriptAt = now;
    if (this.transcriptBuffer.length >= 8) void this.flushTranscript();
  }
  private async flushTranscript(): Promise<void> {
    if (!this.transcriptBuffer.length) return;
    const batch = this.transcriptBuffer; this.transcriptBuffer = [];
    await this.repo.appendTranscript(batch);
  }

  // ---- helpers
  private interviewerFor(name: string): Interviewer {
    const list = this.opts?.interviewers ?? [];
    const n = name.toLowerCase();
    return list.find((i) => i.name.toLowerCase() === n) ?? list.find((i) => n.includes(i.name.split(' ')[0].toLowerCase())) ?? (list[0] ?? { n: 1, name: name || 'Interviewer', role: 'Interviewer', mono: (name || 'AI').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() });
  }
  private lpFor(name: string): Lp | undefined {
    const n = name.toLowerCase();
    return this.opts?.lps.find((l) => l.name.toLowerCase() === n || l.id === n) ?? this.opts?.lps.find((l) => n && n.includes(l.name.toLowerCase().split(/[ ;,]/)[0]) && l.name.length > 4);
  }
  private storiesFor(lp: string): Story[] {
    const l = this.lpFor(lp); if (!l) return [];
    const st = this.opts?.stories ?? [];
    return [...st.filter((s) => s.links.some((k) => k.lpId === l.id && k.role === 'primary')), ...st.filter((s) => s.links.some((k) => k.lpId === l.id && k.role === 'secondary'))];
  }
  private hintFor(lp: string): string {
    const s = this.storiesFor(lp)[0];
    return s ? 'Try the ' + s.title + ' story — ' + s.numbers.slice(0, 2).map((n) => n.value).join(', ') + '.' : 'Pick your clearest story and lead with its number.';
  }
  private notesFor(lp: string): { t: string; n: string }[] {
    return this.storiesFor(lp).slice(0, 3).map((s) => ({ t: s.title, n: s.numbers.slice(0, 3).map((n) => n.value).join(' · ') }));
  }
}
