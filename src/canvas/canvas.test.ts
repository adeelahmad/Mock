import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatReply, judgePhrase, offlineReply, type CoachContext } from './coach.ts';
import { Captions, LiveEar, LISTEN_ONLY, SpeechEar } from './ear.ts';
import { SharedCanvas, addonParams, meetingLink, stageUrl } from './addon.ts';
import { addChat, addPhrases, decodeCanvas, emptyCanvas, markPhrase, pickArea, withQuestion } from '../domain/canvas.ts';
import { Emitter, type LiveConfig, type LiveTransport, type TransportEvent } from '../live/transport.ts';
import type { AudioIO } from '../live/audio.ts';
import type { SpeechIn } from '../speech/stt.ts';
import type { ChatModel, ChatReply, ChatRequest } from '../llm/chat.ts';
import { LPS } from '../fixtures/sample.ts';

const ctx: CoachContext = { question: 'Tell me about a time you cut costs.', area: LPS[0], story: null, words: new Set(['cost']) };

class FakeModel implements ChatModel {
  readonly model = 'fake-1';
  requests: ChatRequest[] = [];
  constructor(private replies: (ChatReply | Error)[]) {}
  async complete(r: ChatRequest): Promise<ChatReply> {
    this.requests.push(r);
    const next = this.replies.shift() ?? { text: '', calls: [], usage: null };
    if (next instanceof Error) throw next;
    return next;
  }
}
const reply = (text: string, calls: ChatReply['calls'] = []): ChatReply => ({ text, calls, usage: null });

afterEach(() => vi.useRealTimers());

