import { describe, it, expect } from 'vitest';
import { SessionController } from './controller.ts';
import { GeminiLiveTransport } from './gemini.ts';
import { FakeSocket, FakeAudio } from './testing.ts';
import { MemoryRepo, sampleData } from '../db/memory.ts';
import { INTERVIEWERS, LPS, STORIES } from '../fixtures/sample.ts';
import type { Analyzer } from './analyzer.ts';

const until = async (pred: () => boolean | Promise<boolean>, ms = 4000) => {
  const t0 = Date.now();
  while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const noAnalysis: Analyzer = { analyze: () => new Promise(() => undefined) };

describe('session controller on the Gemini transport', () => {
  it('starts once, opens exchanges from new_question, saves clips, chunks and the recording after the recap', async () => {
    FakeSocket.all = [];
    const repo = new MemoryRepo(sampleData());
    const audio = new FakeAudio();
    let clipN = 0;
    audio.endClip = async () => new Blob(['clip' + clipN++], { type: 'audio/webm' });
    audio.recordingBlob = async () => new Blob(['whole'], { type: 'audio/webm' });
    const t = new GeminiLiveTransport({ auth: { kind: 'key', key: 'K' }, audio, socket: (u) => new FakeSocket(u), retryDelaysMs: [1] });
    const c = new SessionController(t, noAnalysis, repo, () => Date.now(), false, { tickMs: 5 });
    const sock = () => FakeSocket.all[FakeSocket.all.length - 1];
    const started = c.start({ mode: 'loop', focus: null, focusLabel: '', coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, systemInstruction: 'SYS', interviewers: INTERVIEWERS, lps: LPS, stories: STORIES, pauseMs: 2500, model: 'gemini-3.8-live', voice: 'Aoede' });
    await until(() => !!sock()?.sent.length);
    expect(sock().sent[0].setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(2500);
    sock().server({ setupComplete: {} });
    await started;
    const texts = () => FakeSocket.all.flatMap((s) => s.sent).filter((m) => m.clientContent).map((m) => m.clientContent.turns[0].parts[0].text);
    expect(texts()).toEqual(['[START]']);

    // A reconnect before the first question does not restart the intro.
    sock().drop(1011);
    await until(() => FakeSocket.all.length === 2 && sock().sent.length > 0);
    sock().server({ setupComplete: {} });
    await until(() => !c.state.reconnecting);
    expect(texts()).toEqual(['[START]']);

    audio.onRecordingChunk!(new Blob(['a']));
    sock().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'new_question', args: { interviewer: 'Dana Whitfield', question: 'Tell me about a time you dove deep.', lp: 'Dive Deep' } }] } });
    await until(() => c.state.questionsAsked === 1);
    expect(c.state.interviewer.mono).toBe('DW');
    await until(() => sock().sent.some((m) => m.toolResponse));
    sock().server({ toolCall: { functionCalls: [{ id: 'c2', name: 'new_question', args: { interviewer: 'Marcus', question: 'Second?', lp: 'Ownership' } }] } });
    await until(() => c.state.questionsAsked === 2);
    const sid = c.meta.sessionId!;
    await until(async () => (await repo.exchanges(sid))[0]?.clipKey != null);
    const [ex1] = await repo.exchanges(sid);
    expect(await (await repo.getBlob(ex1.clipKey!))!.text()).toBe('clip0');
    expect(await repo.listBlobs('recpart:' + sid)).toHaveLength(1);

    // End: [END] goes out, the controller waits for the recap turn before saving and closing.
    audio.speaking = true;
    const ended = c.end('');
    await until(() => texts().includes('[END]'));
    await new Promise((r) => setTimeout(r, 50));
    expect((await repo.session(sid))!.recordingKey).toBeNull();
    sock().server({ serverContent: { turnComplete: true } });
    audio.speaking = false;
    await ended;
    const s = (await repo.session(sid))!;
    expect(s.endedAt).not.toBeNull();
    expect(s.recordingKey).toBe('rec:' + sid);
    expect(await (await repo.getBlob(s.recordingKey!))!.text()).toBe('whole');
    expect(await repo.listBlobs('recpart:' + sid)).toHaveLength(0);
    expect(audio.closed).toBe(true);
  });
});
