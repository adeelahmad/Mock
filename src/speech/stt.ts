// Mock — speech to text for the turn-by-turn pipeline. Two shapes:
// - Chrome's Web Speech API (free; Chrome sends the audio to Google's recogniser): words
//   stream in, and an utterance ends after the configured pause with no new words.
// - Segmented recognisers (ElevenLabs Scribe, Gemini): the mic PCM is cut into utterances by a
//   level gate (speech, then `pauseMs` of quiet) and each one is uploaded as a WAV.
// Both stop listening while the interviewer speaks, so the speakers never transcribe themselves.

import { blobToBase64, generateText } from '../gemini/flash.ts';
import { INPUT_RATE, base64ToBytes, rms } from '../live/pcm.ts';
import { LlmError, timedFetch } from '../llm/chat.ts';

export interface SpeechIn {
  start(): Promise<void>;
  /** Words so far in the current utterance (Chrome only). */
  onPartial: ((text: string) => void) | null;
  /** A finished utterance: the candidate stopped for the pause. */
  onUtterance: ((text: string) => void) | null;
  onError: ((message: string) => void) | null;
  /** Off while the interviewer speaks or the session is paused; what was heard meanwhile is dropped. */
  setListening(on: boolean): void;
  /** Mic PCM (base64 16 kHz), for recognisers that take audio from the shared engine. */
  pcm?(base64: string): void;
  close(): void;
}

// ---------- Chrome ----------

type Rec = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

export class BrowserStt implements SpeechIn {
  onPartial: SpeechIn['onPartial'] = null;
  onUtterance: SpeechIn['onUtterance'] = null;
  onError: SpeechIn['onError'] = null;
  private rec: Rec | null = null;
  private listening = false;
  private running = false;
  private closed = false;
  private finals = '';
  private interim = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private o: { pauseMs: number; lang?: string; make?: () => Rec }) {}

  async start(): Promise<void> {
    const make = this.o.make ?? (() => { const C = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!C) throw new Error('This browser has no speech recognition — pick another speech-to-text in Settings'); return new C() as Rec; });
    const rec = make();
    rec.continuous = true; rec.interimResults = true;
    rec.lang = this.o.lang || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en-US';
    rec.onresult = (e) => {
      if (!this.listening) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finals += (this.finals ? ' ' : '') + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      this.interim = interim.trim();
      const text = [this.finals, this.interim].filter(Boolean).join(' ');
      if (text) this.onPartial?.(text);
      this.arm();
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.closed = true; this.onError?.('Chrome speech recognition was not allowed the microphone'); }
      else if (e.error === 'network') this.onError?.('Chrome speech recognition needs the internet (it runs on Google’s servers)');
      else this.onError?.('Speech recognition: ' + e.error);
    };
    // Chrome ends a session after a while or on silence: start again while listening.
    rec.onend = () => { this.running = false; if (!this.closed && this.listening) this.run(); };
    this.rec = rec;
  }

  private run(): void {
    if (!this.rec || this.running || this.closed) return;
    try { this.rec.start(); this.running = true; } catch { /* still stopping; onend restarts it */ }
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.o.pauseMs);
  }

  private commit(): void {
    this.timer = null;
    const text = [this.finals, this.interim].filter(Boolean).join(' ').trim();
    this.finals = ''; this.interim = '';
    if (text && this.listening) this.onUtterance?.(text);
  }

  setListening(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) this.run();
    else {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.finals = ''; this.interim = '';
      // Abort drops whatever the recogniser is still holding (the interviewer's own voice).
      try { this.rec?.abort(); } catch { /* not running */ }
    }
  }

  close(): void {
    this.closed = true; this.listening = false;
    if (this.timer) clearTimeout(this.timer);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
  }
}

// ---------- Segmented (upload each utterance) ----------

export type Transcriber = (wav: Blob) => Promise<string>;

const SPEECH_ON = 0.05, SPEECH_OFF = 0.025;
/** Shorter blips (a cough, a click) are not sent. */
const MIN_VOICED_MS = 300;
/** Longer monologues are cut and sent in pieces. */
const MAX_SEGMENT_MS = 60_000;
const PREROLL_MS = 300;

/** Mono 16-bit PCM → a WAV file. */
export function wavBlob(chunks: Uint8Array[], rate = INPUT_RATE): Blob {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const h = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); h.setUint32(4, 36 + len, true); str(8, 'WAVE'); str(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true);
  h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); str(36, 'data'); h.setUint32(40, len, true);
  return new Blob([h.buffer, ...chunks.map((c) => c.slice().buffer)], { type: 'audio/wav' });
}

