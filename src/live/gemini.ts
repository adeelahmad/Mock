// Mock — the real live connection: Gemini Live over a WebSocket (plan §1, M3).
// Mic PCM streams up as realtimeInput; model audio is scheduled for playback; transcripts,
// tool calls, barge-in and turn ends become transport events. The session survives the
// ~10-minute connection limit: compression is always on, every resumption handle is kept,
// and on GoAway or an unexpected close the transport reconnects with the latest handle
// (the controller shows the reconnecting banner meanwhile). Text sent while reconnecting
// is queued and flushed when the new connection is ready.

import { Emitter, type LiveConfig, type LiveTransport, type ToolResponse, type TransportListener } from './transport.ts';
import { audioMessage, liveUrl, parseServerMessage, setupMessage, textMessage, toolResponseMessage, type LiveAuth } from './gemini-protocol.ts';
import { INPUT_MIME, rateOf } from './pcm.ts';
import type { AudioIO } from './audio.ts';

/** The subset of WebSocket the transport uses (tests pass a fake). */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface GeminiTransportOptions {
  /** The key, an ephemeral token, or a function minting one per connection. */
  auth: LiveAuth | (() => Promise<LiveAuth>);
  /** Browser audio; null for a text-only connection (tests). */
  audio: AudioIO | null;
  socket?: (url: string) => SocketLike;
  /** Off for the hello test and voice preview (no mic). */
  transcribeInput?: boolean;
  /** How long to wait for setupComplete. */
  setupTimeoutMs?: number;
  /** Delays between reconnect attempts; their count is the attempt limit. */
  retryDelaysMs?: number[];
}

const OPEN = 1;
/** Close codes that mean the request itself is wrong (bad key, bad model): never retried. */
const FATAL = new Set([1007, 1008]);

export class GeminiLiveTransport implements LiveTransport {
  readonly kind = 'gemini' as const;
  private em = new Emitter();
  private ws: SocketLike | null = null;
  private config: LiveConfig | null = null;
  private handle: string | null = null;
  private ready = false;
  private everReady = false;
  private closing = false;
  private reconnecting = false;
  private queue: string[] = [];
  private chunkIndex = 0;
  private retryDelays: number[];

  constructor(private opts: GeminiTransportOptions) {
    this.retryDelays = opts.retryDelaysMs ?? [250, 1000, 2000, 4000, 8000];
    const a = opts.audio;
    if (a) {
      a.onPcm = (b64) => { if (this.ready && this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(audioMessage(b64, INPUT_MIME))); };
      a.onLevel = (value) => this.em.emit({ type: 'level', value });
      a.onSpeaking = (speaking) => this.em.emit({ type: 'aiSpeaking', speaking });
      a.onRecordingChunk = (blob) => this.em.emit({ type: 'recordingChunk', blob, index: this.chunkIndex++ });
    }
  }

  on(l: TransportListener): () => void { return this.em.on(l); }

  /** The latest resumption handle (valid for about two hours). */
  resumptionHandle(): string | null { return this.handle; }

  async connect(config: LiveConfig): Promise<void> {
    this.config = config;
    this.handle = config.resumptionHandle ?? null;
    this.closing = false;
    if (this.opts.audio) await this.opts.audio.start();
    await this.open();
    this.everReady = true;
    this.em.emit({ type: 'ready' });
  }

