import { describe, it, expect } from 'vitest';
import { PipelineTransport, SPOKEN_STYLE } from './pipeline.ts';
import { SessionController } from './controller.ts';
import { FakeAudio } from './testing.ts';
import { MemoryRepo, sampleData } from '../db/memory.ts';
import { INTERVIEWERS, LPS, STORIES } from '../fixtures/sample.ts';
import type { Analyzer } from './analyzer.ts';
import type { ChatModel, ChatReply, ChatRequest } from '../llm/chat.ts';
import type { SpeechIn } from '../speech/stt.ts';
import type { SpeechOut } from '../speech/tts.ts';
import type { TransportEvent } from './transport.ts';

const until = async (pred: () => boolean | Promise<boolean>, ms = 4000) => {
  const t0 = Date.now();
  while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const noAnalysis: Analyzer = { analyze: () => new Promise(() => undefined) };

/** A model that answers from a list, and records what it was asked. */
class ScriptedModel implements ChatModel {
  readonly model = 'llama3.2';
  asked: ChatRequest[] = [];
  gate: Promise<void> | null = null;
  constructor(private replies: Partial<ChatReply>[]) {}
  async complete(r: ChatRequest): Promise<ChatReply> {
    this.asked.push({ ...r, turns: r.turns.slice() });
    if (this.gate) await this.gate;
    const next = this.replies.shift() ?? { text: 'OK.' };
    return { text: next.text ?? '', calls: next.calls ?? [], usage: next.usage ?? { promptTokenCount: 10, candidatesTokenCount: 2 } };
  }
}

class FakeVoice implements SpeechOut {
  spoken: string[] = []; queued = 0; stops = 0;
  onSpeaking: SpeechOut['onSpeaking'] = null; onError: SpeechOut['onError'] = null;
  speak(t: string) { this.spoken.push(t); if (!this.queued++) this.onSpeaking?.(true); }
  finish() { if (this.queued) { this.queued = 0; this.onSpeaking?.(false); } }
  stop() { this.stops++; this.finish(); }
  isSpeaking() { return this.queued > 0; }
  close() {}
}

class FakeEars implements SpeechIn {
  listening = false;
  onPartial: SpeechIn['onPartial'] = null; onUtterance: SpeechIn['onUtterance'] = null; onError: SpeechIn['onError'] = null;
  async start() {}
  setListening(on: boolean) { this.listening = on; }
  say(t: string) { if (this.listening) this.onUtterance?.(t); }
  close() {}
}

const Q = { id: 'c1', name: 'new_question', args: { interviewer: 'Dana Whitfield', question: 'Tell me about a time you dove deep.', lp: 'Dive Deep' } };

describe('the speech → model → voice pipeline', () => {
  it('runs a session through the controller: start, question, answer, coaching, recap, recording', async () => {
    const repo = new MemoryRepo(sampleData());
    const audio = new FakeAudio();
    audio.recordingBlob = async () => new Blob(['whole'], { type: 'audio/webm' });
    const llm = new ScriptedModel([
      { text: 'Session one. Tell me about a time you dove deep.', calls: [Q] },
      { text: 'Pausing the interview. Strong numbers; say I, not we. Inclined. Back to the interview.' },
      { text: 'That is the session. Your focus next time is ownership.' },
    ]);
    const tts = new FakeVoice(), stt = new FakeEars();
    const t = new PipelineTransport({ audio, stt, llm, tts });
    const events: TransportEvent[] = [];
    t.on((e) => events.push(e));
    const c = new SessionController(t, noAnalysis, repo, () => Date.now(), false, { tickMs: 5 });
    await c.start({ mode: 'loop', focus: null, focusLabel: '', coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, systemInstruction: 'SYS', interviewers: INTERVIEWERS, lps: LPS, stories: STORIES, pauseMs: 2500, model: 'llama3.2', voice: 'Aoede' });

    // [START] → the intro and the first question, pinned by new_question; the SILENT result ends the turn.
    await until(() => c.state.questionsAsked === 1);
    expect(llm.asked[0].system).toBe('SYS\n' + SPOKEN_STYLE);
    expect(llm.asked[0].turns).toEqual([{ role: 'user', text: '[START]' }]);
    expect(llm.asked[0].tools.map((x) => x.name)).toContain('new_question');
    await until(() => events.some((e) => e.type === 'turnComplete'));
    expect(llm.asked).toHaveLength(1);
    expect(tts.spoken).toEqual(['Session one. Tell me about a time you dove deep.']);
    expect(events.some((e) => e.type === 'usage' && e.model === 'llama3.2')).toBe(true);

    // Half-duplex: nothing is heard while the interviewer speaks.
    expect(stt.listening).toBe(false);
    stt.say('echo of the interviewer');
    tts.finish();
    expect(stt.listening).toBe(true);
    stt.say('I traced the latency to a cache stampede and cut p99 by 40 percent.');
    await until(() => llm.asked.length === 2);
    const turns = llm.asked[1].turns;
    expect(turns[turns.length - 1]).toEqual({ role: 'user', text: 'I traced the latency to a cache stampede and cut p99 by 40 percent.' });
    expect(turns.some((x) => x.role === 'tool')).toBe(true);
    expect(JSON.stringify(turns)).not.toContain('echo');
    // Each sentence is transcribed as it is queued, so the coaching sentinels switch phases.
    await until(() => tts.spoken.length === 3);
    expect(tts.spoken.slice(1)).toEqual(['Pausing the interview. Strong numbers; say I, not we.', 'Inclined. Back to the interview.']);
    expect(c.state.turns.some((x) => x.speaker === 'me' && /cache stampede/.test(x.text))).toBe(true);
    expect(c.state.turns.some((x) => x.speaker === 'coach')).toBe(true);
    tts.finish();

    // End: [END] → the recap; the controller waits for it to finish speaking, then saves the recording.
    const sid = c.meta.sessionId!;
    void c.end('');
    await until(() => llm.asked.length === 3);
    expect(llm.asked[2].turns[llm.asked[2].turns.length - 1]).toEqual({ role: 'user', text: '[END]' });
    await until(() => tts.spoken.length === 4);
    await new Promise((r) => setTimeout(r, 30));
    expect((await repo.session(sid))!.recordingKey).toBeNull();
    tts.finish();
    await until(async () => (await repo.session(sid))!.recordingKey === 'rec:' + sid);
    await until(() => audio.closed);
  });

  it('asks the model again after a tool result when nothing was spoken, holding inputs until the results are in', async () => {
    const llm = new ScriptedModel([{ text: '', calls: [{ id: 's', name: 'search_prep', args: { query: 'payments' } }] }, { text: 'Your resume mentions a payments rollback.' }]);
    const tts = new FakeVoice();
    const t = new PipelineTransport({ audio: null, stt: null, llm, tts });
    const calls: string[] = [];
    t.on((e) => { if (e.type === 'toolCall') calls.push(...e.calls.map((x) => x.id)); });
    await t.connect({ model: 'm', voice: 'v', systemInstruction: 'S', tools: [], silenceDurationMs: 2500 });
    t.sendText('help me');
    await until(() => calls.length === 1);
    t.sendText('[HINT]');
    t.sendToolResponse([{ id: 's', name: 'search_prep', response: { ok: true, passages: [] } }]);
    await until(() => llm.asked.length >= 2);
    expect(llm.asked[1].turns.map((x) => x.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    await until(() => tts.spoken.length === 1);
    expect(tts.spoken[0]).toMatch(/payments rollback/);
  });

  it('drops a reply that comes back after the voice was cut off', async () => {
    const llm = new ScriptedModel([{ text: 'Stale answer.' }, { text: 'Paused.' }]);
    let open!: () => void;
    llm.gate = new Promise((r) => { open = r; });
    const tts = new FakeVoice();
    const t = new PipelineTransport({ audio: null, stt: null, llm, tts });
    await t.connect({ model: 'm', voice: 'v', systemInstruction: 'S', tools: [], silenceDurationMs: 2500 });
    t.sendText('an answer');
    await until(() => llm.asked.length === 1);
    t.stopPlayback();
    t.sendText('[PAUSE]');
    llm.gate = null; open();
    await until(() => tts.spoken.length === 1);
    expect(tts.spoken).toEqual(['Paused.']);
    expect(llm.asked[1].turns).toEqual([{ role: 'user', text: 'an answer' }, { role: 'user', text: '[PAUSE]' }]);
  });
});
