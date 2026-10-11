// Mock — library sync with the Mock server. The library on this device stays the source the app
// reads; the server keeps one copy per signed-in user (a MockBackup document with a revision),
// so a second browser signed in as the same user ends up with the same library.
//
//   pull   the server copy moved past the revision this device last saw:
//            nothing changed here  → replace the local library with it
//            changes here too      → merge both (mergeBackups: new items from either side, newer
//                                    edit wins on the same item; spend ledgers merge per bucket)
//                                    and push the merge
//   push   local writes mark the device dirty; 1.5 s after the last one the library is pushed
//          with the revision it was based on. A 409 (another browser pushed first) pulls, merges
//          and pushes again.
//
// Recordings, clips and uploaded originals (blobs) and the Gemini key stay on each device.
// Pure of React and fetch: the API, the local library and the state store are injected, so it
// is unit-tested with fakes.

import { isMockBackup, mergeBackups, migrateBackup, type MockBackup } from '../db/backup.ts';
import type { UsageBucket } from '../domain/types.ts';

export interface RemoteLibrary { rev: number; doc: unknown; updatedAt: string }
export type PushResult = { ok: true; rev: number; updatedAt: string } | { ok: false; current: RemoteLibrary | null };

export interface SyncApi {
  getLibrary(): Promise<RemoteLibrary | null>;
  putLibrary(baseRev: number, doc: MockBackup): Promise<PushResult>;
}

export interface LocalLibrary {
  build(): Promise<MockBackup>;
  /** Replaces the device library with `doc` (must not count as a local change). */
  apply(doc: MockBackup): Promise<void>;
}

/** What this device remembers per user between visits (localStorage). */
export interface SyncMemo { rev: number; dirty: boolean; lastSyncedAt: string | null }
export interface MemoStore { read(userId: string): SyncMemo | null; write(userId: string, m: SyncMemo): void }

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncStatus { phase: SyncPhase; lastSyncedAt: string | null; error: string | null; pending: boolean }

export interface SyncOptions {
  /** True while a live session runs: pulls wait (pushes still go). */
  busy?: () => boolean;
  delayMs?: number;
  now?: () => Date;
}

/** Whether a library holds anything the user made (not just the seeded LPs and question bank). */
export const hasUserData = (b: MockBackup): boolean => {
  const t = b.tables;
  return t.stories.length > 0 || t.sessions.length > 0 || t.files.length > 0 || t.questions.some((q) => q.source !== 'common');
};

/** Spend ledgers from two devices that share history: the larger count per bucket, so nothing is counted twice. */
export function mergeLedgers(a: UsageBucket[] = [], b: UsageBucket[] = []): UsageBucket[] {
  const out = a.map((x) => ({ ...x }));
  for (const y of b) {
    const i = out.findIndex((x) => x.model === y.model && x.lpId === y.lpId);
    if (i < 0) out.push({ ...y });
    else if (y.calls > out[i].calls || (y.calls === out[i].calls && y.input + y.output > out[i].input + out[i].output)) out[i] = { ...y };
  }
  return out;
}

/** Server copy + this device's changes: mergeBackups keeps the server's settings; the spend ledger merges. */
export function mergeLibraries(theirs: MockBackup, mine: MockBackup): MockBackup {
  const m = mergeBackups(theirs, mine);
  return { ...m, tables: { ...m.tables, settings: { ...m.tables.settings, usage: mergeLedgers(theirs.tables.settings.usage, mine.tables.settings.usage) } } };
}

export class SyncEngine {
  private api: SyncApi;
  private local: LocalLibrary;
  private memo: MemoStore;
  private o: SyncOptions;
  private userId: string | null = null;
  private m: SyncMemo = { rev: 0, dirty: false, lastSyncedAt: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();
  private applying = false;
  private listeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = { phase: 'off', lastSyncedAt: null, error: null, pending: false };

  constructor(api: SyncApi, local: LocalLibrary, memo: MemoStore, o: SyncOptions = {}) {
    this.api = api; this.local = local; this.memo = memo; this.o = o;
  }

  subscribe(fn: (s: SyncStatus) => void): () => void { this.listeners.add(fn); fn(this.status); return () => { this.listeners.delete(fn); }; }
  private set(p: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...p, pending: this.m.dirty, lastSyncedAt: this.m.lastSyncedAt };
    for (const l of this.listeners) l(this.status);
  }
  private save(): void { if (this.userId) this.memo.write(this.userId, this.m); }

