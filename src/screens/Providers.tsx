// Settings · Voice & model — who listens, thinks and speaks (domain/providers.ts). The default
// stack (three selects) is used by every session unless the setup sheet picks another for one
// session (StackPicker is shared). Below it, each provider's own fields: an OpenAI-compatible
// endpoint (base URL, key, model, context size, reply length, "Test"), ElevenLabs (key, voice,
// models), Chrome's voice and language, and Gemini's TTS model. Keys stay in this browser.

import React, { useEffect, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { Input, Select } from '../components/ui.tsx';
import { LLM_LABEL, browserStt, browserTts, isLiveStack, stackLabel, stackOf, type LlmProvider, type SttProvider, type TtsProvider, type VoiceStack } from '../domain/providers.ts';
import { OpenAiChat } from '../llm/openai.ts';
import { BrowserAudio } from '../live/audio.ts';
import { BrowserTts, PcmTts, browserVoices, elevenLabsSynth, geminiSynth, type SpeechOut } from '../speech/tts.ts';

const SAMPLE = 'Hi, I will be your interviewer today. Tell me about a time you disagreed with your manager.';

export function StackPicker({ value, onChange }: { value: VoiceStack; onChange: (s: VoiceStack) => void }) {
  const chromeIn = browserStt(), chromeOut = browserTts();
  const stt: { value: SttProvider; label: string }[] = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'browser', label: 'Chrome · free' + (chromeIn ? '' : ' · not in this browser') },
    { value: 'elevenlabs', label: 'ElevenLabs Scribe' },
  ];
  const llm: { value: LlmProvider; label: string }[] = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'openai', label: 'OpenAI-compatible · Ollama, LM Studio…' },
  ];
  const tts: { value: TtsProvider; label: string }[] = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'browser', label: 'Chrome · free' + (chromeOut ? '' : ' · not in this browser') },
    { value: 'elevenlabs', label: 'ElevenLabs' },
  ];
  return (
    <div className="stack g8">
      <Select label="Speech to text" options={stt} value={value.stt} onChange={(v) => onChange({ ...value, stt: v as SttProvider })} />
      <Select label="Language model" options={llm} value={value.llm} onChange={(v) => onChange({ ...value, llm: v as LlmProvider })} />
      <Select label="Text to speech" options={tts} value={value.tts} onChange={(v) => onChange({ ...value, tts: v as TtsProvider })} />
    </div>
  );
}

/** A text field saved on blur or Enter. */
function Field({ label, value, onSave, hint, type = 'text', mono = true, placeholder }: { label: string; value: string; onSave: (v: string) => void; hint?: React.ReactNode; type?: string; mono?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft.trim() !== value) onSave(draft.trim()); };
  return (
    <Input label={label} type={type} mono={mono} value={draft} placeholder={placeholder} spellCheck={false} autoComplete="off" hint={hint}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') commit(); }} />
  );
}

const num = (v: string, min: number, fallback: number): number => { const n = parseInt(v.replace(/[^\d]/g, ''), 10); return Number.isFinite(n) && n >= min ? n : fallback; };

