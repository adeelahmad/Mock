// Mock — the vault: passphrase sync with no backend. Ties the pieces together:
//
//   keys.ts    passphrase → Argon2id master key → room tag + AES key (the passphrase is never kept)
//   doc.ts     the library as a Yjs CRDT, persisted in IndexedDB, bridged to the device library
//   signal.ts  how devices find each other (public Nostr relays, or a Mock server's /signal)
//   p2p.ts     direct WebRTC data channels that trade CRDT updates, sealed with the vault key
//   pair.ts    a short code / QR code that hands the key to a new device
//
// Pure of React: the device library, its secrets and the "live session running" check are
// injected, so the bridge is unit-tested with MemoryRepo and an in-memory relay.

import * as Y from 'yjs';
import type { MockBackup } from '../db/backup.ts';
import { hasUserData, type LocalLibrary } from '../sync/engine.ts';
import { flatten, isEmpty, LOCAL, MAPS, materialize, TABLES, writeDiff, type Flat } from './doc.ts';
import { fromB64, keysFrom, toB64, type VaultKeys } from './keys.ts';
import { PeerMesh, DEFAULT_ICE, type MeshStatus } from './p2p.ts';
import { DEFAULT_RELAYS, NostrSignal, WsSignal, type Signal, type SignalState } from './signal.ts';

export type Relay = 'auto' | 'nostr' | 'server';
export interface VaultConfig {
  /** auto: this Mock server's /signal when the app is served by one and you are signed in, else Nostr. */
  relay: Relay;
  nostrRelays: string[];
  /** A Mock server for signaling (https://… ; its /signal WebSocket) and the token it issued. */
  serverUrl: string;
  serverToken: string;
  /** Extra ICE servers (TURN) on top of public STUN. */
  turn: RTCIceServer[];
  /** Also sync the Gemini key (encrypted end to end like everything else). */
  syncSecrets: boolean;
}
export const DEFAULT_CONFIG: VaultConfig = { relay: 'auto', nostrRelays: DEFAULT_RELAYS, serverUrl: '', serverToken: '', turn: [], syncSecrets: true };

export interface Saved { master: string; config: VaultConfig }
export interface VaultStatus {
  on: boolean;
  phase: 'off' | 'starting' | 'ready' | 'error';
  id: string | null;
  relay: 'nostr' | 'server' | null;
  signal: SignalState | null;
  peers: number;
  connecting: number;
  lastChangeAt: string | null;
  error: string | null;
}
const OFF: VaultStatus = { on: false, phase: 'off', id: null, relay: null, signal: null, peers: 0, connecting: 0, lastChangeAt: null, error: null };

export interface Secrets { read(): Promise<Record<string, string>>; write(s: Record<string, string>): Promise<void> }
export interface Persist { bind(name: string, doc: Y.Doc): Promise<() => void> }
export interface SavedStore { read(): Saved | null; write(s: Saved | null): void }

export interface VaultDeps {
  local: LocalLibrary;
  secrets?: Secrets;
  busy?: () => boolean;
  persist?: Persist;
  saved?: SavedStore;
  /** Builds the relay connection; tests pass an in-memory one. */
  signal?: (c: VaultConfig, server: ServerHint | null) => { signal: Signal; kind: 'nostr' | 'server' };
  rtc?: typeof RTCPeerConnection;
  /** false: no relay or WebRTC (tests link documents directly). */
  p2p?: boolean;
  delayMs?: number;
}
/** What the app knows about the Mock server serving it (null on a static host). */
export interface ServerHint { signal: 'auth' | 'open' | 'off'; signedIn: boolean }

const wsUrl = (base: string, token: string): string => {
  const u = new URL('signal', base.endsWith('/') ? base : base + '/');
  u.protocol = u.protocol === 'http:' ? 'ws:' : u.protocol === 'https:' ? 'wss:' : u.protocol;
  if (token) u.searchParams.set('token', token);
  return u.toString();
};

