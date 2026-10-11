// Mock — text to speech for the turn-by-turn pipeline, one sentence at a time so the first
// words play while the rest are still being made:
// - Chrome's speechSynthesis (free, on-device voices). It plays outside the Web Audio graph,
//   so the session recording holds only the candidate's side.
// - PCM voices (ElevenLabs, Gemini TTS): fetched in parallel, played in order through the shared
//   audio engine, so they are in the recording like Gemini Live's voice.

import { GEMINI_BASE } from '../gemini/flash.ts';
import { reportUsage } from '../gemini/usage.ts';
import type { AudioIO } from '../live/audio.ts';
import { bytesToBase64, rateOf } from '../live/pcm.ts';
import { LlmError, timedFetch } from '../llm/chat.ts';

export interface SpeechOut {
  /** Queue a sentence. */
  speak(text: string): void;
  /** Stop now and drop the queue (barge-in, pause, next). */
  stop(): void;
  /** True while anything is queued, being made, or playing. */
  isSpeaking(): boolean;
  onSpeaking: ((speaking: boolean) => void) | null;
  onError: ((message: string) => void) | null;
  close(): void;
}

/** Markdown and stage directions are not for reading aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[(?:[A-Z_ ]{2,20})\]/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences, merging very short ones so a voice is not asked for "OK." on its own. */
export function sentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["”')\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < 24) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

// ---------- Chrome ----------

export class BrowserTts implements SpeechOut {
  onSpeaking: SpeechOut['onSpeaking'] = null;
  onError: SpeechOut['onError'] = null;
  private pending = 0;
  private epoch = 0;
  private synth: SpeechSynthesis;

  constructor(private o: { voice?: string; rate?: number; lang?: string; synth?: SpeechSynthesis; make?: (text: string) => SpeechSynthesisUtterance } = {}) {
    this.synth = o.synth ?? window.speechSynthesis;
  }

  private voice(): SpeechSynthesisVoice | null {
    const name = this.o.voice;
    const list = this.synth.getVoices?.() ?? [];
    return (name ? list.find((v) => v.name === name) : null) ?? null;
  }

  speak(text: string): void {
    const u = this.o.make ? this.o.make(text) : new SpeechSynthesisUtterance(text);
    const v = this.voice();
    if (v) { u.voice = v; u.lang = v.lang; } else if (this.o.lang) u.lang = this.o.lang;
    u.rate = this.o.rate || 1;
    const epoch = this.epoch;
    const done = () => { if (epoch !== this.epoch) return; this.pending = Math.max(0, this.pending - 1); if (!this.pending) this.onSpeaking?.(false); };
    u.onend = done;
    u.onerror = (e) => { if (epoch === this.epoch && e.error !== 'interrupted' && e.error !== 'canceled') this.onError?.('Chrome voice: ' + e.error); done(); };
    if (!this.pending) this.onSpeaking?.(true);
    this.pending++;
    this.synth.speak(u);
  }

  stop(): void {
    this.epoch++;
    const had = this.pending > 0;
    this.pending = 0;
    this.synth.cancel();
    if (had) this.onSpeaking?.(false);
  }

  isSpeaking(): boolean { return this.pending > 0; }
  close(): void { this.stop(); }
}

/** Chrome's voices; they load asynchronously, so wait for `voiceschanged` once. */
export function browserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const t = setTimeout(() => res(speechSynthesis.getVoices()), 1500);
    speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); res(speechSynthesis.getVoices()); }, { once: true });
  });
}

// ---------- PCM voices ----------

export type Synth = (text: string, signal: AbortSignal) => Promise<{ base64: string; rate: number }>;

export class PcmTts implements SpeechOut {
  onSpeaking: SpeechOut['onSpeaking'] = null;
  onError: SpeechOut['onError'] = null;
  private pending = 0;
  private playing = false;
  private shown = false;
  private chain: Promise<void> = Promise.resolve();
  private ctl = new AbortController();

  constructor(private audio: AudioIO, private synth: Synth) {
    audio.onSpeaking = (s) => { this.playing = s; this.update(); };
  }

  private update(): void {
    const on = this.isSpeaking();
    if (on !== this.shown) { this.shown = on; this.onSpeaking?.(on); }
  }

  speak(text: string): void {
    const ctl = this.ctl;
    const made = this.synth(text, ctl.signal);
    made.catch(() => undefined);
    this.pending++;
    this.update();
    this.chain = this.chain.then(async () => {
      try {
        const a = await made;
        if (!ctl.signal.aborted && a.base64) this.audio.play(a.base64, a.rate);
      } catch (err) {
        if (!ctl.signal.aborted) this.onError?.('Voice failed: ' + ((err as Error).message || 'unknown'));
      } finally {
        if (ctl === this.ctl) { this.pending = Math.max(0, this.pending - 1); this.update(); }
      }
    });
  }

  stop(): void {
    this.ctl.abort();
    this.ctl = new AbortController();
    this.pending = 0;
    this.audio.stopPlayback();
    this.playing = false;
    this.update();
  }

  isSpeaking(): boolean { return this.pending > 0 || this.playing || this.audio.isSpeaking(); }
  close(): void { this.ctl.abort(); this.pending = 0; }
}

/** ElevenLabs: `POST /v1/text-to-speech/{voice}?output_format=pcm_24000` → raw 16-bit PCM. */
export function elevenLabsSynth(o: { key: string; voiceId: string; model: string; fetch?: typeof fetch }): Synth {
  return async (text, signal) => {
    const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(o.voiceId) + '?output_format=pcm_24000';
    const res = await timedFetch(o.fetch ?? fetch, url, { method: 'POST', headers: { 'xi-api-key': o.key, 'content-type': 'application/json', accept: 'audio/pcm' }, body: JSON.stringify({ text, model_id: o.model }) }, 30_000, signal);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { detail?: { message?: string } | string } | null;
      throw new LlmError((typeof j?.detail === 'string' ? j.detail : j?.detail?.message) || 'ElevenLabs returned ' + res.status, res.status);
    }
    return { base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())), rate: 24000 };
  };
}

/** Gemini TTS: `generateContent` with `responseModalities: ["AUDIO"]` → inline 24 kHz PCM. */
export function geminiSynth(o: { key: string; model: string; voice: string; fetch?: typeof fetch }): Synth {
  return async (text, signal) => {
    const body = {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice } } } },
    };
    const res = await timedFetch(o.fetch ?? fetch, GEMINI_BASE + '/models/' + encodeURIComponent(o.model) + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.key }, body: JSON.stringify(body) }, 30_000, signal);
    const j = (await res.json().catch(() => null)) as { error?: { message?: string }; candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]; usageMetadata?: unknown } | null;
    if (j?.usageMetadata) reportUsage(o.model, null, j.usageMetadata);
    if (!res.ok) throw new LlmError(j?.error?.message || 'Gemini TTS returned ' + res.status, res.status);
    const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    return { base64: part?.inlineData?.data ?? '', rate: rateOf(part?.inlineData?.mimeType, 24000) };
  };
}
