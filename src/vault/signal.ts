// Mock — signaling: how two browsers that know the same vault find each other before WebRTC
// connects them directly. Only rendezvous traffic goes through a relay (offers, answers, pairing
// handshakes), always on a topic derived from the key and, for the vault, encrypted with it.
//
//   NostrSignal   public Nostr relays (the default on GitHub Pages: nothing to host). Ephemeral
//                 events (kind 25050, not stored) tagged with the topic, signed by a throwaway key.
//   WsSignal      a Mock server's /signal WebSocket (self-hosted, behind its sign-in), or any
//                 y-webrtc-style pub/sub relay: subscribe / publish / ping.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type SignalState = 'connecting' | 'open' | 'closed';
export interface Signal {
  /** Receive every message published on `topic` by others. Returns unsubscribe. */
  join(topic: string, on: (data: string) => void): () => void;
  publish(topic: string, data: string): void;
  close(): void;
  readonly state: SignalState;
  onState?: (s: SignalState) => void;
}

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social', 'wss://relay.primal.net'];
export const NOSTR_KIND = 25050;

/** A WebSocket that reconnects with backoff and replays `hello()` on every (re)open. */
class Socket {
  ws: WebSocket | null = null;
  open = false;
  private closed = false;
  private tries = 0;
  private queue: string[] = [];
  private url: string;
  private hello: () => string[];
  private onMessage: (data: string) => void;
  private onOpen: (open: boolean) => void;
  constructor(url: string, hello: () => string[], onMessage: (data: string) => void, onOpen: (open: boolean) => void) {
    this.url = url; this.hello = hello; this.onMessage = onMessage; this.onOpen = onOpen;
    this.connect();
  }
  private connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true; this.tries = 0; this.onOpen(true);
      for (const m of this.hello()) ws.send(m);
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => { if (typeof e.data === 'string') this.onMessage(e.data); };
    ws.onclose = () => { if (this.ws !== ws) return; this.open = false; this.onOpen(false); this.retry(); };
    ws.onerror = () => { try { ws.close(); } catch { /* closing */ } };
  }
  private retry(): void {
    if (this.closed) return;
    const wait = Math.min(30_000, 1000 * 2 ** this.tries++) * (0.75 + Math.random() / 2);
    setTimeout(() => this.connect(), wait);
  }
  send(m: string): void {
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(m);
    else if (this.queue.length < 50) this.queue.push(m);
  }
  close(): void { this.closed = true; this.open = false; try { this.ws?.close(); } catch { /* closing */ } }
}

abstract class Base implements Signal {
  protected handlers = new Map<string, Set<(d: string) => void>>();
  state: SignalState = 'connecting';
  onState?: (s: SignalState) => void;
  protected setState(s: SignalState): void { if (s !== this.state) { this.state = s; this.onState?.(s); } }
  protected deliver(topic: string, data: string): void { for (const h of this.handlers.get(topic) ?? []) h(data); }
  join(topic: string, on: (d: string) => void): () => void {
    const first = !this.handlers.has(topic);
    if (first) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(on);
    if (first) this.subscribed(topic);
    return () => {
      const s = this.handlers.get(topic);
      s?.delete(on);
      if (s && !s.size) { this.handlers.delete(topic); this.unsubscribed(topic); }
    };
  }
  protected abstract subscribed(topic: string): void;
  protected abstract unsubscribed(topic: string): void;
  abstract publish(topic: string, data: string): void;
  abstract close(): void;
}

/** y-webrtc-style pub/sub over one WebSocket (the Mock server's /signal). */
export class WsSignal extends Base {
  private sock: Socket;
  private ping: ReturnType<typeof setInterval>;
  constructor(url: string) {
    super();
    this.sock = new Socket(url, () => (this.handlers.size ? [JSON.stringify({ type: 'subscribe', topics: [...this.handlers.keys()] })] : []), (raw) => {
      let m: { type?: string; topic?: string; data?: unknown };
      try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'publish' && typeof m.topic === 'string' && typeof m.data === 'string') this.deliver(m.topic, m.data);
    }, (open) => this.setState(open ? 'open' : 'connecting'));
    this.ping = setInterval(() => this.sock.send(JSON.stringify({ type: 'ping' })), 25_000);
  }
  protected subscribed(topic: string): void { this.sock.send(JSON.stringify({ type: 'subscribe', topics: [topic] })); }
  protected unsubscribed(topic: string): void { this.sock.send(JSON.stringify({ type: 'unsubscribe', topics: [topic] })); }
  publish(topic: string, data: string): void { this.sock.send(JSON.stringify({ type: 'publish', topic, data })); }
  close(): void { clearInterval(this.ping); this.sock.close(); this.setState('closed'); }
}