export function defaultSignal(c: VaultConfig, server: ServerHint | null): { signal: Signal; kind: 'nostr' | 'server' } {
  const own = server && server.signal !== 'off' && (server.signal === 'open' || server.signedIn);
  if (c.relay === 'server' && c.serverUrl) return { signal: new WsSignal(wsUrl(c.serverUrl, c.serverToken)), kind: 'server' };
  if (c.relay === 'auto' && own) return { signal: new WsSignal(wsUrl(new URL('.', location.href).toString(), '')), kind: 'server' };
  return { signal: new NostrSignal(c.nostrRelays.length ? c.nostrRelays : DEFAULT_RELAYS), kind: 'nostr' };
}

const KEY = 'mock.vault.v1';
export const localSaved: SavedStore = {
  read() { try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Saved) : null; } catch { return null; } },
  write(s) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

export const idbPersist: Persist = {
  async bind(name, doc) {
    const { IndexeddbPersistence } = await import('y-indexeddb');
    const p = new IndexeddbPersistence(name, doc);
    await p.whenSynced;
    return () => { void p.destroy(); };
  },
};

/** The pairing payload: the master key and how this device reaches its peers. */
export const packPairing = (s: Saved): Uint8Array => new TextEncoder().encode(JSON.stringify(s));
export function unpackPairing(b: Uint8Array): Saved {
  const s = JSON.parse(new TextDecoder().decode(b)) as Saved;
  if (typeof s.master !== 'string' || fromB64(s.master).length !== 32) throw new Error('Not a Mock pairing');
  return { master: s.master, config: { ...DEFAULT_CONFIG, ...s.config } };
}

export class Vault {
  private d: VaultDeps;
  private keys: VaultKeys | null = null;
  private config: VaultConfig = DEFAULT_CONFIG;
  doc: Y.Doc | null = null;
  private mesh: PeerMesh | null = null;
  private signal: Signal | null = null;
  private unbind: (() => void) | null = null;
  private last: Flat = new Map();
  private queue: Promise<void> = Promise.resolve();
  private localTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private applying = false;
  private listeners = new Set<(s: VaultStatus) => void>();
  status: VaultStatus = OFF;

  constructor(d: VaultDeps) { this.d = d; }

  subscribe(fn: (s: VaultStatus) => void): () => void { this.listeners.add(fn); fn(this.status); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<VaultStatus>): void { this.status = { ...this.status, ...p }; for (const l of this.listeners) l(this.status); }

  get saved(): Saved | null { return this.d.saved?.read() ?? null; }
  get active(): boolean { return this.doc !== null; }

  /** Turns sync on with a master key (from a passphrase or a pairing) and starts it. */
  async enable(master: Uint8Array, config: VaultConfig = DEFAULT_CONFIG, server: ServerHint | null = null): Promise<void> {
    await this.stop();
    this.d.saved?.write({ master: toB64(master), config });
    await this.start(server);
  }

  /** Starts with what this device saved, if anything. */
  async start(server: ServerHint | null = null): Promise<void> {
    const s = this.saved;
    if (!s || this.doc) return;
    this.config = { ...DEFAULT_CONFIG, ...s.config };
    this.set({ ...OFF, on: true, phase: 'starting' });
    try {
      this.keys = await keysFrom(fromB64(s.master));
      const doc = new Y.Doc();
      this.doc = doc;
      this.unbind = this.d.persist ? await this.d.persist.bind('mock-vault-' + this.keys.id, doc) : null;
      await this.run(() => this.join());
      doc.on('update', this.onDocUpdate);
      if (this.d.p2p === false) { this.set({ phase: 'ready', id: this.keys.id }); return; }
      const { signal, kind } = (this.d.signal ?? defaultSignal)(this.config, server);
      this.signal = signal;
      signal.onState = (st) => this.set({ signal: st });
      this.mesh = new PeerMesh(signal, this.keys, doc, { ice: [...DEFAULT_ICE, ...this.config.turn], rtc: this.d.rtc });
      this.mesh.onStatus = (m: MeshStatus) => this.set({ peers: m.peers, connecting: m.connecting });
      this.mesh.start();
      this.set({ phase: 'ready', id: this.keys.id, relay: kind, signal: signal.state, error: null });
    } catch (e) {
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  async stop(): Promise<void> {
    if (this.localTimer) clearTimeout(this.localTimer);
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.mesh?.stop(); this.mesh = null;
    this.signal?.close(); this.signal = null;
    await this.queue;
    this.doc?.off('update', this.onDocUpdate);
    this.unbind?.(); this.unbind = null;
    this.doc?.destroy(); this.doc = null;
    this.keys = null;
    this.set(OFF);
  }

  /** Turn sync off on this device and forget the key. The library stays. */
  async forget(): Promise<void> { await this.stop(); this.d.saved?.write(null); }

  async updateConfig(patch: Partial<VaultConfig>, server: ServerHint | null = null): Promise<void> {
    const s = this.saved;
    if (!s) return;
    this.d.saved?.write({ ...s, config: { ...DEFAULT_CONFIG, ...s.config, ...patch } });
    if (this.doc) { await this.stop(); await this.start(server); }
  }

  /** The device library changed (repo.onChange). */
  changed(): void {
    if (!this.doc || this.applying) return;
    if (this.localTimer) clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => { this.localTimer = null; void this.run(() => this.flushLocal()); }, this.d.delayMs ?? 400);
  }

  /** Push pending local writes into the document now (before the page goes away). */
  flush(): Promise<void> {
    if (this.localTimer) { clearTimeout(this.localTimer); this.localTimer = null; }
    return this.run(() => this.flushLocal());
  }

  private run(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn);
    this.queue = next.catch((e) => this.set({ error: e instanceof Error ? e.message : String(e) }));
    return next;
  }

