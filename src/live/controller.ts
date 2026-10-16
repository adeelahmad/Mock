// Mock — the session controller. Wires a LiveTransport to the state machine and the
// repository: transport events become machine events; tool calls open exchanges; closing an
// exchange persists it and asks the Analyzer for the card (on coaching start, or on close when
// coaching never came); at the end every card is awaited and the Reporter writes the session
// report; the transcript is saved as it arrives; the control buttons send text tags. The UI
// subscribes to the state.

import { initialState, reduce, type SessionEvent, type SessionState } from '../domain/session-machine.ts';
import type { Analysis, Coaching, Exchange, Interviewer, KeyNumber, Lp, Mode, QuestionSourceSetting, Session, Story, TranscriptEvent } from '../domain/types.ts';
import type { Repo } from '../db/repo.ts';
import { newId } from '../db/repo.ts';
import { NEW_QUESTION_TOOL, SAVE_STORY_TOOL, SEARCH_PREP_TOOL, type LiveTransport, type ToolCall, type TransportEvent } from './transport.ts';
import type { Hit } from '../rag/knowledge.ts';
import type { Analyzer } from './analyzer.ts';
import { LocalReporter, reportInput, type Reporter } from './reporter.ts';
import type { ToolHandler } from './context-tools.ts';
import { reportUsage } from '../gemini/usage.ts';

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
  /** Search over the prep files (the knowledge index): the hint's source and the search_prep tool. */
  retriever?: Retriever | null;
  /** Extra tools next to the built-in ones (the library lookups in context-tools.ts). */
  tools?: ToolHandler[];
}

export type Retriever = (query: string, k: number) => Promise<Hit[]>;

export type Listener = (s: SessionState, meta: ControllerMeta) => void;
export interface ControllerMeta {
  sessionId: string | null; sessionNumber: number; storyNotes: boolean; notes: { t: string; n: string }[]; demo: boolean;
  /** Who is about to speak first (for the connecting copy) — the Bar Raiser unless the mode says otherwise. */
  interviewer: Interviewer | null;
  mode: Mode;
  /** The system prompt's token budget, for the debug panel. */
  context: ContextInfo | null;
  /** The prep-file passage closest to the current question (the hint shows it). */
  source: Hit | null;
  /** The last story the coach saved with the candidate (save_story). */
  savedStory: { id: string; title: string } | null;
}

export interface ContextInfo { estimated: number; counted: number | null; budget: number; trimmed: string[] }

/** Longest the controller waits for the spoken recap after [END] before closing. */
const RECAP_MAX_MS = 100_000;

const SPEECH_ON = 0.05, SPEECH_OFF = 0.025; // mic level hysteresis

export class SessionController {
  state: SessionState = initialState(0);
  meta: ControllerMeta = { sessionId: null, sessionNumber: 0, storyNotes: true, notes: [], demo: false, interviewer: null, mode: 'loop', context: null, source: null, savedStory: null };
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
  private startSent = false;
  private turnsAfterEnd = 0;
  private recordingParts: string[] = [];
  private pendingParts: Promise<unknown>[] = [];
  /** Analyses in flight, by exchange id; the report waits for them. */
  private pending = new Map<string, Promise<void>>();
  private exchangeIndexById = new Map<string, number>();

  private tickMs: number;
  private reporter: Reporter;
  constructor(private transport: LiveTransport, private analyzer: Analyzer | null, private repo: Repo, private now: () => number = () => Date.now(), demo = false, opts: { tickMs?: number; reporter?: Reporter } = {}) {
    this.meta.demo = demo;
    this.tickMs = opts.tickMs ?? 250;
    this.reporter = opts.reporter ?? new LocalReporter();
  }

