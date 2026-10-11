import { describe, it, expect } from 'vitest';
import { BrowserStt, SegmentedStt, wavBlob } from './stt.ts';
import { BrowserTts, PcmTts, sentences, speakable } from './tts.ts';
import { int16ToBase64 } from '../live/pcm.ts';
import { FakeAudio } from '../live/testing.ts';

const until = async (pred: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 2)); } };
/** 100 ms of 16 kHz PCM at a given amplitude. */
const frame = (amp: number) => int16ToBase64(Int16Array.from({ length: 1600 }, (_, i) => (i % 2 ? amp : -amp)));

describe('text for the voice', () => {
  it('drops markdown and tags, and splits sentences without tiny pieces', () => {
    expect(speakable('**Great.** Next: [NEXT] `code`\n- item')).toBe('Great. Next: code item');
    expect(sentences('OK. Tell me about a time you failed. What happened next?')).toEqual(['OK. Tell me about a time you failed.', 'What happened next?']);
    expect(sentences('No punctuation at the end')).toEqual(['No punctuation at the end']);
  });
});

describe('segmented speech to text', () => {
  it('cuts an utterance after the pause and uploads it as WAV, in order', async () => {
    const got: Blob[] = [];
    const out: string[] = [];
    const stt = new SegmentedStt({ pauseMs: 500, transcribe: async (w) => { got.push(w); return 'utterance ' + got.length; } });
    stt.onUtterance = (t) => out.push(t);
    stt.pcm(frame(8000)); // ignored: not listening
    stt.setListening(true);
    for (let i = 0; i < 3; i++) stt.pcm(frame(0));
    for (let i = 0; i < 5; i++) stt.pcm(frame(8000));
    for (let i = 0; i < 5; i++) stt.pcm(frame(0));
    await until(() => out.length === 1);
    expect(out).toEqual(['utterance 1']);
    expect(got[0].type).toBe('audio/wav');
    // 300 ms of pre-roll (ending on the first loud frame) + the other 400 ms of speech + 500 ms
    // of quiet: 12 frames of 3200 bytes, plus the 44-byte header.
    expect(got[0].size).toBe(44 + 3200 * 12);
    // A blip shorter than 300 ms is not sent.
    stt.pcm(frame(8000));
    for (let i = 0; i < 6; i++) stt.pcm(frame(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toHaveLength(1);
  });

  it('writes a valid WAV header', async () => {
    const b = new Uint8Array(await wavBlob([new Uint8Array(4)]).arrayBuffer());
    const v = new DataView(b.buffer);
    expect(String.fromCharCode(...b.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(4);
  });
});

describe('Chrome speech recognition', () => {
  it('commits the words after the pause and drops what it heard while not listening', async () => {
    const rec: any = { start() { this.started = (this.started ?? 0) + 1; }, stop() {}, abort() { this.aborted = (this.aborted ?? 0) + 1; } };
    const stt = new BrowserStt({ pauseMs: 30, lang: 'en-GB', make: () => rec });
    const out: string[] = [];
    stt.onUtterance = (t) => out.push(t);
    await stt.start();
    expect(rec.lang).toBe('en-GB');
    stt.setListening(true);
    expect(rec.started).toBe(1);
    const result = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
    rec.onresult({ resultIndex: 0, results: [result('I led the', true)] });
    rec.onresult({ resultIndex: 1, results: [result('I led the', true), result('migration', false)] });
    await until(() => out.length === 1);
    expect(out).toEqual(['I led the migration']);
    // Recognition ends on its own: it restarts while listening.
    rec.onend();
    expect(rec.started).toBe(2);
    rec.onresult({ resultIndex: 0, results: [result('the interviewer talking', false)] });
    stt.setListening(false);
    expect(rec.aborted).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(out).toHaveLength(1);
  });
});

describe('voices', () => {
  it('Chrome: tracks speaking across queued sentences and stops on cancel', () => {
    const queue: any[] = [];
    const synth = { getVoices: () => [], speak: (u: any) => queue.push(u), cancel: () => { queue.length = 0; } } as unknown as SpeechSynthesis;
    const tts = new BrowserTts({ synth, make: (text) => ({ text } as unknown as SpeechSynthesisUtterance) });
    const states: boolean[] = [];
    tts.onSpeaking = (s) => states.push(s);
    tts.speak('One.'); tts.speak('Two.');
    expect(tts.isSpeaking()).toBe(true);
    queue[0].onend(); expect(tts.isSpeaking()).toBe(true);
    queue[1].onend(); expect(tts.isSpeaking()).toBe(false);
    tts.speak('Three.');
    tts.stop();
    expect(states).toEqual([true, false, true, false]);
  });

  it('PCM: plays in order even when a later sentence is made first, and drops the queue on stop', async () => {
    const audio = new FakeAudio();
    const resolvers: Record<string, (v: { base64: string; rate: number }) => void> = {};
    const tts = new PcmTts(audio, (text) => new Promise((res) => { resolvers[text] = res; }));
    tts.speak('a'); tts.speak('b');
    expect(tts.isSpeaking()).toBe(true);
    resolvers.b({ base64: 'B', rate: 24000 });
    await new Promise((r) => setTimeout(r, 5));
    expect(audio.played).toEqual([]);
    resolvers.a({ base64: 'A', rate: 24000 });
    await until(() => audio.played.length === 2);
    expect(audio.played.map((p) => p[0])).toEqual(['A', 'B']);
    expect(tts.isSpeaking()).toBe(false);
    tts.speak('c');
    tts.stop();
    resolvers.c({ base64: 'C', rate: 24000 });
    await new Promise((r) => setTimeout(r, 5));
    expect(audio.played).toHaveLength(2);
    expect(audio.stops).toBe(1);
  });
});
