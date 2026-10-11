// Mock — the turn-by-turn live connection: speech to text → a language model → text to
// speech, each pluggable (domain/providers.ts). It implements the same LiveTransport as Gemini
// Live, so the controller, tools, coaching, recording and History work unchanged:
// - a finished utterance (or a control tag from the buttons) is a user turn;
// - the model's reply is spoken sentence by sentence and transcribed as it is queued;
// - tool calls go to the controller; their results go back and the model continues (a SILENT
//   result after a reply that already spoke ends the turn, as on Live);
// - it is half-duplex: the mic is ignored while the interviewer speaks, so the speakers are
//   never transcribed. The buttons (pause, next, redo) still cut the voice off at once.

import { Emitter, type LiveConfig, type LiveTransport, type ToolCall, type ToolResponse, type TransportListener } from './transport.ts';
import type { AudioIO } from './audio.ts';
import type { ChatModel, ChatTurn } from '../llm/chat.ts';
import type { SpeechIn } from '../speech/stt.ts';
import { sentences, speakable, type SpeechOut } from '../speech/tts.ts';

export interface PipelineOptions {
  /** Mic level, PCM for segmented recognisers, recording, and playback for PCM voices. Null in tests. */
  audio: AudioIO | null;
  stt: SpeechIn | null;
  llm: ChatModel;
  tts: SpeechOut;
  temperature?: number;
}

/** Added after the session prompt: the model writes, a voice reads it out. */
export const SPOKEN_STYLE = [
  '',
  '## Voice',
  'Everything you write is read aloud by a text-to-speech voice, and the candidate speaks back through speech recognition.',
  'Write only the words to be spoken: plain sentences, no markdown, lists, emoji or stage directions. Keep turns short, as in a real conversation.',
  'Control tags such as [START], [NEXT] or [END] arrive as user messages from the app; never write them yourself.',
  'Call the tools exactly as described; a tool call is never spoken.',
].join('\n');

export class PipelineTransport implements LiveTransport {
  readonly kind = 'pipeline' as const;
  private em = new Emitter();
  private config: LiveConfig | null = null;
  private turns: ChatTurn[] = [];
  /** Inputs that arrived while tool results were outstanding (they must follow the results). */
  private inbox: ChatTurn[] = [];
  private awaiting: { ids: Set<string>; results: ToolResponse[]; spoke: boolean } | null = null;
  private busy = false;
  private dirty = false;
  private epoch = 0;
  private muted = false;
  private closing = false;
  private everReady = false;
  private chunkIndex = 0;

  constructor(private o: PipelineOptions) {
    const a = o.audio;
    if (a) {
      a.onLevel = (value) => this.em.emit({ type: 'level', value });
      a.onRecordingChunk = (blob) => this.em.emit({ type: 'recordingChunk', blob, index: this.chunkIndex++ });
      a.onPcm = (b64) => o.stt?.pcm?.(b64);
    }
    o.tts.onSpeaking = (speaking) => { this.em.emit({ type: 'aiSpeaking', speaking }); this.listen(); };
    o.tts.onError = (message) => this.em.emit({ type: 'error', message });
    if (o.stt) {
      o.stt.onUtterance = (text) => this.heard(text);
      o.stt.onError = (message) => this.em.emit({ type: 'error', message });
    }
  }

  on(l: TransportListener): () => void { return this.em.on(l); }

  async connect(config: LiveConfig): Promise<void> {
    this.config = { ...config, systemInstruction: config.systemInstruction + '\n' + SPOKEN_STYLE };
    this.closing = false;
    if (this.o.audio) await this.o.audio.start();
    if (this.o.stt) await this.o.stt.start();
    this.everReady = true;
    this.listen();
    this.em.emit({ type: 'ready' });
  }

  private listen(): void { this.o.stt?.setListening(!this.closing && !this.muted && !this.o.tts.isSpeaking()); }

  /** A finished utterance from the recogniser. */
  private heard(text: string): void {
    if (this.muted || this.closing || !text.trim()) return;
    this.em.emit({ type: 'inputTranscript', text: text.trim() + ' ' });
    this.push({ role: 'user', text: text.trim() });
  }

