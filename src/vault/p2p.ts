// Mock — live peer-to-peer sync. Every open device of a vault joins one signaling topic, finds
// the others, and opens a direct WebRTC data channel to each (a small mesh). Over a channel the
// two Yjs documents trade what the other is missing, then stream every new change.
//
//   hello    "I'm here" (broadcast every 30 s and on join; a peer that hears one answers)
//   offer    from the peer with the smaller id, with all its ICE candidates (no trickle)
//   answer   the other peer's reply
//
// Signaling messages are AES-GCM sealed with the vault key, so a relay sees only ciphertext under
// a random-looking topic, and only devices that hold the key can answer an offer. Channel
// messages are sealed too (on top of WebRTC's own DTLS), then cut into 48 KB frames.
//
// No TURN by default: two devices behind strict NATs (some mobile carriers) may not connect
// directly; a TURN server can be added in Settings.

import * as Y from 'yjs';
import { fromB64, open, seal, toB64, type VaultKeys } from './keys.ts';
import type { Signal } from './signal.ts';

export const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

type Wire = { from: string; to?: string; kind: 'hello' | 'offer' | 'answer' | 'bye'; sdp?: string };
const MSG_SV = 0, MSG_UPDATE = 1;
const FRAME = 48 * 1024;

export interface MeshOptions { ice?: RTCIceServer[]; helloMs?: number; connectTimeoutMs?: number; rtc?: typeof RTCPeerConnection }
export interface MeshStatus { peers: number; connecting: number }

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  open: boolean;
  timer: ReturnType<typeof setTimeout>;
  parts: Map<number, Uint8Array[]>;
}

const waitIce = (pc: RTCPeerConnection, ms = 4000): Promise<void> => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
  function check() { if (pc.iceGatheringState === 'complete') done(); }
  pc.addEventListener('icegatheringstatechange', check);
});

export class PeerMesh {
  readonly id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  private peers = new Map<string, Peer>();
  private leave: (() => void) | null = null;
  private hello: ReturnType<typeof setInterval> | null = null;
  private msgId = 0;
  private o: Required<Omit<MeshOptions, 'rtc'>> & { rtc?: typeof RTCPeerConnection };
  private signal: Signal;
  private keys: VaultKeys;
  private doc: Y.Doc;
  onStatus?: (s: MeshStatus) => void;

  constructor(signal: Signal, keys: VaultKeys, doc: Y.Doc, o: MeshOptions = {}) {
    this.signal = signal; this.keys = keys; this.doc = doc;
    this.o = { ice: o.ice ?? DEFAULT_ICE, helloMs: o.helloMs ?? 30_000, connectTimeoutMs: o.connectTimeoutMs ?? 25_000, rtc: o.rtc };
  }

  start(): void {
    if (this.leave) return;
    this.leave = this.signal.join(this.keys.room, (data) => void this.onSignal(data));
    this.doc.on('update', this.onUpdate);
    void this.send({ from: this.id, kind: 'hello' });
    this.hello = setInterval(() => void this.send({ from: this.id, kind: 'hello' }), this.o.helloMs);
  }

  stop(): void {
    if (!this.leave) return;
    void this.send({ from: this.id, kind: 'bye' });
    this.leave(); this.leave = null;
    if (this.hello) clearInterval(this.hello);
    this.doc.off('update', this.onUpdate);
    for (const p of [...this.peers.values()]) this.drop(p);
  }

  status(): MeshStatus {
    const all = [...this.peers.values()];
    return { peers: all.filter((p) => p.open).length, connecting: all.filter((p) => !p.open).length };
  }
  private emit(): void { this.onStatus?.(this.status()); }

  // ---- signaling

  private async send(w: Wire): Promise<void> {
    const sealed = await seal(this.keys.enc, new TextEncoder().encode(JSON.stringify(w)), 'signal:' + this.keys.room);
    this.signal.publish(this.keys.room, toB64(sealed));
  }

  private async onSignal(data: string): Promise<void> {
    let raw: Uint8Array;
    try { raw = fromB64(data); } catch { return; }
    const plain = await open(this.keys.enc, raw, 'signal:' + this.keys.room);
    if (!plain) return; // not this vault
    let w: Wire;
    try { w = JSON.parse(new TextDecoder().decode(plain)); } catch { return; }
    if (!w.from || w.from === this.id || (w.to && w.to !== this.id)) return;
    const known = this.peers.get(w.from);
    if (w.kind === 'hello') {
      if (known) return;
      if (this.id < w.from) await this.offer(w.from);
      else if (!w.to) await this.send({ from: this.id, to: w.from, kind: 'hello' });
    } else if (w.kind === 'offer' && w.sdp) {
      if (known) this.drop(known);
      await this.answer(w.from, w.sdp);
    } else if (w.kind === 'answer' && w.sdp && known && known.pc.signalingState === 'have-local-offer') {
      await known.pc.setRemoteDescription({ type: 'answer', sdp: w.sdp }).catch(() => this.drop(known));
    } else if (w.kind === 'bye' && known) {
      this.drop(known);
    }
  }

