import { describe, it, expect } from 'vitest';
import { DEFAULT_PROVIDERS, resolveStack, stackOf } from './providers.ts';

describe('provider defaults', () => {
  it('defaults to Chrome speech around Gemini', () => {
    expect(stackOf(DEFAULT_PROVIDERS)).toEqual({ stt: 'browser', llm: 'gemini', tts: 'browser' });
  });
  it('keeps Chrome speech where the browser has it', () => {
    expect(resolveStack(stackOf(DEFAULT_PROVIDERS), { stt: true, tts: true })).toEqual({ stt: 'browser', llm: 'gemini', tts: 'browser' });
  });
  it('falls back to Gemini (Live) without Web Speech', () => {
    expect(resolveStack(stackOf(DEFAULT_PROVIDERS), { stt: false, tts: false })).toEqual({ stt: 'gemini', llm: 'gemini', tts: 'gemini' });
    expect(resolveStack({ stt: 'browser', llm: 'openai', tts: 'elevenlabs' }, { stt: false, tts: true })).toEqual({ stt: 'gemini', llm: 'openai', tts: 'elevenlabs' });
  });
});