  private async snapshot(): Promise<{ lib: MockBackup; flat: Flat }> {
    const lib = await this.d.local.build();
    const secrets = this.config.syncSecrets && this.d.secrets ? await this.d.secrets.read() : {};
    return { lib, flat: flatten(lib, secrets) };
  }

  /** First start on this device (empty document) or a restart (document from IndexedDB). */
  private async join(): Promise<void> {
    const doc = this.doc!;
    const { lib, flat } = await this.snapshot();
    if (isEmpty(doc)) {
      // A device with nothing of its own adds only its rows: its default settings must not
      // overwrite the settings of the devices it is about to meet.
      writeDiff(doc, new Map(), flat, hasUserData(lib) ? MAPS : [...TABLES.map((t) => 't.' + t), 'secrets']);
    } else {
      // Changes made here that never reached the document (the page closed first): add them, but
      // never delete from the document what this device simply has not applied yet.
      const { backup, secrets } = materialize(doc, lib);
      writeDiff(doc, flatten(backup, secrets), flat, MAPS, false);
    }
    await this.applyDoc(lib);
  }

  private async flushLocal(): Promise<void> {
    if (!this.doc) return;
    const { flat } = await this.snapshot();
    writeDiff(this.doc, this.last, flat);
    this.last = flat;
  }

  private onDocUpdate = (_u: Uint8Array, origin: unknown): void => {
    if (origin === LOCAL) return;
    this.set({ lastChangeAt: new Date().toISOString() });
    this.scheduleRemote(this.d.delayMs ?? 300);
  };
  private scheduleRemote(ms: number): void {
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null;
      // A live session writes every few seconds: apply peers' changes after it ends.
      if (this.d.busy?.()) { this.scheduleRemote(5000); return; }
      void this.run(async () => { await this.flushLocal(); await this.applyDoc(); });
    }, ms);
  }

  /** Rebuilds the device library from the document when they differ. */
  private async applyDoc(base?: MockBackup): Promise<void> {
    if (!this.doc) return;
    const cur = base ?? (await this.d.local.build());
    const { backup, secrets } = materialize(this.doc, cur);
    const flat = flatten(backup, this.config.syncSecrets ? secrets : {});
    const now = (await this.snapshot()).flat;
    if (!same(flat, now)) {
      this.applying = true;
      try {
        await this.d.local.apply(backup);
        if (this.config.syncSecrets && this.d.secrets && Object.keys(secrets).length) await this.d.secrets.write(secrets);
      } finally { this.applying = false; }
    }
    this.last = flat;
  }
}

function same(a: Flat, b: Flat): boolean {
  for (const name of MAPS) {
    const x = a.get(name) ?? new Map(), y = b.get(name) ?? new Map();
    if (x.size !== y.size) return false;
    for (const [k, v] of x) if (y.get(k) !== v) return false;
  }
  return true;
}
