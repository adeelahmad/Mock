import { describe, it, expect } from 'vitest';
import { GeminiLiveTransport } from './gemini.ts';
import { FakeSocket, FakeAudio } from './testing.ts';
import type { TransportEvent } from './transport.ts';
import { NEW_QUESTION_TOOL } from './transport.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred: () => boolean) => { for (let i = 0; i < 500 && !pred(); i++) await new Promise((r) => setTimeout(r, 2)); if (!pred()) throw new Error('timeout'); };
const cfg = { model: 'gemini-3.8-live', voice: 'Aoede', systemInstruction: 'SYS', tools: [NEW_QUESTION_TOOL], silenceDurationMs: 2500 };

function make() {
  FakeSocket.all = [];
  const audio = new FakeAudio();
  const t = new GeminiLiveTransport({ auth: { kind: 'key', key: 'K' }, audio, socket: (u) => new FakeSocket(u), retryDelaysMs: [1, 1, 1] });
  const events: TransportEvent[] = [];
  t.on((e) => events.push(e));
  return { t, audio, events, sock: () => FakeSocket.all[FakeSocket.all.length - 1] };
}

async function connected() {
  const m = make();
  const p = m.t.connect(cfg);
  await until(() => !!m.sock()?.sent.length);
  m.sock().server({ setupComplete: {} });
  await p;
  return m;
}

describe('Gemini Live transport', () => {
  it('starts audio, sends setup first, and is ready on setupComplete', async () => {
    const { audio, events, sock } = await connected();
    expect(audio.started).toBe(true);
    expect(sock().url).toMatch(/key=K/);
    expect(sock().sent[0].setup.model).toBe('models/gemini-3.8-live');
    expect(events[0]).toEqual({ type: 'ready' });
  });

  it('streams mic PCM only once ready, and sends text and tool responses', async () => {
    const { t, audio, sock } = await connected();
    audio.onPcm!('AAAA');
    t.sendText('[START]');
    t.sendToolResponse([{ id: 'c1', name: 'new_question', response: { ok: true, scheduling: 'SILENT' } }]);
    const sent = sock().sent.slice(1);
    expect(sent[0]).toEqual({ realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } } });
    expect(sent[1].clientContent.turns[0].parts[0].text).toBe('[START]');
    expect(sent[2].toolResponse.functionResponses[0].scheduling).toBe('SILENT');
  });

  it('plays model audio, flushes it on barge-in, and relays events', async () => {
    const { audio, events, sock } = await connected();
    sock().server({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' } }] }, outputTranscription: { text: 'Tell me' } } });
    sock().server({ serverContent: { interrupted: true } });
    sock().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'new_question', args: { question: 'Q', lp: 'Dive Deep', interviewer: 'Dana' } }] } });
    expect(audio.played).toEqual([['AQI=', 24000]]);
    expect(audio.stops).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['ready', 'outputTranscript', 'interrupted', 'toolCall']);
  });

  it('reconnects on GoAway with the latest handle and queues text meanwhile', async () => {
    const { t, events, sock } = await connected();
    const first = sock();
    first.server({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } });
    first.server({ sessionResumptionUpdate: { newHandle: null, resumable: false } });
    first.server({ goAway: { timeLeft: '5s' } });
    t.sendText('[NEXT]');
    await until(() => FakeSocket.all.length === 2 && sock().sent.length > 0);
    const second = sock();
    expect(first.closedWith).toBe(1000);
    expect(second.sent[0].setup.sessionResumption).toEqual({ handle: 'h1' });
    second.server({ setupComplete: {} });
    await until(() => events.filter((e) => e.type === 'ready').length === 2);
    expect(second.sent[1].clientContent.turns[0].parts[0].text).toBe('[NEXT]');
    expect(events.map((e) => e.type)).toContain('goAway');
  });

  it('reconnects after an unexpected close and reports it as closed first', async () => {
    const { events, sock } = await connected();
    sock().drop(1011, 'internal');
    await until(() => FakeSocket.all.length === 2 && sock().sent.length > 0);
    sock().server({ setupComplete: {} });
    await until(() => events.filter((e) => e.type === 'ready').length === 2);
    expect(events.find((e) => e.type === 'closed')).toMatchObject({ code: 1011 });
  });

  it('does not retry a refused key, and rejects connect when setup is refused', async () => {
    const m = await connected();
    m.sock().drop(1008, 'API key not valid');
    await tick();
    expect(FakeSocket.all).toHaveLength(1);
    expect(m.events.some((e) => e.type === 'error' && /refused the key/.test(e.message))).toBe(true);

    const n = make();
    const p = n.t.connect(cfg);
    await until(() => !!n.sock()?.sent.length);
    n.sock().drop(1008, 'API key not valid');
    await expect(p).rejects.toThrow(/refused the key/);
  });

  it('closes cleanly: no reconnect, audio closed, one closed event', async () => {
    const { t, audio, events, sock } = await connected();
    t.close();
    sock().drop(1000);
    await tick();
    expect(audio.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(1);
    expect(events.filter((e) => e.type === 'closed')).toHaveLength(1);
  });

  it('emits recording chunks in order with an index', async () => {
    const { audio, events } = await connected();
    audio.onRecordingChunk!(new Blob(['a'])); audio.onRecordingChunk!(new Blob(['b']));
    expect(events.filter((e) => e.type === 'recordingChunk').map((e) => (e as { index: number }).index)).toEqual([0, 1]);
  });
});
