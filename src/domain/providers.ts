// Mock — who listens, thinks and speaks. By default Chrome's built-in speech listens and speaks
// (free) and Gemini thinks; where the browser lacks Web Speech, Gemini fills in (resolveStack).
// Gemini Live does all three in one connection. Any other choice runs a turn-by-turn pipeline (live/pipeline.ts): speech to
// text → a language model → text to speech, each picked separately, globally in Settings and
// per session in the setup sheet. Chrome's built-in speech and a local model (Ollama, LM Studio,
// llama.cpp…) cost nothing; ElevenLabs bills your ElevenLabs account.

export type SttProvider = 'gemini' | 'browser' | 'elevenlabs';
export type TtsProvider = 'gemini' | 'browser' | 'elevenlabs';
export type LlmProvider = 'gemini' | 'openai';

/** The three choices for one session. */
export interface VoiceStack { stt: SttProvider; llm: LlmProvider; tts: TtsProvider }

export interface OpenAiSettings {
  /** An OpenAI-compatible API root, e.g. http://localhost:11434/v1 (Ollama). */
  baseUrl: string;
  model: string;
  /** The model's context window, tokens: the system prompt and history are trimmed to fit. */
  contextTokens: number;
  /** Longest reply, tokens (`max_tokens`). */
  maxOutputTokens: number;
}

export interface ProviderSettings extends VoiceStack {
  openai: OpenAiSettings;
  elevenlabs: { voiceId: string; ttsModel: string; sttModel: string };
  /** Chrome's speechSynthesis voice (name; '' = the browser default), rate, and the recognition language ('' = the browser's). */
  browser: { voice: string; rate: number; lang: string };
  /** Gemini's text-to-speech model, used when TTS is Gemini outside Live. */
  geminiTtsModel: string;
}

export const DEFAULT_PROVIDERS: ProviderSettings = {
  stt: 'browser', llm: 'gemini', tts: 'browser',
  openai: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', contextTokens: 32_768, maxOutputTokens: 1024 },
  elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM', ttsModel: 'eleven_flash_v2_5', sttModel: 'scribe_v1' },
  browser: { voice: '', rate: 1, lang: '' },
  geminiTtsModel: 'gemini-2.5-flash-preview-tts',
};

/** Settings saved before providers existed (or partly filled) → a complete object. */
export function withProviderDefaults(p: Partial<ProviderSettings> | null | undefined): ProviderSettings {
  const d = DEFAULT_PROVIDERS;
  return {
    ...d, ...(p ?? {}),
    openai: { ...d.openai, ...(p?.openai ?? {}) },
    elevenlabs: { ...d.elevenlabs, ...(p?.elevenlabs ?? {}) },
    browser: { ...d.browser, ...(p?.browser ?? {}) },
  };
}

export const stackOf = (p: VoiceStack): VoiceStack => ({ stt: p.stt, llm: p.llm, tts: p.tts });

/** All three on Gemini: the session runs on one Gemini Live connection. */
export const isLiveStack = (s: VoiceStack): boolean => s.stt === 'gemini' && s.llm === 'gemini' && s.tts === 'gemini';

export const STT_LABEL: Record<SttProvider, string> = { gemini: 'Gemini', browser: 'Chrome (free)', elevenlabs: 'ElevenLabs Scribe' };
export const TTS_LABEL: Record<TtsProvider, string> = { gemini: 'Gemini', browser: 'Chrome (free)', elevenlabs: 'ElevenLabs' };
export const LLM_LABEL: Record<LlmProvider, string> = { gemini: 'Gemini', openai: 'OpenAI-compatible' };

export function stackLabel(s: VoiceStack, openaiModel?: string): string {
  if (isLiveStack(s)) return 'Gemini Live';
  return [STT_LABEL[s.stt], s.llm === 'openai' ? (openaiModel || 'OpenAI-compatible') : 'Gemini', TTS_LABEL[s.tts]].map((x) => x.replace(' (free)', '')).join(' → ');
}

export interface Credentials { gemini: boolean; openaiUrl: boolean; elevenlabs: boolean }

/** What the stack still needs before it can run, in words ("a Gemini key"), or null when it is ready. */
export function missingFor(s: VoiceStack, c: Credentials): string | null {
  const need: string[] = [];
  if ((s.stt === 'gemini' || s.llm === 'gemini' || s.tts === 'gemini') && !c.gemini) need.push('a Gemini key');
  if (s.llm === 'openai' && !c.openaiUrl) need.push('an OpenAI-compatible base URL');
  if ((s.stt === 'elevenlabs' || s.tts === 'elevenlabs') && !c.elevenlabs) need.push('an ElevenLabs key');
  return need.length ? need.join(' and ') : null;
}

/** Chrome's speech engines, when this browser has them. */
export const browserStt = (): boolean => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
export const browserTts = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof (window as any).SpeechSynthesisUtterance === 'function';

/** Chrome's speech where this browser has it; otherwise Gemini (Live, when nothing else is left). */
export function resolveStack(s: VoiceStack, has = { stt: browserStt(), tts: browserTts() }): VoiceStack {
  return { stt: s.stt === 'browser' && !has.stt ? 'gemini' : s.stt, llm: s.llm, tts: s.tts === 'browser' && !has.tts ? 'gemini' : s.tts };
}
