// Mock — the app's side of the Meet bridge: one WebSocket to the local bridge, the pairing
// handshake, the bot's status, meeting audio in, interviewer audio and the camera tile out.

import { BRIDGE_VERSION, parseBridgeMsg, type BotStatus, type ClientMsg, type Tile } from './protocol.ts';
import type { SocketLike } from '../live/gemini.ts';

export interface BridgeState { connected: boolean; status: BotStatus; message: string; meetingUrl: string }
export type BridgeListener = (s: BridgeState) => void;

const OPEN = 1;

export class MeetBridgeClient {
  state: BridgeState = { connected: false, status: 'idle', message: '', meetingUrl: '' };
  /** Meeting audio, base64 16 kHz PCM. */
  onPcm: ((base64: string) => void) | null = null;
  private ws: SocketLike | null = null;
  private listeners = new Set<BridgeListener>();
  private make: (url: string) => SocketLike;

  constructor(socket?: (url: string) => SocketLike) {
    this.make = socket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  }

  subscribe(l: BridgeListener): () => void { this.listeners.add(l); l(this.state); return () => { this.listeners.delete(l); }; }
  private set(patch: Partial<BridgeState>): void { this.state = { ...this.state, ...patch }; for (const l of Array.from(this.listeners)) l(this.state); }

  /** Opens the socket and pairs with the code the bridge printed. Resolves on welcome. */
  connect(url: string, token: string, timeoutMs = 8000): Promise<void> {
    this.close();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: SocketLike;
      try { ws = this.make(url); } catch (err) { reject(new Error('Bad bridge address: ' + (err as Error).message)); return; }
      this.ws = ws;
      const timer = setTimeout(() => fail('The Meet bridge did not answer · is it running?'), timeoutMs);
      const fail = (message: string) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch { /* ignore */ } if (this.ws === ws) this.ws = null; reject(new Error(message)); };
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: token.trim(), version: BRIDGE_VERSION } satisfies ClientMsg));
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = (e) => {
        if (!settled) { fail(e.reason || 'Could not reach the Meet bridge at ' + url); return; }
        if (this.ws !== ws) return;
        this.ws = null;
        this.set({ connected: false, status: this.state.status === 'in_call' || this.state.status === 'waiting' ? 'left' : this.state.status, message: e.reason || 'Bridge disconnected' });
      };
      ws.onmessage = (e) => {
        const m = parseBridgeMsg(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
        if (!m) return;
        if (m.type === 'welcome') {
          if (!settled) { settled = true; clearTimeout(timer); this.set({ connected: true, status: 'idle', message: '' }); resolve(); }
        } else if (m.type === 'status') {
          this.set({ status: m.status, message: m.message ?? '', meetingUrl: m.meetingUrl ?? this.state.meetingUrl });
        } else if (m.type === 'pcm') {
          this.onPcm?.(m.data);
        } else if (m.type === 'error') {
          if (!settled) fail(m.message); else this.set({ message: m.message });
        }
      };
    });
  }

  private send(m: ClientMsg): void { if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(m)); }

  join(meetingUrl: string, botName: string): void { this.set({ status: 'launching', message: '', meetingUrl }); this.send({ type: 'join', meetingUrl, botName }); }
  play(data: string, rate: number): void { this.send({ type: 'play', data, rate }); }
  flush(): void { this.send({ type: 'flush' }); }
  tile(tile: Tile): void { this.send({ type: 'tile', tile }); }
  leave(): void { this.send({ type: 'leave' }); }
  inCall(): boolean { return this.state.connected && this.state.status === 'in_call'; }

  close(): void {
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(1000, 'closed'); } catch { /* ignore */ } }
    if (this.state.connected) this.set({ connected: false, status: 'idle', message: '' });
  }
}