  private push(t: ChatTurn): void {
    if (this.awaiting) this.inbox.push(t); else this.turns.push(t);
    this.kick();
  }

  private kick(): void {
    if (this.busy || this.awaiting) { this.dirty = true; return; }
    void this.run();
  }

  private async run(): Promise<void> {
    this.busy = true;
    try {
      do { this.dirty = false; await this.step(); } while (this.dirty && !this.awaiting && !this.closing);
    } finally { this.busy = false; }
  }

  /** One model call: speak its text, hand its tool calls to the controller. */
  private async step(): Promise<void> {
    const cfg = this.config;
    if (!cfg || this.closing || !this.turns.length || this.turns[this.turns.length - 1].role === 'assistant') return;
    const epoch = this.epoch;
    let reply;
    try {
      reply = await this.o.llm.complete({ system: cfg.systemInstruction, turns: this.turns, tools: cfg.tools, seed: cfg.seed, temperature: this.o.temperature });
    } catch (err) {
      if (!this.closing) this.em.emit({ type: 'error', message: 'The model failed: ' + ((err as Error).message || 'unknown') });
      return;
    }
    if (this.closing) return;
    if (reply.usage) this.em.emit({ type: 'usage', usageMetadata: reply.usage, model: this.o.llm.model });
    // Cut off (pause, next, redo) while thinking: the reply is dropped, the new input follows.
    if (epoch !== this.epoch) return;
    // Nothing at all (a model that chose silence): no empty turn in the history.
    if (!reply.text && !reply.calls.length) { this.em.emit({ type: 'turnComplete' }); return; }
    this.turns.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
    const spoke = this.say(reply.text);
    if (reply.calls.length) {
      this.awaiting = { ids: new Set(reply.calls.map((c) => c.id)), results: [], spoke };
      this.em.emit({ type: 'toolCall', calls: reply.calls as ToolCall[] });
      return;
    }
    this.em.emit({ type: 'turnComplete' });
  }

  /** Queues the reply's sentences; true when there was anything to say. */
  private say(text: string): boolean {
    const clean = speakable(text);
    if (!clean) return false;
    for (const s of sentences(clean)) {
      this.em.emit({ type: 'outputTranscript', text: s + ' ' });
      this.o.tts.speak(s);
    }
    this.listen();
    return true;
  }

  sendText(text: string): void { if (!this.closing) this.push({ role: 'user', text }); }

  sendToolResponse(responses: ToolResponse[]): void {
    const w = this.awaiting;
    if (this.closing || !w || !responses.length) return;
    for (const r of responses) { if (w.ids.delete(r.id)) w.results.push(r); }
    if (w.ids.size) return;
    this.awaiting = null;
    this.turns.push({ role: 'tool', results: w.results });
    this.turns.push(...this.inbox.splice(0));
    const silent = w.results.every((r) => (r.response as { scheduling?: string }).scheduling === 'SILENT');
    // The question was already spoken with its new_question call: nothing more to say until the candidate answers.
    if (silent && w.spoke && this.turns[this.turns.length - 1].role === 'tool') { this.em.emit({ type: 'turnComplete' }); return; }
    this.dirty = true;
    this.kick();
  }

  setMuted(muted: boolean): void { this.muted = muted; this.o.audio?.setMuted(muted); this.listen(); }
  stopPlayback(): void { this.epoch++; this.o.tts.stop(); this.listen(); }
  isSpeaking(): boolean { return this.o.tts.isSpeaking(); }
  async recordingBlob(): Promise<Blob | null> { return this.o.audio ? this.o.audio.recordingBlob() : null; }
  beginClip(): void { this.o.audio?.beginClip(); }
  async endClip(): Promise<Blob | null> { return this.o.audio ? this.o.audio.endClip() : null; }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.o.stt?.close();
    this.o.tts.close();
    this.o.audio?.close();
    if (this.everReady) this.em.emit({ type: 'closed', code: 1000, reason: 'closed' });
  }
}
