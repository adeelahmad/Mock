// Mock — AudioIO for a session held in a Google Meet call. The Gemini transport, controller,
// analysis and History are unchanged; only the audio endpoints move: the "mic" is the meeting
// (every remote participant, mixed by the bot) and the "speaker" is the bot's microphone in the
// call. A local, silent BrowserAudio schedules the same interviewer audio and mixes the meeting
// audio in, so the recording, clips and the speaking flag work exactly as in the app. With the
// Meet Media API on, the meeting is heard through the app's own Media API connection instead (the
// local engine captures it like a mic) and the bot only speaks; if that connection fails or
// drops, hearing falls back to the bot.

import type { AudioIO } from '../live/audio.ts';
import { INPUT_RATE, base64ToFloat, rms } from '../live/pcm.ts';
import type { MeetBridgeClient } from './bridge-client.ts';

/** The local engine: plays silently (recorded only) and takes the meeting audio into the mix. */
export interface LocalMix extends AudioIO { mixIn(base64Pcm: string, rate: number): void; setInput(stream: MediaStream): void }

/** Where the meeting can be heard besides the bot: a Meet Media API session. */
export interface MediaSource { connect(): Promise<MediaStream>; close(): void; onEnd: ((reason: string) => void) | null }

export class MeetAudio implements AudioIO {
  onPcm: AudioIO['onPcm'] = null;
  onLevel: AudioIO['onLevel'] = null;
  onSpeaking: AudioIO['onSpeaking'] = null;
  onRecordingChunk: AudioIO['onRecordingChunk'] = null;
  private muted = false;
  private closed = false;
  private bridge: MeetBridgeClient;
  private local: LocalMix;
  private media: MediaSource | null;
  private notice: (message: string) => void;
  /** Hearing the call through the Media API (else through the bot). */
  viaMedia = false;

  constructor(bridge: MeetBridgeClient, local: LocalMix, opts: { media?: MediaSource | null; onNotice?: (message: string) => void } = {}) {
    this.bridge = bridge;
    this.local = local;
    this.media = opts.media ?? null;
    this.notice = opts.onNotice ?? (() => undefined);
    local.onSpeaking = (sp) => this.onSpeaking?.(sp);
    local.onRecordingChunk = (b) => this.onRecordingChunk?.(b);
    local.onPcm = null; local.onLevel = null;
  }

  async start(): Promise<void> {
    if (!this.bridge.inCall()) throw new Error('Mock is not in the Meet call yet');
    const media = this.media;
    if (media) {
      try {
        this.local.setInput(await media.connect());
        this.viaMedia = true;
      } catch (err) {
        media.close(); this.media = null;
        this.notice((err as Error).message + ' · hearing the call through the bot');
      }
    }
    await this.local.start();
    if (this.viaMedia && media) {
      this.local.onPcm = (b64) => { if (!this.closed && this.viaMedia) this.onPcm?.(b64); };
      this.local.onLevel = (v) => { if (!this.closed && this.viaMedia) this.onLevel?.(v); };
      media.onEnd = (why) => {
        if (this.closed) return;
        this.viaMedia = false; this.local.setMuted(true);
        this.notice('Meet Media API stopped (' + why + ') · hearing the call through the bot');
        this.bridge.onPcm = (b64) => this.onMeetingAudio(b64);
      };
    } else {
      this.bridge.onPcm = (b64) => this.onMeetingAudio(b64);
    }
  }

  private onMeetingAudio(b64: string): void {
    if (this.closed) return;
    this.local.mixIn(b64, INPUT_RATE);
    this.onLevel?.(this.muted ? 0 : Math.min(1, rms(base64ToFloat(b64)) * 4));
    if (!this.muted) this.onPcm?.(b64);
  }

  setMuted(muted: boolean): void { this.muted = muted; if (this.viaMedia) this.local.setMuted(muted); }
  play(base64Pcm: string, rate: number): void {
    if (this.closed) return;
    this.bridge.play(base64Pcm, rate);
    this.local.play(base64Pcm, rate);
  }
  stopPlayback(): void { this.local.stopPlayback(); this.bridge.flush(); }
  isSpeaking(): boolean { return this.local.isSpeaking(); }
  recordingBlob(): Promise<Blob | null> { return this.local.recordingBlob(); }
  beginClip(): void { this.local.beginClip(); }
  endClip(): Promise<Blob | null> { return this.local.endClip(); }

  /** Ends the session's audio (the goodbye already queued in the call plays out); the bot stays for the next session. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.bridge.onPcm) this.bridge.onPcm = null;
    this.media?.close();
    this.local.close();
  }
}
