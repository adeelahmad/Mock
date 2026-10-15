// Mock — how the canvas hears the candidate: live captions (words as they are said) and
// finished stretches of speech, cut on a pause. Two kinds, picked by the speech-to-text
// provider:
// - Gemini (default): a Gemini Live connection used for its input transcription. Its model is
//   told to stay quiet and nothing it says is played; the canvas AI is the text coach.
// - Chrome / ElevenLabs: the pipeline's recognisers (speech/stt.ts).
// The audio comes from the mic, or from a Meet call heard through the Meet Media API.

import { BrowserAudio, type AudioIO } from '../live/audio.ts';
import { GeminiLiveTransport, type SocketLike } from '../live/gemini.ts';
import type { LiveTransport } from '../live/transport.ts';
import { reportUsage } from '../gemini/usage.ts';
import type { SpeechIn } from '../speech/stt.ts';

export interface Ear {
  start(): Promise<void>;
  /** The words of the stretch being spoken now (captions). */
  onPartial: ((text: string) => void) | null;
  /** A finished stretch of speech. */
  onFinal: ((text: string) => void) | null;
  onLevel: ((level: number) => void) | null;
  onError: ((message: string) => void) | null;
  setListening(on: boolean): void;
  close(): void;
}

/** Gemini Live only listens here: its replies are not played or shown. */
export const LISTEN_ONLY = 'You are a silent listener in a practice tool. The app shows the user\'s words as captions and coaches in text. Never speak at length: reply to anything with just "Okay."';

/**
 * Captions from a transcribing stream: fragments are joined into the current stretch, and a
 * stretch ends after `pauseMs` with no new words (or when the model takes its turn).
 */
export class Captions {
  onPartial: ((text: string) => void) | null = null;
  onFinal: ((text: string) => void) | null = null;
  private text = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private pauseMs: number) {}

  add(fragment: string): void {
    if (!fragment) return;
    // Live sends pieces with their own leading spaces; join without doubling them.
    this.text = (this.text + (this.text && !/^\s/.test(fragment) && !/\s$/.test(this.text) ? ' ' : '') + fragment).replace(/\s+/g, ' ');
    const t = this.text.trim();
    if (t) this.onPartial?.(t);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.end(), this.pauseMs);
  }

  end(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const t = this.text.trim();
    this.text = '';
    if (t) this.onFinal?.(t);
  }

  drop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.text = ''; }
}

export interface LiveEarOptions {
  key: string;
  model: string;
  voice: string;
  pauseMs: number;
  audio: AudioIO;
  socket?: (url: string) => SocketLike;
  /** Tests pass a transport. */
  transport?: LiveTransport;
}

export class LiveEar implements Ear {
  onPartial: Ear['onPartial'] = null;
  onFinal: Ear['onFinal'] = null;
  onLevel: Ear['onLevel'] = null;
  onError: Ear['onError'] = null;
  private t: LiveTransport;
  private captions: Captions;
  private listening = false;

  constructor(private o: LiveEarOptions) {
    this.t = o.transport ?? new GeminiLiveTransport({ auth: { kind: 'key', key: o.key }, audio: o.audio, socket: o.socket, transcribeInput: true });
    this.captions = new Captions(o.pauseMs);
    this.captions.onPartial = (t) => this.onPartial?.(t);
    this.captions.onFinal = (t) => this.onFinal?.(t);
    this.t.on((e) => {
      if (e.type === 'inputTranscript' && this.listening) this.captions.add(e.text);
      else if (e.type === 'outputTranscript' || e.type === 'turnComplete') this.captions.end();
      else if (e.type === 'level') this.onLevel?.(this.listening ? e.value : 0);
      else if (e.type === 'usage') reportUsage(e.model ?? this.o.model, null, e.usageMetadata);
      else if (e.type === 'error') this.onError?.(e.message);
    });
  }

  async start(): Promise<void> {
    await this.t.connect({ model: this.o.model, voice: this.o.voice, systemInstruction: LISTEN_ONLY, tools: [], silenceDurationMs: this.o.pauseMs });
  }

  setListening(on: boolean): void {
    this.listening = on;
    this.t.setMuted(!on);
    if (!on) this.captions.end();
  }

  close(): void { this.captions.drop(); this.t.close(); }
}

/** One of the pipeline's recognisers. Segmented ones take PCM from the audio engine. */
export class SpeechEar implements Ear {
  onPartial: Ear['onPartial'] = null;
  onFinal: Ear['onFinal'] = null;
  onLevel: Ear['onLevel'] = null;
  onError: Ear['onError'] = null;

  constructor(private stt: SpeechIn, private audio: AudioIO | null) {
    stt.onPartial = (t) => this.onPartial?.(t);
    stt.onUtterance = (t) => this.onFinal?.(t);
    stt.onError = (m) => this.onError?.(m);
    if (audio) {
      audio.onPcm = (b64) => stt.pcm?.(b64);
      audio.onLevel = (v) => this.onLevel?.(v);
    }
  }

  async start(): Promise<void> {
    if (this.audio) await this.audio.start();
    await this.stt.start();
  }

  setListening(on: boolean): void { this.audio?.setMuted(!on); this.stt.setListening(on); }
  close(): void { this.stt.close(); this.audio?.close(); }
}

/** Audio for an ear: the mic, or a given stream (the Meet call). Nothing is played or recorded. */
export function earAudio(input: MediaStream | null): BrowserAudio {
  const a = new BrowserAudio({ mic: true, record: false, speakers: false });
  if (input) a.setInput(input);
  return a;
}
