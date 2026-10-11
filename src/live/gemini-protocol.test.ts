import { describe, it, expect } from 'vitest';
import { liveUrl, setupMessage, textMessage, toolResponseMessage, parseServerMessage, durationMs, audioMessage } from './gemini-protocol.ts';
import { NEW_QUESTION_TOOL } from './transport.ts';

describe('Gemini Live protocol', () => {
  it('builds the URL for a key and for an ephemeral token', () => {
    expect(liveUrl({ kind: 'key', key: 'AIza a' })).toMatch(/v1beta\.GenerativeService\.BidiGenerateContent\?key=AIza%20a$/);
    expect(liveUrl({ kind: 'token', token: 't/1' })).toMatch(/v1alpha\.GenerativeService\.BidiGenerateContentConstrained\?access_token=t%2F1$/);
  });

  it('puts VAD, transcription, resumption, compression and the tool in the setup', () => {
    const { setup } = setupMessage({ model: 'gemini-3.8-live', voice: 'Kore', systemInstruction: 'SYS', tools: [NEW_QUESTION_TOOL], silenceDurationMs: 2500, resumptionHandle: 'h1', seed: 7 }) as { setup: any };
    expect(setup.model).toBe('models/gemini-3.8-live');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(setup.generationConfig.seed).toBe(7);
    expect(setup.systemInstruction.parts[0].text).toBe('SYS');
    expect(setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(2500);
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.sessionResumption).toEqual({ handle: 'h1' });
    expect(setup.contextWindowCompression.slidingWindow).toEqual({});
    expect(setup.tools[0].functionDeclarations[0]).toMatchObject({ name: 'new_question', behavior: 'NON_BLOCKING' });
  });

  it('asks for a fresh resumption handle on a first connection', () => {
    const { setup } = setupMessage({ model: 'models/x', voice: 'v', systemInstruction: '', tools: [], silenceDurationMs: 800 }) as { setup: any };
    expect(setup.model).toBe('models/x');
    expect(setup.sessionResumption).toEqual({});
    expect(setup.tools).toBeUndefined();
  });

  it('builds text, audio and tool-response messages; lifts scheduling', () => {
    expect(textMessage('[START]')).toEqual({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[START]' }] }], turnComplete: true } });
    expect(audioMessage('AAA=', 'audio/pcm;rate=16000')).toEqual({ realtimeInput: { audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=16000' } } });
    expect(toolResponseMessage([{ id: '1', name: 'new_question', response: { ok: true, scheduling: 'SILENT' } }])).toEqual({ toolResponse: { functionResponses: [{ id: '1', name: 'new_question', response: { ok: true }, scheduling: 'SILENT' }] } });
  });

  it('parses audio, transcripts, interruption and turn end in order', () => {
    const p = parseServerMessage({ serverContent: { interrupted: true, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' } }] }, outputTranscription: { text: 'Hello' }, inputTranscription: { text: 'hi' }, turnComplete: true } });
    expect(p.audio).toEqual([{ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' }]);
    expect(p.events.map((e) => e.type)).toEqual(['interrupted', 'inputTranscript', 'outputTranscript', 'turnComplete']);
  });

  it('parses setupComplete, tool calls, cancellation, goAway and resumption', () => {
    expect(parseServerMessage({ setupComplete: {} }).setupComplete).toBe(true);
    const t = parseServerMessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'new_question', args: { lp: 'Dive Deep' } }] } });
    expect(t.events[0]).toEqual({ type: 'toolCall', calls: [{ id: 'c1', name: 'new_question', args: { lp: 'Dive Deep' } }] });
    expect(parseServerMessage({ toolCallCancellation: { ids: ['c1'] } }).events[0]).toEqual({ type: 'toolCallCancellation', ids: ['c1'] });
    expect(parseServerMessage({ goAway: { timeLeft: '10s' } }).events[0]).toEqual({ type: 'goAway', timeLeftMs: 10000 });
    expect(parseServerMessage({ sessionResumptionUpdate: { newHandle: 'h2', resumable: true } }).events[0]).toEqual({ type: 'resumption', handle: 'h2', resumable: true });
    expect(parseServerMessage(null).events).toEqual([]);
  });

  it('reads durations as strings or objects', () => {
    expect(durationMs('1.5s')).toBe(1500);
    expect(durationMs({ seconds: '3', nanos: 500_000_000 })).toBe(3500);
    expect(durationMs(undefined)).toBe(0);
  });
});