  private peer(id: string): Peer {
    const Rtc = this.o.rtc ?? RTCPeerConnection;
    const pc = new Rtc({ iceServers: this.o.ice });
    const p: Peer = { id, pc, dc: null, open: false, parts: new Map(), timer: setTimeout(() => { if (!p.open) this.drop(p); }, this.o.connectTimeoutMs) };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(p); };
    this.peers.set(id, p);
    this.emit();
    return p;
  }

  private async offer(id: string): Promise<void> {
    const p = this.peer(id);
    this.channel(p, p.pc.createDataChannel('mock', { ordered: true }));
    try {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      await waitIce(p.pc);
      if (this.peers.get(id) === p) await this.send({ from: this.id, to: id, kind: 'offer', sdp: p.pc.localDescription!.sdp });
    } catch { this.drop(p); }
  }

  private async answer(id: string, sdp: string): Promise<void> {
    const p = this.peer(id);
    p.pc.ondatachannel = (e) => this.channel(p, e.channel);
    try {
      await p.pc.setRemoteDescription({ type: 'offer', sdp });
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      await waitIce(p.pc);
      if (this.peers.get(id) === p) await this.send({ from: this.id, to: id, kind: 'answer', sdp: p.pc.localDescription!.sdp });
    } catch { this.drop(p); }
  }

  private drop(p: Peer): void {
    clearTimeout(p.timer);
    if (this.peers.get(p.id) === p) this.peers.delete(p.id);
    try { p.dc?.close(); } catch { /* closing */ }
    try { p.pc.close(); } catch { /* closing */ }
    this.emit();
  }

  // ---- data channel

  private channel(p: Peer, dc: RTCDataChannel): void {
    p.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      p.open = true; clearTimeout(p.timer); this.emit();
      void this.post(p, MSG_SV, Y.encodeStateVector(this.doc));
    };
    dc.onclose = () => this.drop(p);
    dc.onmessage = (e) => { if (e.data instanceof ArrayBuffer) void this.onFrame(p, new Uint8Array(e.data)); };
  }

  /** seal(type ‖ body), then frames of [id u32][index u16][count u16][bytes]. */
  private async post(p: Peer, type: number, body: Uint8Array): Promise<void> {
    if (!p.open || p.dc?.readyState !== 'open') return;
    const msg = new Uint8Array(body.length + 1);
    msg[0] = type; msg.set(body, 1);
    const sealed = await seal(this.keys.enc, msg, 'peer:' + this.keys.room);
    const id = this.msgId++ >>> 0, count = Math.max(1, Math.ceil(sealed.length / FRAME));
    for (let i = 0; i < count; i++) {
      const chunk = sealed.subarray(i * FRAME, (i + 1) * FRAME);
      const f = new Uint8Array(8 + chunk.length);
      const v = new DataView(f.buffer);
      v.setUint32(0, id); v.setUint16(4, i); v.setUint16(6, count);
      f.set(chunk, 8);
      try { p.dc!.send(f); } catch { this.drop(p); return; }
    }
  }

  private async onFrame(p: Peer, f: Uint8Array): Promise<void> {
    if (f.length < 8) return;
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const id = v.getUint32(0), i = v.getUint16(4), count = v.getUint16(6);
    let parts = p.parts.get(id);
    if (!parts) { parts = new Array(count); p.parts.set(id, parts); }
    parts[i] = f.slice(8);
    if (parts.filter(Boolean).length < count) return;
    p.parts.delete(id);
    const sealed = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of parts) { sealed.set(x, o); o += x.length; }
    const msg = await open(this.keys.enc, sealed, 'peer:' + this.keys.room);
    if (!msg) return;
    const body = msg.subarray(1);
    if (msg[0] === MSG_SV) void this.post(p, MSG_UPDATE, Y.encodeStateAsUpdate(this.doc, body));
    else if (msg[0] === MSG_UPDATE) Y.applyUpdate(this.doc, body, p.id);
  }

  private onUpdate = (update: Uint8Array, origin: unknown): void => {
    for (const p of this.peers.values()) if (p.open && p.id !== origin) void this.post(p, MSG_UPDATE, update);
  };
}
