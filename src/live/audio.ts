// Mock — browser audio for the live connection: AudioWorklet mic capture (resampled to
// 16 kHz PCM for Gemini), a playback scheduler for the 24 kHz model audio, a mixed track
// (mic + model) recorded with MediaRecorder in one-second chunks, per-exchange clips, the
// screen wake lock, iOS AudioContext unlock on a gesture, and mic re-acquisition when the
// audio devices change. The transport talks to it through `AudioIO`, so tests use a fake.

import { INPUT_RATE, floatToInt16, int16ToBase64, resample, rms } from './pcm.ts';

export interface AudioIO {
  /** Ask for the mic (when wanted) and start capture. Rejects when the mic is refused. */
  start(): Promise<void>;
  /** base64 16 kHz PCM frames, ~100 ms each; not called while muted. */
  onPcm: ((base64: string) => void) | null;
  /** Mic level 0..1, ~10 per second (0 while muted). */
  onLevel: ((value: number) => void) | null;
  /** Model playback started (true) or drained/stopped (false). */
  onSpeaking: ((speaking: boolean) => void) | null;
  /** A recording chunk of the mixed track, in order. */
  onRecordingChunk: ((blob: Blob) => void) | null;
  setMuted(muted: boolean): void;
  play(base64Pcm: string, rate: number): void;
  stopPlayback(): void;
  isSpeaking(): boolean;
  /** Stops the recorder and returns the whole mixed recording (null when not recording). */
  recordingBlob(): Promise<Blob | null>;
  /** Start a clip of the mixed track (closes any open clip). */
  beginClip(): void;
  /** Stop the open clip and return it. */
  endClip(): Promise<Blob | null>;
  close(): void;
}

export interface BrowserAudioOptions {
  /** Capture the mic (false for the voice preview). */
  mic?: boolean;
  /** Record the mixed track and clips (false for hello/preview). */
  record?: boolean;
  /** Play model audio out loud (false when it plays somewhere else, e.g. a Meet call). */
  speakers?: boolean;
}

// The worklet batches 128-sample render quanta into ~2048-sample frames and posts them.
const WORKLET = `
class MockCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('mock-capture', MockCapture);
`;

const RECORD_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return RECORD_MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? '';
}

type WakeLockLike = { release(): Promise<void> };

export class BrowserAudio implements AudioIO {
  onPcm: AudioIO['onPcm'] = null;
  onLevel: AudioIO['onLevel'] = null;
  onSpeaking: AudioIO['onSpeaking'] = null;
  onRecordingChunk: AudioIO['onRecordingChunk'] = null;

  readonly ctx: AudioContext;
  private out: GainNode;
  private mix: MediaStreamAudioDestinationNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private muted = false;
  private nextTime = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private clip: { rec: MediaRecorder; chunks: Blob[] } | null = null;
  private wake: WakeLockLike | null = null;
  private nextMixTime = 0;
  private closed = false;
  private mic: boolean;
  private record: boolean;
  private input: MediaStream | null = null;

  /** Create from a click handler: the AudioContext is resumed while the gesture is still live (iOS). */
  constructor(opts: BrowserAudioOptions = {}) {
    this.mic = opts.mic ?? true;
    this.record = opts.record ?? true;
    const AC: typeof AudioContext = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    void this.ctx.resume().catch(() => undefined);
    this.out = this.ctx.createGain();
    // Silent output still reaches the destination, so playback timing (and onended) runs.
    const speakers = this.ctx.createGain();
    speakers.gain.value = opts.speakers === false ? 0 : 1;
    this.out.connect(speakers); speakers.connect(this.ctx.destination);
    document.addEventListener('visibilitychange', this.onVisible);
    document.addEventListener('pointerdown', this.unlock, true);
    document.addEventListener('keydown', this.unlock, true);
  }

  async start(): Promise<void> {
    if (this.record && recorderMime()) {
      this.mix = this.ctx.createMediaStreamDestination();
      this.out.connect(this.mix);
    }
    if (this.mic) {
      await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
      this.node = new AudioWorkletNode(this.ctx, 'mock-capture');
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
      // The worklet only runs while it reaches the destination: route it through a silent gain.
      this.sink = this.ctx.createGain(); this.sink.gain.value = 0;
      this.node.connect(this.sink); this.sink.connect(this.ctx.destination);
      await this.attachMic();
      if (!this.input) navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    }
    if (this.mix) this.startRecorder();
    await this.requestWake();
    await this.ctx.resume().catch(() => undefined);
  }

  /** Capture this stream instead of the mic (a Meet call heard through the Media API). Call before start(). */
  setInput(stream: MediaStream): void { this.input = stream; this.mic = true; }

  private async attachMic(): Promise<void> {
    const stream = this.input ?? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (this.closed) { stream.getTracks().forEach((t) => t.stop()); return; }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    if (this.node) this.source.connect(this.node);
    if (this.mix) this.source.connect(this.mix);
    // A track that ends (earbuds unplugged) is replaced by the new default device.
    stream.getAudioTracks().forEach((t) => { t.onended = () => { if (!this.closed && !this.input) void this.attachMic().catch(() => undefined); }; });
  }