  subscribe(l: Listener): () => void { this.listeners.add(l); l(this.state, this.meta); return () => this.listeners.delete(l); }
  private emit(): void { for (const l of Array.from(this.listeners)) l(this.state, this.meta); }
  private dispatch(e: SessionEvent): void { const next = reduce(this.state, e); if (next !== this.state) { this.state = next; this.emit(); } }

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.ended = false;
    this.startSent = false;
    this.turnsAfterEnd = 0;
    this.recordingParts = [];
    this.pendingParts = [];
    const number = await this.repo.nextSessionNumber();
    const session: Session = {
      id: newId('s'), number, mode: opts.mode, focus: opts.focus, coaching: opts.coaching, questionSource: opts.questionSource, storyNotes: opts.storyNotes, seed: opts.seed,
      startedAt: new Date(this.now()).toISOString(), endedAt: null, recordingKey: null, recordingMime: null, report: null,
    };
    this.session = session;
    const first = opts.interviewers.find((i) => i.role === 'Bar Raiser') ?? opts.interviewers[0] ?? null;
    this.meta = { ...this.meta, sessionId: session.id, sessionNumber: number, storyNotes: opts.storyNotes, notes: [], interviewer: first, mode: opts.mode, source: null, savedStory: null };
    await this.repo.insertSession(session);
    this.dispatch({ type: 'CONNECT', now: this.now() });
    this.off = this.transport.on((e) => this.onTransport(e));
    try {
      await this.transport.connect({ model: opts.model, voice: opts.voice, systemInstruction: opts.systemInstruction, tools: [NEW_QUESTION_TOOL, ...(opts.retriever ? [SEARCH_PREP_TOOL] : []), SAVE_STORY_TOOL, ...(opts.tools ?? []).map((t) => t.declaration)], silenceDurationMs: opts.pauseMs, resumptionHandle: null, seed: opts.seed });
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
  hint(): void {
    this.dispatch({ type: 'HINT', now: this.now(), text: this.hintFor(this.state.lpName) });
    if (!this.meta.source) void this.findSource(this.state.qText, this.state.lpName);
    this.transport.sendText('[HINT]');
  }
  /** "Better story": the coach searches the uploaded files for a stronger story for this question. */
  betterStory(): void {
    this.transport.stopPlayback();
    this.dispatch({ type: 'HINT', now: this.now(), text: 'Looking through your files for a better story for this question…' });
    if (!this.meta.source) void this.findSource(this.state.qText, this.state.lpName);
    this.transport.sendText('[BETTER_STORY]');
  }
  dismissHint(): void { this.dispatch({ type: 'DISMISS_HINT', now: this.now() }); }
  clearError(): void { this.dispatch({ type: 'CLEAR_ERROR', now: this.now() }); }
  /** The context builder's numbers (and the countTokens confirmation when it lands). */
  setContext(info: ContextInfo): void { this.meta = { ...this.meta, context: info }; this.emit(); }

  async end(focus = ''): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    const now = this.now();
    try { this.transport.sendText('[END]'); } catch { /* closed */ }
    await this.closeExchange(now);
    await this.flushTranscript();
    this.dispatch({ type: 'END', now, focus: focus || this.state.focus });
    if (!this.session) { setTimeout(() => this.destroy(), 2500); return; }
    const session = this.session;
    await this.repo.updateSession(session.id, { endedAt: new Date(now).toISOString() });
    // The report runs alongside the recap; it waits for every card, not for the audio.
    const report = this.writeReport(session.id);
    if (this.transport.kind !== 'simulated') {
      // The model speaks the recap after [END]: keep the connection (and the recording) open
      // until that turn completes and its audio drains.
      await this.waitForRecap();
      await this.saveRecording(session);
      this.destroy();
      await report;
    } else {
      await this.saveRecording(session);
      // Let the goodbye play out, then close.
      setTimeout(() => this.destroy(), 2500);
      await report;
    }
  }

  private async waitForRecap(): Promise<void> {
    const t0 = this.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (this.now() - t0 < RECAP_MAX_MS && this.off) {
      if (this.turnsAfterEnd > 0 && !this.transport.isSpeaking()) return;
      await sleep(200);
    }
  }