export function ProvidersSection() {
  const { providers, gemini, data } = useApp();
  const p = providers.settings;
  const stack = stackOf(p);
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; text: string }>({ state: 'idle', text: '' });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState<SpeechOut | null>(null);
  useEffect(() => { let alive = true; void browserVoices().then((v) => { if (alive) setVoices(v); }); return () => { alive = false; }; }, []);
  useEffect(() => () => playing?.close(), [playing]);

  const testLlm = async () => {
    setTest({ state: 'busy', text: 'Asking ' + (p.openai.model || 'the model') + '…' });
    try {
      const chat = new OpenAiChat({ ...p.openai, key: providers.keys.openai, timeoutMs: 60_000 });
      const r = await chat.complete({ system: 'You are a friendly interviewer. Reply in one short sentence.', turns: [{ role: 'user', text: 'Say hello.' }], tools: [] });
      setTest({ state: 'ok', text: '“' + (r.text || '(empty reply)') + '”' + (r.usage ? ' · ' + (r.usage.promptTokenCount + r.usage.candidatesTokenCount) + ' tokens' : '') });
    } catch (e) {
      setTest({ state: 'err', text: (e as Error).message + (/Network error|Failed to fetch/i.test((e as Error).message) ? ' · is the server running and does it allow this site (Ollama: OLLAMA_ORIGINS)?' : '') });
    }
  };

  const preview = (which: TtsProvider) => {
    playing?.close();
    let out: SpeechOut;
    if (which === 'browser') out = new BrowserTts({ voice: p.browser.voice, rate: p.browser.rate, lang: p.browser.lang });
    else {
      const audio = new BrowserAudio({ mic: false, record: false });
      void audio.start();
      const synth = which === 'elevenlabs'
        ? elevenLabsSynth({ key: providers.keys.elevenlabs, voiceId: p.elevenlabs.voiceId, model: p.elevenlabs.ttsModel })
        : geminiSynth({ key: gemini.key, model: p.geminiTtsModel, voice: data.settings.voice });
      const pcm = new PcmTts(audio, synth);
      const close = pcm.close.bind(pcm);
      pcm.close = () => { close(); audio.close(); };
      out = pcm;
    }
    out.onError = (m) => setTest({ state: 'err', text: m });
    out.speak(SAMPLE);
    setPlaying(out);
  };

  const voiceOpts = [{ value: '', label: 'Browser default' }, ...voices.map((v) => ({ value: v.name, label: v.name + ' · ' + v.lang }))];

  return (
    <div className="stack g8"><span className="label">Voice &amp; model</span>
      <div className="card pad r12 stack g12">
        <span className="srow-sub">
          {isLiveStack(stack)
            ? 'All Gemini runs on Gemini Live: the most natural conversation, and the default.'
            : 'Now: ' + stackLabel(stack, p.openai.model) + '. Sessions run turn by turn: you speak, the model writes, the voice reads it out. Chrome and local models cost nothing.'}
          {' '}You can pick another for one session under More when you start.
        </span>
        <StackPicker value={stack} onChange={(s) => void providers.save(s)} />
      </div>

      <details className="card pad r12 stack g12" open={stack.llm === 'openai'}>
        <summary className="srow-title">{LLM_LABEL.openai} model</summary>
        <Field label="Base URL" value={p.openai.baseUrl} placeholder="http://localhost:11434/v1" onSave={(v) => void providers.save({ openai: { ...p.openai, baseUrl: v } })}
          hint="Ollama: http://localhost:11434/v1 (start it with OLLAMA_ORIGINS set to this site). OpenAI: https://api.openai.com/v1." />
        <Field label="API key" type="password" value={providers.keys.openai} placeholder="optional for local servers" onSave={(v) => void providers.setKey('openai', v)} hint="Stored only in this browser." />
        <Field label="Model name" value={p.openai.model} placeholder="llama3.2" onSave={(v) => void providers.save({ openai: { ...p.openai, model: v } })} />
        <div className="hstack" style={{ gap: 10 }}>
          <Field label="Context size (tokens)" value={String(p.openai.contextTokens)} onSave={(v) => void providers.save({ openai: { ...p.openai, contextTokens: num(v, 1024, p.openai.contextTokens) } })} />
          <Field label="Max reply (tokens)" value={String(p.openai.maxOutputTokens)} onSave={(v) => void providers.save({ openai: { ...p.openai, maxOutputTokens: num(v, 16, p.openai.maxOutputTokens) } })} />
        </div>
        <span className="srow-sub">The session prompt and the conversation are trimmed to fit the context size. The model also writes the coach cards and the report; it needs tool calling for questions to be pinned.</span>
        <div className="gem-test">
          <button className="btn md cool" onClick={() => void testLlm()} disabled={test.state === 'busy' || !p.openai.baseUrl}>Test · say hello</button>
          <span className={'gem-status' + (test.state === 'ok' ? ' ok' : '')} role="status">{test.text}</span>
        </div>
      </details>

      <details className="card pad r12 stack g12" open={stack.stt === 'elevenlabs' || stack.tts === 'elevenlabs'}>
        <summary className="srow-title">ElevenLabs</summary>
        <Field label="API key" type="password" value={providers.keys.elevenlabs} onSave={(v) => void providers.setKey('elevenlabs', v)} hint="Stored only in this browser. ElevenLabs bills your account per character; Mock's spend counter does not include it." />
        <Field label="Voice id" value={p.elevenlabs.voiceId} onSave={(v) => void providers.save({ elevenlabs: { ...p.elevenlabs, voiceId: v } })} hint="From the ElevenLabs voice library." />
        <div className="hstack" style={{ gap: 10 }}>
          <Field label="Voice model" value={p.elevenlabs.ttsModel} onSave={(v) => void providers.save({ elevenlabs: { ...p.elevenlabs, ttsModel: v } })} />
          <Field label="Speech-to-text model" value={p.elevenlabs.sttModel} onSave={(v) => void providers.save({ elevenlabs: { ...p.elevenlabs, sttModel: v } })} />
        </div>
        <div className="gem-test"><button className="btn md" onClick={() => preview('elevenlabs')} disabled={!providers.keys.elevenlabs}>Preview voice</button></div>
      </details>

      <details className="card pad r12 stack g12" open={stack.stt === 'browser' || stack.tts === 'browser'}>
        <summary className="srow-title">Chrome speech</summary>
        <Select label="Voice" options={voiceOpts} value={p.browser.voice} onChange={(v) => void providers.save({ browser: { ...p.browser, voice: v } })} />
        <div className="hstack" style={{ gap: 10 }}>
          <Field label="Rate" value={String(p.browser.rate)} onSave={(v) => { const r = Number(v); void providers.save({ browser: { ...p.browser, rate: Number.isFinite(r) && r >= 0.5 && r <= 2 ? r : 1 } }); }} />
          <Field label="Language" value={p.browser.lang} placeholder={typeof navigator !== 'undefined' ? navigator.language : 'en-US'} onSave={(v) => void providers.save({ browser: { ...p.browser, lang: v } })} />
        </div>
        <span className="srow-sub">Free. Chrome’s recogniser sends the audio to Google; its voices play on this device and are not in the session recording.</span>
        <div className="gem-test"><button className="btn md" onClick={() => preview('browser')} disabled={!browserTts()}>Preview voice</button></div>
      </details>

      <details className="card pad r12 stack g12" open={!isLiveStack(stack) && stack.tts === 'gemini'}>
        <summary className="srow-title">Gemini outside Live</summary>
        <Field label="Text-to-speech model" value={p.geminiTtsModel} onSave={(v) => void providers.save({ geminiTtsModel: v })} hint={'Speaks with the interviewer voice above (' + data.settings.voice + '). Recognition and the model use the text model, ' + data.settings.textModel + '.'} />
        <div className="gem-test"><button className="btn md" onClick={() => preview('gemini')} disabled={!gemini.hasKey}>Preview voice</button></div>
      </details>
    </div>
  );
}
