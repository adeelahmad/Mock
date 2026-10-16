// Mock — the simulated transport. Replays a LiveScript as the events a real Gemini Live
// connection would emit: tool calls for new questions, output transcript chunks while the
// "voice" speaks, mic levels and input transcript while the candidate answers, the coaching
// sentinels, GoAway/close for a reconnect, and reactions to the control tags.
//
// It is the development, demo and test double: no network, no API key, no audio.

import { Emitter, type LiveConfig, type LiveTransport, type ToolResponse, type TransportListener } from './transport.ts';
import { msToSpeak, type LiveScript, type ScriptedQuestion } from './script.ts';

type Timer = ReturnType<typeof setTimeout>;

export interface SimulatedOptions {
  /** Multiplies every delay; tests use 0.02. */
  speed?: number;
}

export class SimulatedTransport implements LiveTransport {
  readonly kind = 'simulated' as const;
  private em = new Emitter();
  private timers = new Set<Timer>();
  private speed: number;
  private open = false;
  private muted = false;
  private paused = false;
  private resumeWaiters: (() => void)[] = [];
  private speaking = false;
  private qi = -1;
  private coachingNow = false;
  /** Generation counter: every control tag starts a new flow and abandons the old one. */
  private gen = 0;
  private toolSeq = 0;
  public sent: string[] = [];
  public toolResponses: ToolResponse[] = [];

  constructor(private script: LiveScript, opts: SimulatedOptions = {}) {
    this.speed = opts.speed ?? script.speed ?? 1;
  }

  on(l: TransportListener): () => void { return this.em.on(l); }

  async connect(_config: LiveConfig): Promise<void> {
    this.open = true;
    const g = this.bump();
    await this.wait(600);
    if (!this.alive(g)) return;
    this.em.emit({ type: 'ready' });
    this.em.emit({ type: 'resumption', handle: 'sim-handle-1', resumable: true });
  }

  sendText(text: string): void {
    if (!this.open) return;
    this.sent.push(text);
    const tag = /\[(\w+)\]/.exec(text)?.[1]?.toUpperCase();
    if (!tag) return;
    if (tag === 'START') void this.start();
    else if (tag === 'REDO') this.redo();
    else if (tag === 'NEXT') this.next();
    else if (tag === 'FEEDBACK') this.feedback();
    else if (tag === 'HINT' || tag === 'BETTER_STORY' || tag === 'MODEL_ANSWER') this.hint();
    else if (tag === 'END') this.end();
    else if (tag === 'PAUSE') { this.paused = true; this.setSpeaking(false); }
  }

  sendToolResponse(responses: ToolResponse[]): void { this.toolResponses.push(...responses); }
  setMuted(m: boolean): void {
    this.muted = m;
    // Unmuting after a pause resumes the suspended flow.
    if (!m && this.paused) { this.paused = false; const w = this.resumeWaiters; this.resumeWaiters = []; w.forEach((r) => r()); }
  }
  stopPlayback(): void { this.setSpeaking(false); }
  isSpeaking(): boolean { return this.speaking; }
  close(): void { if (!this.open) return; this.open = false; this.bump(); this.setSpeaking(false); this.em.emit({ type: 'closed', code: 1000, reason: 'closed' }); }
  async recordingBlob(): Promise<Blob | null> { return null; }

  // ---- script engine
  private get q(): ScriptedQuestion | undefined { return this.script.questions[this.qi]; }
  private alive(g: number): boolean { return this.open && this.gen === g; }
  /** Abandon the running flow (clear its timers) and start a new generation. */
  private bump(): number {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.setSpeaking(false);
    return ++this.gen;
  }

  private async start(): Promise<void> {
    const g = this.bump();
    this.qi = -1;
    this.coachingNow = false;
    await this.say(this.script.opening, g);
    await this.wait(400);
    if (this.alive(g)) this.next();
  }

  private next(): void {
    const g = this.bump();
    this.coachingNow = false;
    if (this.qi + 1 >= this.script.questions.length) { this.endWith(g); return; }
    this.qi += 1;
    void this.runQuestion(this.q!, g, false);
  }

  private redo(): void {
    const g = this.bump();
    this.coachingNow = false;
    if (this.qi < 0) this.qi = 0;
    void this.runQuestion(this.q!, g, true);
  }