describe('the canvas AI', () => {
  it('marks a phrase from the model, with the answer so far as context', async () => {
    const m = new FakeModel([reply('```json\n{"mark":"drift","note":"Say I, not we."}\n```')]);
    const r = await judgePhrase({ model: m, ctx, before: ['I ran the fleet.'], phrase: 'We moved to spot.' });
    expect(r).toEqual({ mark: 'drift', note: 'Say I, not we.', by: 'ai' });
    expect(m.requests[0].system).toContain(LPS[0].name);
    expect(m.requests[0].turns[0]).toMatchObject({ role: 'user', text: expect.stringContaining('Answer so far: I ran the fleet.') });
  });

  it('falls back to the offline judge without a model, on errors and on odd replies', async () => {
    expect(await judgePhrase({ model: null, ctx, before: [], phrase: 'I cut the bill by 30 percent.' })).toMatchObject({ mark: 'match', by: 'local' });
    const failed = await judgePhrase({ model: new FakeModel([new Error('quota')]), ctx, before: [], phrase: "I don't know." });
    expect(failed).toMatchObject({ mark: 'redo', by: 'local', error: 'quota' });
    expect(await judgePhrase({ model: new FakeModel([reply('{"mark":"great"}')]), ctx, before: [], phrase: 'I led it.' })).toMatchObject({ by: 'local', error: 'unexpected reply' });
  });

  it('chats with the canvas in view; notes it writes come back for the whiteboard', async () => {
    const Q = { id: 'q', text: ctx.question, lpIds: [LPS[0].id] };
    let s = pickArea(withQuestion(emptyCanvas(), Q), Q, LPS[0].id).state;
    const { state, added } = addPhrases(s, ['I renegotiated the contract.']);
    s = addChat(markPhrase(state, added[0].id, 'match', '', 'ai'), 'me', 'Outline it for me', true);
    const m = new FakeModel([reply('', [{ id: 'c1', name: 'add_note', args: { text: 'S: contract · A: renegotiate · R: -30%' } }]), reply('Here is an outline.')]);
    const r = await chatReply({ model: m, state: s, ctx });
    expect(r).toEqual({ text: 'Here is an outline.', notes: ['S: contract · A: renegotiate · R: -30%'] });
    expect(m.requests[0].system).toContain('[match] I renegotiated the contract.');
    expect(m.requests[0].tools.map((t) => t.name)).toEqual(['add_note']);
    expect(m.requests[0].turns).toEqual([{ role: 'user', text: '(said) Outline it for me' }]);
    // The tool result goes back for the words.
    expect(m.requests[1].turns.map((t) => t.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('a review ask goes last without being in the chat; offline it still answers', async () => {
    const s = addChat(emptyCanvas(), 'ai', 'Yes, that area.');
    const m = new FakeModel([reply('Good structure; land the number.')]);
    expect((await chatReply({ model: m, state: s, ctx, ask: 'How was it?' })).text).toBe('Good structure; land the number.');
    expect(m.requests[0].turns).toEqual([{ role: 'user', text: 'How was it?' }]);
    const offline = await chatReply({ model: null, state: s, ctx, ask: 'How was it?' });
    expect(offline.text).toMatch(/Say your answer out loud/);
    expect(offlineReply({ ...emptyCanvas(), phase: 'answer' }, 'give me a STAR outline')).toMatch(/Situation in one line/);
    const err = await chatReply({ model: new FakeModel([new Error('down')]), state: { ...s, phase: 'pick' }, ctx });
    expect(err).toMatchObject({ error: 'down', text: expect.stringMatching(/Pick the area/) });
  });
});

describe('hearing', () => {
  it('captions join fragments and end a stretch after the pause', () => {
    vi.useFakeTimers();
    const c = new Captions(900);
    const partial: string[] = [], final: string[] = [];
    c.onPartial = (t) => partial.push(t); c.onFinal = (t) => final.push(t);
    c.add(' I led'); c.add(' the'); c.add('migration');
    expect(partial[partial.length - 1]).toBe('I led the migration');
    vi.advanceTimersByTime(899);
    expect(final).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(final).toEqual(['I led the migration']);
    c.add('again'); c.drop(); vi.advanceTimersByTime(2000);
    expect(final).toHaveLength(1);
  });

  it('Gemini Live: input transcript becomes captions; its own turn ends the stretch; muting stops hearing', async () => {
    const em = new Emitter();
    let cfg: LiveConfig | null = null, muted: boolean | null = null, closed = false;
    const t: LiveTransport = {
      kind: 'gemini', connect: async (c) => { cfg = c; }, sendText() {}, sendToolResponse() {}, setMuted: (m) => { muted = m; }, stopPlayback() {}, isSpeaking: () => false,
      close: () => { closed = true; }, on: (l) => em.on(l),
    };
    const ear = new LiveEar({ key: 'k', model: 'gemini-live', voice: 'Aoede', pauseMs: 900, audio: {} as AudioIO, transport: t });
    const got: string[] = [], levels: number[] = [];
    ear.onFinal = (x) => got.push(x); ear.onLevel = (v) => levels.push(v);
    await ear.start();
    expect(cfg!.systemInstruction).toBe(LISTEN_ONLY);
    expect(cfg!.silenceDurationMs).toBe(900);
    const send = (e: TransportEvent) => em.emit(e);
    send({ type: 'inputTranscript', text: 'not yet' });
    ear.setListening(true);
    expect(muted).toBe(false);
    send({ type: 'inputTranscript', text: 'I cut' }); send({ type: 'inputTranscript', text: ' costs' });
    send({ type: 'level', value: 0.4 });
    send({ type: 'outputTranscript', text: 'Okay.' });
    expect(got).toEqual(['I cut costs']);
    expect(levels).toEqual([0.4]);
    ear.setListening(false);
    expect(muted).toBe(true);
    ear.close();
    expect(closed).toBe(true);
  });

  it('a pipeline recogniser: utterances, PCM from the engine, listening follows the mute', async () => {
    const calls: string[] = [];
    const stt: SpeechIn = { start: async () => { calls.push('start'); }, onPartial: null, onUtterance: null, onError: null, setListening: (on) => calls.push('listen ' + on), pcm: (b) => calls.push('pcm ' + b), close: () => calls.push('close') };
    const audio = { start: async () => { calls.push('audio'); }, onPcm: null, onLevel: null, setMuted: (m: boolean) => calls.push('mute ' + m), close: () => calls.push('audio close') } as unknown as AudioIO;
    const ear = new SpeechEar(stt, audio);
    const got: string[] = [];
    ear.onFinal = (x) => got.push(x);
    await ear.start();
    ear.setListening(true);
    audio.onPcm?.('AAA');
    stt.onUtterance?.('hello');
    ear.close();
    expect(got).toEqual(['hello']);
    expect(calls).toEqual(['audio', 'start', 'mute false', 'listen true', 'pcm AAA', 'close', 'audio close']);
  });
});

describe('the Meet add-on', () => {
  it('reads the frame and project from the URL', () => {
    expect(addonParams('?meet_sdk=abc&addon=stage&project=123')).toEqual({ inMeet: true, frame: 'stage', project: '123' });
    expect(addonParams('?addon=side', ' 99 ')).toEqual({ inMeet: false, frame: 'side', project: '99' });
    expect(addonParams('?addon=nope')).toMatchObject({ frame: null, project: '' });
    expect(stageUrl({ origin: 'https://x.dev', pathname: '/app/' }, '123')).toBe('https://x.dev/app/?addon=stage&project=123#/canvas');
    expect(meetingLink(' ABC-defg-HIJ ')).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('shares the canvas at most every gap, always the latest', () => {
    vi.useFakeTimers();
    const sent: Uint8Array[] = [];
    const sc = new SharedCanvas(250);
    sc.share(emptyCanvas()); // not attached: nothing
    sc.attach({ broadcastStateUpdate: (st) => sent.push(st.bytes) });
    const a = withQuestion(emptyCanvas(), { id: 'a', text: 'A' });
    sc.share(a, Date.now());
    expect(sent).toHaveLength(1);
    sc.share(withQuestion(a, { id: 'b', text: 'B' }), Date.now());
    sc.share(withQuestion(a, { id: 'c', text: 'C' }), Date.now());
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(260);
    expect(sent).toHaveLength(2);
    expect(decodeCanvas(sent[1])?.questionId).toBe('c');
    sc.close();
  });
});