  /** Signed in as `userId`: load what this device knew and sync now. */
  start(userId: string): Promise<void> {
    if (this.userId !== userId) {
      this.userId = userId;
      this.m = this.memo.read(userId) ?? { rev: 0, dirty: false, lastSyncedAt: null };
    }
    this.set({ phase: 'idle', error: null });
    return this.sync();
  }

  /** Signed out: stop syncing; the device keeps its library. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.userId = null;
    this.set({ phase: 'off', error: null });
  }

  get active(): boolean { return this.userId !== null; }

  /** The device library changed (repo.onChange). Changes made by a pull are ignored. */
  changed(): void {
    if (!this.userId || this.applying) return;
    if (!this.m.dirty) { this.m.dirty = true; this.save(); }
    this.set({});
    if (this.timer) clearTimeout(this.timer);
    // During a live session the spend ledger writes every few seconds: push less often then.
    const delay = this.o.busy?.() ? 15_000 : this.o.delayMs ?? 1500;
    this.timer = setTimeout(() => { this.timer = null; void this.sync(); }, delay);
  }

  /** One round: pull if the server moved, push if this device changed. Rounds queue. */
  sync(): Promise<void> {
    const next = this.running.then(() => this.round());
    this.running = next.catch(() => undefined);
    return next;
  }

  private async round(attempt = 0): Promise<void> {
    if (!this.userId) return;
    const user = this.userId;
    this.set({ phase: 'syncing' });
    try {
      const remote = await this.api.getLibrary();
      if (this.userId !== user) return;
      if (remote && remote.rev !== this.m.rev) {
        if (this.o.busy?.()) { this.set({ phase: 'idle' }); return; }
        if (!isMockBackup(remote.doc)) throw new Error('The server copy is not a Mock library');
        const theirs = migrateBackup(remote.doc);
        const mine = await this.local.build();
        // A fresh device (never synced, nothing made here) simply takes the server copy.
        const mergeMine = this.m.dirty || (this.m.rev === 0 && hasUserData(mine));
        const doc = mergeMine ? mergeLibraries(theirs, mine) : theirs;
        await this.applyLocal(doc);
        this.m = { ...this.m, rev: remote.rev, dirty: mergeMine };
        this.save();
        if (mergeMine) return this.push(doc, attempt);
      } else if (!remote || this.m.dirty) {
        return this.push(await this.local.build(), attempt, remote ? this.m.rev : 0);
      }
      this.done();
    } catch (e) {
      this.fail(e);
    }
  }

  private async push(doc: MockBackup, attempt: number, base = this.m.rev): Promise<void> {
    const r = await this.api.putLibrary(base, doc);
    if (r.ok) {
      this.m = { ...this.m, rev: r.rev, dirty: false };
      this.done();
      return;
    }
    // Another browser pushed first: pull theirs, merge, push again (bounded).
    if (attempt >= 3) throw new Error('The library kept changing on another device; will retry');
    return this.round(attempt + 1);
  }

  private async applyLocal(doc: MockBackup): Promise<void> {
    this.applying = true;
    try { await this.local.apply(doc); } finally { this.applying = false; }
  }

  private done(): void {
    this.m.lastSyncedAt = (this.o.now?.() ?? new Date()).toISOString();
    this.save();
    this.set({ phase: 'idle', error: null });
  }

  private fail(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    this.save();
    this.set({ phase: offline ? 'offline' : 'error', error: offline ? null : msg });
  }
}

const MEMO_KEY = 'mock.sync.v1.';
export const localMemo: MemoStore = {
  read(userId) { try { const raw = localStorage.getItem(MEMO_KEY + userId); return raw ? (JSON.parse(raw) as SyncMemo) : null; } catch { return null; } },
  write(userId, m) { try { localStorage.setItem(MEMO_KEY + userId, JSON.stringify(m)); } catch { /* storage blocked */ } },
};