  private async runQuestion(q: ScriptedQuestion, g: number, redo: boolean): Promise<void> {
    const id = 'call-' + (++this.toolSeq);
    this.em.emit({ type: 'toolCall', calls: [{ id, name: 'new_question', args: { interviewer: q.interviewer.name, question: q.text, lp: q.lp, question_id: q.id ?? undefined } }] });
    await this.say((redo ? 'Same question again. ' : '') + q.text, g);
    if (!this.alive(g)) return;
    await this.candidate(q.answer, q.answerMs, g);
    if (!this.alive(g)) return;
    if (this.script.reconnectDuring === this.qi && !redo) {
      this.em.emit({ type: 'goAway', timeLeftMs: 2000 });
      await this.wait(800);
      if (!this.alive(g)) return;
      this.em.emit({ type: 'closed', code: 1011, reason: 'goAway' });
      await this.wait(1500);
      if (!this.alive(g)) return;
      this.em.emit({ type: 'ready' });
      this.em.emit({ type: 'resumption', handle: 'sim-handle-2', resumable: true });
    }
    for (const f of q.followUps) {
      await this.wait(1200);
      if (!this.alive(g)) return;
      await this.say(f.ask, g);
      if (!this.alive(g)) return;
      await this.candidate(f.answer, Math.min(5000, msToSpeak(f.answer) * 1.4), g);
      if (!this.alive(g)) return;
    }
    await this.wait(1500);
    if (!this.alive(g)) return;
    await this.coach(q, g);
  }

  private feedback(): void {
    if (!this.q || this.coachingNow) return;
    const g = this.bump();
    void this.coach(this.q, g);
  }

  private async coach(q: ScriptedQuestion, g: number): Promise<void> {
    this.coachingNow = true;
    for (const chunk of q.coaching) {
      await this.say(chunk, g);
      if (!this.alive(g)) return;
      await this.wait(250);
      if (!this.alive(g)) return;
    }
    this.coachingNow = false;
    // Hands-free: the next question follows by itself after a short beat.
    await this.wait(5000);
    if (this.alive(g)) this.next();
  }

  /** A hint is a side remark: it speaks without abandoning the running question flow. */
  private hint(): void {
    if (!this.q) return;
    void this.say(this.q.hint, this.gen);
  }

  private end(): void { this.endWith(this.bump()); }
  private endWith(g: number): void { void (async () => { await this.say(this.script.recap, g); if (this.alive(g)) this.em.emit({ type: 'sessionEnd', focus: this.script.focus }); })(); }

  /** Speak text: aiSpeaking on, transcript in word chunks, aiSpeaking off, turnComplete. */
  private async say(text: string, g: number): Promise<void> {
    if (!this.alive(g)) return;
    const words = text.split(/\s+/).filter(Boolean);
    const total = msToSpeak(text, 1);
    this.setSpeaking(true);
    const chunkSize = 4;
    for (let i = 0; i < words.length; i += chunkSize) {
      if (!this.alive(g)) return;
      const chunk = words.slice(i, i + chunkSize).join(' ') + (i + chunkSize < words.length ? ' ' : '');
      this.em.emit({ type: 'outputTranscript', text: chunk });
      await this.wait(total * Math.min(chunkSize, words.length - i) / words.length);
    }
    if (!this.alive(g)) return;
    this.setSpeaking(false);
    this.em.emit({ type: 'turnComplete' });
  }

  /** The candidate talks: a mic level every 200 ms, the transcript after a third of the time. */
  private async candidate(text: string, ms: number, g: number): Promise<void> {
    const steps = Math.max(2, Math.round(ms / 200));
    let transcribed = false;
    for (let i = 0; i < steps; i++) {
      if (!this.alive(g)) return;
      const level = this.muted ? 0 : 0.2 + 0.5 * Math.abs(Math.sin(i * 0.9));
      this.em.emit({ type: 'level', value: level });
      if (!transcribed && i >= steps / 3) { transcribed = true; this.em.emit({ type: 'inputTranscript', text }); }
      await this.wait(200);
    }
    if (!this.alive(g)) return;
    this.em.emit({ type: 'level', value: 0 });
  }

  private setSpeaking(s: boolean): void {
    if (this.speaking === s) return;
    this.speaking = s;
    this.em.emit({ type: 'aiSpeaking', speaking: s });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((res) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        // Paused: hold here until the mic is unmuted.
        if (this.paused) this.resumeWaiters.push(res); else res();
      }, Math.max(0, ms * this.speed));
      this.timers.add(t);
    });
  }
}