  /** The whole mixed recording replaces the chunks written during the session. */
  private async saveRecording(session: Session): Promise<void> {
    const blob = this.transport.recordingBlob ? await this.transport.recordingBlob() : null;
    if (!blob || !blob.size) return;
    const recordingKey = 'rec:' + session.id;
    await this.repo.putBlob(recordingKey, blob);
    await this.repo.updateSession(session.id, { recordingKey, recordingMime: blob.type || null });
    await Promise.allSettled(this.pendingParts.splice(0));
    for (const k of this.recordingParts.splice(0)) await this.repo.deleteBlob(k);
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
        // Once per session: a reconnect before the first question must not restart the intro.
        if (!this.startSent && this.state.questionsAsked === 0 && !this.ended) { this.startSent = true; this.transport.sendText('[START]'); }
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
      case 'sessionEnd': void this.end(e.focus ?? ''); break;
      case 'error': this.dispatch({ type: 'ERROR', now, message: e.message }); break;
      case 'turnComplete': if (this.ended) this.turnsAfterEnd++; break;
      case 'recordingChunk': void this.saveChunk(e.blob, e.index); break;
      case 'toolCallCancellation': break;
      case 'usage': if (this.opts) reportUsage(e.model ?? this.opts.model, this.exchange?.lpId ?? (this.opts.mode === 'lp' ? this.opts.focus : null) ?? null, e.usageMetadata); break;
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
        this.meta = { ...this.meta, notes: this.notesFor(a.lp ?? ''), source: null };
        this.emit();
        void this.findSource(a.question ?? '', a.lp ?? '');
        responses.push({ id: c.id, name: c.name, response: { ok: true, scheduling: 'SILENT' } });
      } else if (c.name === 'search_prep') {
        const a = c.args as { query?: string; limit?: number };
        const k = Math.min(8, Math.max(1, Math.round(Number(a.limit) || 4)));
        try {
          const hits = this.opts?.retriever && a.query ? await this.opts.retriever(a.query, k) : [];
          responses.push({ id: c.id, name: c.name, response: { ok: true, passages: hits.map((h) => ({ file: h.fileName, section: h.heading || undefined, text: h.text })) } });
        } catch (err) {
          responses.push({ id: c.id, name: c.name, response: { ok: false, error: (err as Error).message || 'search failed' } });
        }
      } else if (c.name === 'save_story') {
        try {
          const story = await this.saveStory(c.args);
          responses.push({ id: c.id, name: c.name, response: { ok: true, story_id: story.id } });
        } catch (err) {
          responses.push({ id: c.id, name: c.name, response: { ok: false, error: (err as Error).message || 'save failed' } });
        }
      } else {
        const tool = this.opts?.tools?.find((t) => t.declaration.name === c.name);
        let response: Record<string, unknown>;
        try { response = tool ? await tool.handle(c.args ?? {}) : { ok: false, error: 'unknown tool' }; }
        catch (err) { response = { ok: false, error: (err as Error).message || 'lookup failed' }; }
        responses.push({ id: c.id, name: c.name, response });
      }
    }
    this.transport.sendToolResponse(responses);
  }

  /** The passage the hint shows: the prep-file chunk closest to the question (kept only while it is still the current one). */
  private async findSource(question: string, lp: string): Promise<void> {
    const r = this.opts?.retriever;
    if (!r || !question) return;
    try {
      const [hit] = await r(question + (lp ? ' (' + lp + ')' : ''), 1);
      if (hit && this.state.qText === question) { this.meta = { ...this.meta, source: hit }; this.emit(); }
    } catch { /* the hint falls back to the story nudge */ }
  }

  /** save_story: a story built live with the coach joins the library, linked to its LP. */
  private async saveStory(args: Record<string, unknown>): Promise<Story> {
    const s = (k: string): string => (typeof args[k] === 'string' ? (args[k] as string).trim() : '');
    const title = s('title');
    if (!title || !(s('situation') || s('action') || s('result'))) throw new Error('a story needs a title and its STAR parts');
    const raw = Array.isArray(args.numbers) ? (args.numbers as unknown[]) : typeof args.numbers === 'string' ? String(args.numbers).split(/[;\n]/) : [];
    const numbers: KeyNumber[] = raw.map((x) => String(x).trim()).filter(Boolean).map((x) => {
      const i = x.indexOf(':');
      return i > 0 ? { label: x.slice(0, i).trim(), value: x.slice(i + 1).trim() } : { label: '', value: x };
    });
    const lp = this.lpFor(s('lp') || this.state.lpName);
    const at = new Date(this.now()).toISOString();
    const existing = this.opts?.stories.find((x) => x.title.toLowerCase() === title.toLowerCase());
    const story: Story = {
      id: existing?.id ?? newId('st'), title, summary: s('result').split(/(?<=[.!?])\s/)[0] ?? '', situation: s('situation'), task: s('task'), action: s('action'), result: s('result'), learning: s('learning'),
      numbers, links: lp ? [{ lpId: lp.id, role: 'primary' }] : [], createdAt: existing?.createdAt ?? at, updatedAt: at,
    };
    await this.repo.upsertStory(story);
    if (this.opts) this.opts = { ...this.opts, stories: [...this.opts.stories.filter((x) => x.id !== story.id), story] };
    this.meta = { ...this.meta, savedStory: { id: story.id, title: story.title }, notes: this.notesFor(this.state.lpName) };
    this.emit();
    return story;
  }

  /** Chunks land in storage as they arrive, so a crash loses at most a second of audio. */
  private async saveChunk(blob: Blob, index: number): Promise<void> {
    if (!this.session) return;
    const key = 'recpart:' + this.session.id + ':' + String(index).padStart(6, '0');
    this.recordingParts.push(key);
    const put = this.repo.putBlob(key, blob);
    this.pendingParts.push(put);
    await put;
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
    this.exchangeIndexById.set(ex.id, this.state.qIndex);
    void this.repo.insertExchange(ex);
    this.transport.beginClip?.();
  }

  private async closeExchange(now: number): Promise<void> {
    const ex = this.exchange; if (!ex) return;
    this.exchange = null;
    await this.flushTranscript();
    const endMs = now - this.state.startedAt;
    ex.endedAt = new Date(now).toISOString(); ex.endMs = endMs;
    await this.repo.updateExchange(ex.id, { endedAt: ex.endedAt, endMs });
    const clip = this.transport.endClip ? await this.transport.endClip() : null;
    if (clip && clip.size) {
      const clipKey = 'clip:' + ex.id;
      if (await this.repo.putBlob(clipKey, clip)) { ex.clipKey = clipKey; await this.repo.updateExchange(ex.id, { clipKey }); }
    }
    // No coaching came (recap-only, or skipped with "next"): the card is written on close.
    if (this.analyzer && !ex.analysis && !this.pending.has(ex.id)) {
      // Still the current question in the machine (the next one is dispatched after this close).
      const transcript = this.state.turns.filter((t) => t.tMs >= ex.startMs && t.tMs <= endMs);
      const durationSec = this.state.answerSec || Math.max(1, (endMs - ex.startMs) / 1000);
      if (transcript.some((t) => t.speaker === 'me')) this.track(ex, this.analyse(ex, transcript, '', durationSec));
    }
  }

  /** Called when coaching starts: the candidate's answer (with follow-ups) is complete. */
  private analyseCurrent(now: number): Promise<void> {
    const ex = this.exchange; if (!ex || ex.analysis || !this.analyzer || this.pending.has(ex.id)) return Promise.resolve();
    const transcript = this.state.turns.filter((t) => t.tMs >= ex.startMs);
    const durationSec = this.state.answerSec || Math.max(0, (now - this.state.startedAt - ex.startMs) / 1000);
    return this.track(ex, this.analyse(ex, transcript, this.state.coachText, durationSec));
  }

  private track(ex: Exchange, p: Promise<void>): Promise<void> {
    const done = p.finally(() => this.pending.delete(ex.id));
    this.pending.set(ex.id, done);
    return done;
  }

  private async analyse(ex: Exchange, transcript: SessionState['turns'], coachText: string, durationSec: number): Promise<void> {
    try {
      // The per-exchange clip, when the transport recorded one (plan §3: blob `clip:{exchangeId}`).
      const clip = await this.repo.getBlob(ex.clipKey ?? 'clip:' + ex.id).catch(() => null);
      const analysis: Analysis = await this.analyzer!.analyze({ exchange: ex, transcript, coachText, clip, durationSec });
      ex.analysis = analysis; ex.verdict = analysis.verdict;
      if (analysis.storyUsed) { const st = this.opts?.stories.find((s) => s.title === analysis.storyUsed); ex.storyId = st?.id ?? null; ex.storyTitle = analysis.storyUsed; }
      await this.repo.setAnalysis(ex.id, analysis);
      if (ex.storyTitle) await this.repo.updateExchange(ex.id, { storyId: ex.storyId, storyTitle: ex.storyTitle });
      // On screen only while we are still on the same question; otherwise it joins the recap rows.
      if (this.state.qText === ex.questionText && this.exchange === ex) this.dispatch({ type: 'ANALYSIS', now: this.now(), analysis });
      else this.dispatch({ type: 'ANALYSIS', now: this.now(), analysis, answer: { qIndex: this.exchangeIndexById.get(ex.id) ?? ex.index, lpName: analysis.lp || this.opts?.lps.find((l) => l.id === ex.lpId)?.name || '', interviewer: ex.interviewer } });
    } catch (err) {
      this.dispatch({ type: 'ERROR', now: this.now(), message: 'Analysis failed: ' + ((err as Error).message || 'unknown') });
    }
  }

  /** Once every card is in, the report: Flash prose over local verdicts (or local only). */
  private async writeReport(sessionId: string): Promise<void> {
    await Promise.allSettled(Array.from(this.pending.values()));
    try {
      const input = await reportInput(this.repo, sessionId);
      if (!input || !input.exchanges.some((e) => e.verdict)) return;
      const report = await this.reporter.report(input);
      await this.repo.updateSession(sessionId, { report });
    } catch (err) {
      this.dispatch({ type: 'ERROR', now: this.now(), message: 'Report failed: ' + ((err as Error).message || 'unknown') });
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
    // Short form, as the board shows: the first two numbers, label-less.
    return this.storiesFor(lp).slice(0, 3).map((s) => ({ t: s.title, n: s.numbers.slice(0, 2).map((n) => n.value).join(' · ') }));
  }
}
