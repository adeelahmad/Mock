// Mock — test doubles for the Gemini transport: a scripted WebSocket and silent audio.
// Used by unit tests only; nothing in the app imports this file.

import type { SocketLike } from './gemini.ts';
import type { AudioIO } from './audio.ts';

export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  binaryType = 'blob'; readyState = 0;
  onopen: SocketLike['onopen'] = null; onmessage: SocketLike['onmessage'] = null; onclose: SocketLike['onclose'] = null; onerror: SocketLike['onerror'] = null;
  sent: any[] = [];
  closedWith: number | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code = 1000) { this.closedWith = code; this.readyState = 3; }
  server(msg: unknown) { this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(msg)).buffer }); }
  drop(code: number, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
}

export class FakeAudio implements AudioIO {
  onPcm: AudioIO['onPcm'] = null; onLevel: AudioIO['onLevel'] = null; onSpeaking: AudioIO['onSpeaking'] = null; onRecordingChunk: AudioIO['onRecordingChunk'] = null;
  played: [string, number][] = []; stops = 0; muted = false; started = false; closed = false;
  async start() { this.started = true; }
  setMuted(m: boolean) { this.muted = m; }
  play(b: string, r: number) { this.played.push([b, r]); }
  stopPlayback() { this.stops++; }
  speaking = false;
  isSpeaking() { return this.speaking; }
  async recordingBlob(): Promise<Blob | null> { return new Blob(["rec"]); }
  beginClip() {}
  async endClip(): Promise<Blob | null> { return null; }
  close() { this.closed = true; }
}