// ------------------------------------------------------------------ Nostr

export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

/** NIP-01: id = sha256 of the canonical serialization, signed with BIP-340 Schnorr. */
export function signEvent(secret: Uint8Array, kind: number, tags: string[][], content: string, at = Math.floor(Date.now() / 1000)): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secret));
  const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, pubkey, at, kind, tags, content]))));
  const sig = bytesToHex(schnorr.sign(hexBytes(id), secret));
  return { id, pubkey, created_at: at, kind, tags, content, sig };
}
export function verifyEvent(e: NostrEvent): boolean {
  try {
    const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
    return id === e.id && schnorr.verify(hexBytes(e.sig), hexBytes(e.id), hexBytes(e.pubkey));
  } catch { return false; }
}
const hexBytes = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

/** Publishes to every relay, listens on every relay, drops duplicates and its own events. */
export class NostrSignal extends Base {
  private socks: Socket[];
  private secret = schnorr.utils.randomSecretKey();
  private pub = bytesToHex(schnorr.getPublicKey(this.secret));
  private seen = new Set<string>();
  private subs = new Map<string, string>();
  constructor(relays: string[] = DEFAULT_RELAYS) {
    super();
    this.socks = relays.map((url) => new Socket(url, () => [...this.subs.entries()].map(([topic, id]) => this.req(id, topic)), (raw) => this.onRelay(raw), () => {
      this.setState(this.socks?.some((s) => s.open) ? 'open' : 'connecting');
    }));
  }
  private req(id: string, topic: string): string {
    return JSON.stringify(['REQ', id, { kinds: [NOSTR_KIND], '#t': [topic], since: Math.floor(Date.now() / 1000) - 30 }]);
  }
  private onRelay(raw: string): void {
    let m: unknown[];
    try { m = JSON.parse(raw); } catch { return; }
    if (m[0] !== 'EVENT' || !m[2]) return;
    const e = m[2] as NostrEvent;
    if (e.pubkey === this.pub || this.seen.has(e.id)) return;
    if (this.seen.size > 5000) this.seen.clear();
    this.seen.add(e.id);
    if (e.kind !== NOSTR_KIND || !verifyEvent(e)) return;
    const topic = e.tags.find((t) => t[0] === 't')?.[1];
    if (topic && this.handlers.has(topic)) this.deliver(topic, e.content);
  }
  protected subscribed(topic: string): void {
    const id = 'mock-' + topic.slice(0, 12) + '-' + Math.random().toString(36).slice(2, 8);
    this.subs.set(topic, id);
    for (const s of this.socks) s.send(this.req(id, topic));
  }
  protected unsubscribed(topic: string): void {
    const id = this.subs.get(topic);
    this.subs.delete(topic);
    if (id) for (const s of this.socks) s.send(JSON.stringify(['CLOSE', id]));
  }
  publish(topic: string, data: string): void {
    const e = signEvent(this.secret, NOSTR_KIND, [['t', topic]], data);
    for (const s of this.socks) s.send(JSON.stringify(['EVENT', e]));
  }
  close(): void { for (const s of this.socks) s.close(); this.setState('closed'); }
}

/** In-memory relay for tests: every Signal from one hub hears the others. */
export class MemoryHub {
  private members = new Set<MemorySignal>();
  signal(): MemorySignal { const s = new MemorySignal(this); this.members.add(s); return s; }
  publish(from: MemorySignal, topic: string, data: string): void { for (const m of this.members) if (m !== from) m.receive(topic, data); }
  leave(s: MemorySignal): void { this.members.delete(s); }
}
export class MemorySignal extends Base {
  private hub: MemoryHub;
  constructor(hub: MemoryHub) { super(); this.hub = hub; this.state = 'open'; }
  receive(topic: string, data: string): void { queueMicrotask(() => this.deliver(topic, data)); }
  protected subscribed(): void { /* the hub delivers by topic */ }
  protected unsubscribed(): void { /* nothing to undo */ }
  publish(topic: string, data: string): void { this.hub.publish(this, topic, data); }
  close(): void { this.hub.leave(this); this.setState('closed'); }
}
