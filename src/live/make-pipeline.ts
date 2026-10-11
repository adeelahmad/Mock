// Mock — builds the pipeline transport and the coach's text model from the provider settings
// (domain/providers.ts) and the keys kept in this browser.

import type { ProviderSettings, VoiceStack } from '../domain/providers.ts';
import type { AudioIO } from './audio.ts';
import { PipelineTransport } from './pipeline.ts';
import { GeminiChat } from '../llm/gemini-chat.ts';
import { OpenAiChat, openAiText } from '../llm/openai.ts';
import type { ChatModel, TextLlm } from '../llm/chat.ts';
import { BrowserStt, SegmentedStt, elevenLabsTranscriber, geminiTranscriber, type SpeechIn } from '../speech/stt.ts';
import { BrowserTts, PcmTts, elevenLabsSynth, geminiSynth, type SpeechOut } from '../speech/tts.ts';

export interface ProviderKeys { openai: string; elevenlabs: string }

export interface PipelineSetup {
  stack: VoiceStack;
  providers: ProviderSettings;
  keys: ProviderKeys;
  geminiKey: string;
  /** Gemini's text model (Settings), for the model and the recogniser when they are Gemini. */
  textModel: string;
  /** Gemini voice name, for Gemini TTS. */
  voice: string;
  pauseMs: number;
  audio: AudioIO;
}

export function chatModel(stack: VoiceStack, p: ProviderSettings, keys: ProviderKeys, geminiKey: string, textModel: string): ChatModel {
  return stack.llm === 'openai' ? new OpenAiChat({ ...p.openai, key: keys.openai }) : new GeminiChat({ key: geminiKey, model: textModel });
}

/** The model that writes cards and reports when it is not Gemini Flash; null → Flash. */
export function textLlm(stack: VoiceStack, p: ProviderSettings, keys: ProviderKeys): TextLlm | null {
  return stack.llm === 'openai' && p.openai.baseUrl.trim() ? openAiText({ ...p.openai, key: keys.openai }) : null;
}

export function makePipeline(o: PipelineSetup): PipelineTransport {
  const p = o.providers;
  const stt: SpeechIn = o.stack.stt === 'browser'
    ? new BrowserStt({ pauseMs: o.pauseMs, lang: p.browser.lang })
    : new SegmentedStt({ pauseMs: o.pauseMs, transcribe: o.stack.stt === 'elevenlabs' ? elevenLabsTranscriber({ key: o.keys.elevenlabs, model: p.elevenlabs.sttModel }) : geminiTranscriber({ key: o.geminiKey, model: o.textModel }) });
  const tts: SpeechOut = o.stack.tts === 'browser'
    ? new BrowserTts({ voice: p.browser.voice, rate: p.browser.rate, lang: p.browser.lang })
    : new PcmTts(o.audio, o.stack.tts === 'elevenlabs'
      ? elevenLabsSynth({ key: o.keys.elevenlabs, voiceId: p.elevenlabs.voiceId, model: p.elevenlabs.ttsModel })
      : geminiSynth({ key: o.geminiKey, model: p.geminiTtsModel, voice: o.voice }));
  return new PipelineTransport({ audio: o.audio, stt, llm: chatModel(o.stack, p, o.keys, o.geminiKey, o.textModel), tts });
}