  /** One connection: open the socket, send setup, resolve on setupComplete. */
  private async open(): Promise<void> {
    const cfg = this.config!;
    const auth = typeof this.opts.auth === 'function' ? await this.opts.auth() : this.opts.auth;
    const make = this.opts.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const ws = make(liveUrl(auth));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = false;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Gemini did not answer the setup in time')), this.opts.setupTimeoutMs ?? 15000);
      const fail = (err: Error) => { if (settled) return; settled = true; clearTimeout(timer); ws.onclose = null; try { ws.close(); } catch { /* ignore */ } reject(err); };
      ws.onopen = () => ws.send(JSON.stringify(setupMessage({ ...cfg, resumptionHandle: this.handle }, { transcribeInput: this.opts.transcribeInput })));
      ws.onerror = () => { /* onclose follows with the code */ };
      ws.onclose = (e) => fail(new Error(closeMessage(e.code, e.reason)));
      ws.onmessage = (e) => {
        const msg = decode(e.data);
        if (!settled && msg && (msg as { setupComplete?: unknown }).setupComplete !== undefined) {
          settled = true; clearTimeout(timer);
          this.ready = true;
          ws.onclose = (ev) => this.onClose(ws, ev.code, ev.reason);
          resolve();
          this.flush();
          return;
        }
        this.onMessage(msg);
      };
    });
  }

  private onMessage(msg: unknown): void {
    const p = parseServerMessage(msg);
    if (this.opts.audio) for (const a of p.audio) this.opts.audio.play(a.data, rateOf(a.mimeType));
    for (const e of p.events) {
      if (e.type === 'interrupted') this.opts.audio?.stopPlayback();
      if (e.type === 'resumption' && e.resumable && e.handle) this.handle = e.handle;
      this.em.emit(e);
      if (e.type === 'goAway') void this.reconnect('goAway');
    }
  }

  private onClose(ws: SocketLike, code: number, reason: string): void {
    if (ws !== this.ws) return;
    this.ready = false;
    if (this.closing) return;
    this.em.emit({ type: 'closed', code, reason: reason || closeMessage(code, reason) });
    if (FATAL.has(code)) { this.em.emit({ type: 'error', message: closeMessage(code, reason) }); return; }
    void this.reconnect('closed');
  }

  private async reconnect(why: string): Promise<void> {
    if (this.reconnecting || this.closing || !this.config) return;
    this.reconnecting = true;
    const old = this.ws;
    this.ready = false;
    // Audio already received keeps playing; the new connection resumes the conversation.
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(1000, why); } catch { /* ignore */ } }
    let lastErr: Error | null = null;
    for (const delay of this.retryDelays) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.closing) { this.reconnecting = false; return; }
      try {
        await this.open();
        this.reconnecting = false;
        this.em.emit({ type: 'ready' });
        return;
      } catch (err) { lastErr = err as Error; }
    }
    this.reconnecting = false;
    this.em.emit({ type: 'error', message: 'Lost the connection to Gemini' + (lastErr ? ': ' + lastErr.message : '') });
    this.em.emit({ type: 'closed', code: 1006, reason: 'gave up reconnecting' });
  }

  private send(json: string): void {
    if (this.ready && this.ws?.readyState === OPEN) this.ws.send(json);
    else this.queue.push(json);
  }
  private flush(): void {
    const q = this.queue; this.queue = [];
    for (const j of q) this.ws?.send(j);
  }

  sendText(text: string): void { if (!this.closing) this.send(JSON.stringify(textMessage(text))); }
  sendToolResponse(responses: ToolResponse[]): void { if (!this.closing && responses.length) this.send(JSON.stringify(toolResponseMessage(responses))); }
  setMuted(muted: boolean): void { this.opts.audio?.setMuted(muted); }
  stopPlayback(): void { this.opts.audio?.stopPlayback(); }
  isSpeaking(): boolean { return this.opts.audio?.isSpeaking() ?? false; }
  async recordingBlob(): Promise<Blob | null> { return this.opts.audio ? this.opts.audio.recordingBlob() : null; }
  beginClip(): void { this.opts.audio?.beginClip(); }
  async endClip(): Promise<Blob | null> { return this.opts.audio ? this.opts.audio.endClip() : null; }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.ready = false;
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onmessage = null; ws.onclose = null; try { ws.close(1000, 'session ended'); } catch { /* ignore */ } }
    this.opts.audio?.close();
    if (this.everReady) this.em.emit({ type: 'closed', code: 1000, reason: 'closed' });
  }
}

function decode(data: unknown): unknown {
  try {
    if (typeof data === 'string') return JSON.parse(data);
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
    if (ArrayBuffer.isView(data)) return JSON.parse(new TextDecoder().decode(data as ArrayBufferView));
  } catch { /* not JSON */ }
  return null;
}

export function closeMessage(code: number, reason: string): string {
  if (code === 1008 || /api key|permission|unauth/i.test(reason)) return 'Gemini refused the key' + (reason ? ' — ' + reason : '');
  if (code === 1007) return 'Gemini rejected the setup' + (reason ? ' — ' + reason : '');
  return reason || 'Connection closed (' + code + ')';
}