function levelOf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length >> 1;
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true); f[i] = v / 0x8000; }
  return Math.min(1, rms(f) * 4);
}

export class SegmentedStt implements SpeechIn {
  onPartial: SpeechIn['onPartial'] = null;
  onUtterance: SpeechIn['onUtterance'] = null;
  onError: SpeechIn['onError'] = null;
  private listening = false;
  private closed = false;
  private preroll: Uint8Array[] = [];
  private seg: Uint8Array[] | null = null;
  private segMs = 0;
  private voicedMs = 0;
  private quietMs = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private o: { pauseMs: number; transcribe: Transcriber }) {}

  async start(): Promise<void> { /* audio comes from the shared engine through pcm() */ }

  pcm(base64: string): void {
    if (!this.listening || this.closed) return;
    const bytes = base64ToBytes(base64);
    const ms = (bytes.length / 2 / INPUT_RATE) * 1000;
    const level = levelOf(bytes);
    if (!this.seg) {
      this.preroll.push(bytes);
      let pre = this.preroll.reduce((n, c) => n + c.length, 0);
      while (this.preroll.length > 1 && (pre - this.preroll[0].length) / 2 / INPUT_RATE * 1000 >= PREROLL_MS) pre -= this.preroll.shift()!.length;
      if (level > SPEECH_ON) { this.seg = this.preroll; this.preroll = []; this.segMs = ms; this.voicedMs = ms; this.quietMs = 0; }
      return;
    }
    this.seg.push(bytes);
    this.segMs += ms;
    if (level > SPEECH_OFF) { this.voicedMs += ms; this.quietMs = 0; } else this.quietMs += ms;
    if (this.quietMs >= this.o.pauseMs || this.segMs >= MAX_SEGMENT_MS) this.flush();
  }

  private flush(): void {
    const seg = this.seg, voiced = this.voicedMs;
    this.seg = null; this.segMs = 0; this.voicedMs = 0; this.quietMs = 0;
    if (!seg || voiced < MIN_VOICED_MS) return;
    const wav = wavBlob(seg);
    // In order: a slow upload never lets a later utterance overtake it.
    this.chain = this.chain.then(async () => {
      try {
        const text = (await this.o.transcribe(wav)).trim();
        if (text && !this.closed) this.onUtterance?.(text);
      } catch (err) { if (!this.closed) this.onError?.('Speech to text failed: ' + ((err as Error).message || 'unknown')); }
    });
  }

  setListening(on: boolean): void {
    this.listening = on;
    if (!on) { this.seg = null; this.preroll = []; this.segMs = 0; this.voicedMs = 0; this.quietMs = 0; }
  }

  close(): void { this.closed = true; this.listening = false; this.seg = null; }
}

/** ElevenLabs Scribe: `POST /v1/speech-to-text` (multipart: model_id, file) → `{ text }`. */
export function elevenLabsTranscriber(o: { key: string; model: string; fetch?: typeof fetch }): Transcriber {
  return async (wav) => {
    const form = new FormData();
    form.append('model_id', o.model || 'scribe_v1');
    form.append('file', wav, 'utterance.wav');
    form.append('tag_audio_events', 'false');
    const res = await timedFetch(o.fetch ?? fetch, 'https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': o.key }, body: form }, 30_000);
    const json = (await res.json().catch(() => null)) as { text?: string; detail?: { message?: string } | string } | null;
    if (!res.ok) throw new LlmError((typeof json?.detail === 'string' ? json.detail : json?.detail?.message) || 'ElevenLabs returned ' + res.status, res.status);
    return json?.text ?? '';
  };
}

/** Gemini as a recogniser: the utterance inline, "transcribe verbatim". */
export function geminiTranscriber(o: { key: string; model: string; fetch?: typeof fetch }): Transcriber {
  return async (wav) => {
    const text = await generateText({
      key: o.key, model: o.model, fetch: o.fetch, temperature: 0, timeoutMs: 30_000,
      system: 'You are a speech recogniser. Transcribe the audio verbatim in its language. Reply with the transcript only; reply with nothing if there is no speech.',
      parts: [{ text: 'Transcribe this.' }, { inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }],
    }).catch((err) => { if (/Empty reply/.test((err as Error).message)) return ''; throw err; });
    return text.replace(/^["“]|["”]$/g, '');
  };
}