  private onDeviceChange = (): void => { if (!this.closed && this.mic) void this.attachMic().catch(() => undefined); };
  private onVisible = (): void => {
    if (document.visibilityState === 'visible' && !this.closed) { void this.ctx.resume().catch(() => undefined); if (!this.wake) void this.requestWake(); }
  };
  private unlock = (): void => { if (this.ctx.state !== 'running' && !this.closed) void this.ctx.resume().catch(() => undefined); };

  private async requestWake(): Promise<void> {
    try {
      const wl = (navigator as any).wakeLock;
      if (wl && document.visibilityState === 'visible') {
        const lock = await wl.request('screen');
        this.wake = lock;
        lock.addEventListener?.('release', () => { if (this.wake === lock) this.wake = null; });
      }
    } catch { /* not supported or denied */ }
  }

  private onFrame(frame: Float32Array): void {
    if (this.closed) return;
    this.onLevel?.(this.muted ? 0 : Math.min(1, rms(frame) * 4));
    if (this.muted) return;
    const pcm = floatToInt16(resample(frame, this.ctx.sampleRate, INPUT_RATE));
    this.onPcm?.(int16ToBase64(pcm));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  private buffer(base64Pcm: string, rate: number): AudioBuffer | null {
    const bin = atob(base64Pcm);
    const n = bin.length >> 1;
    if (!n) return null;
    const buf = this.ctx.createBuffer(1, n, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); if (v >= 0x8000) v -= 0x10000; ch[i] = v / (v < 0 ? 0x8000 : 0x7fff); }
    return buf;
  }

  /** Other audio for the recording only (a Meet call's participants), queued in order. */
  mixIn(base64Pcm: string, rate: number): void {
    if (this.closed || !this.mix) return;
    const buf = this.buffer(base64Pcm, rate);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.mix);
    const at = Math.max(this.ctx.currentTime + 0.04, this.nextMixTime);
    src.start(at);
    this.nextMixTime = at + buf.duration;
  }

  play(base64Pcm: string, rate: number): void {
    if (this.closed) return;
    const buf = this.buffer(base64Pcm, rate);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const at = Math.max(this.ctx.currentTime + 0.04, this.nextTime);
    src.start(at);
    this.nextTime = at + buf.duration;
    const wasIdle = this.playing.size === 0;
    this.playing.add(src);
    src.onended = () => { this.playing.delete(src); if (!this.playing.size) this.onSpeaking?.(false); };
    if (wasIdle) this.onSpeaking?.(true);
  }

  stopPlayback(): void {
    const had = this.playing.size > 0;
    for (const s of this.playing) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
    this.playing.clear();
    this.nextTime = 0;
    if (had) this.onSpeaking?.(false);
  }

  isSpeaking(): boolean { return this.playing.size > 0; }

  private startRecorder(): void {
    if (!this.mix) return;
    const mimeType = recorderMime();
    this.recorder = new MediaRecorder(this.mix.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data.size) { this.chunks.push(e.data); this.onRecordingChunk?.(e.data); } };
    this.recorder.start(1000);
  }

  async recordingBlob(): Promise<Blob | null> {
    const r = this.recorder;
    if (!r) return this.chunks.length ? new Blob(this.chunks, { type: this.chunks[0].type }) : null;
    this.recorder = null;
    if (r.state !== 'inactive') await new Promise<void>((res) => { r.addEventListener('stop', () => res(), { once: true }); r.stop(); });
    return this.chunks.length ? new Blob(this.chunks, { type: r.mimeType || this.chunks[0].type }) : null;
  }

  beginClip(): void {
    if (!this.mix || this.closed) return;
    if (this.clip && this.clip.rec.state !== 'inactive') this.clip.rec.stop();
    const mimeType = recorderMime();
    const rec = new MediaRecorder(this.mix.stream, mimeType ? { mimeType } : undefined);
    const clip = { rec, chunks: [] as Blob[] };
    rec.ondataavailable = (e) => { if (e.data.size) clip.chunks.push(e.data); };
    rec.start();
    this.clip = clip;
  }

  async endClip(): Promise<Blob | null> {
    const c = this.clip; this.clip = null;
    if (!c) return null;
    if (c.rec.state !== 'inactive') await new Promise<void>((res) => { c.rec.addEventListener('stop', () => res(), { once: true }); c.rec.stop(); });
    return c.chunks.length ? new Blob(c.chunks, { type: c.rec.mimeType || c.chunks[0].type }) : null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPlayback();
    try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* ignore */ }
    try { if (this.clip && this.clip.rec.state !== 'inactive') this.clip.rec.stop(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('pointerdown', this.unlock, true);
    document.removeEventListener('keydown', this.unlock, true);
    void this.wake?.release().catch(() => undefined); this.wake = null;
    void this.ctx.close().catch(() => undefined);
  }
}
