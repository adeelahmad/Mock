// Mock — picks and opens the repository for the running app.
//
//   default            DuckDB-Wasm + IndexedDB snapshots; a fresh install seeds the 16 LPs and
//                      the question bank (plan D3). If DuckDB cannot start, an in-memory library
//                      (badge says so) with the same seed, blobs and secrets still in IndexedDB.
//   ?repo=sample       in-memory sample library (dev, Playwright flows, screenshots)
//   ?repo=memory       in-memory, empty (LPs + bank)
//
// The returned repo is usable at once; `init()` does the loading (the splash shows progress).

import type { Question } from '../domain/types.ts';
import { parseExponentRows } from '../domain/parsers.ts';
import { LPS } from '../fixtures/sample.ts';
import type { Repo, RepoMode } from './repo.ts';
import { newId } from './repo.ts';
import { MemoryRepo, emptyData, sampleData } from './memory.ts';
import { DuckRepo } from './duck.ts';
import { IdbKv, MemoryKv, openIdb, putMany, type Kv } from './kv.ts';
import { SnapshotStore } from './snapshots.ts';

/** The common question bank shipped with the app (public/exponent-bank.json). */
export async function loadBank(base = import.meta.env.BASE_URL ?? '/'): Promise<Question[]> {
  const res = await fetch(base + 'exponent-bank.json');
  if (!res.ok) return [];
  const rows = parseExponentRows(await res.text(), LPS) ?? [];
  const at = new Date().toISOString();
  return rows.map((r) => ({ id: newId('q'), text: r.text, lpIds: r.lpId ? [r.lpId] : [], source: 'common', difficulty: r.difficulty ?? 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: r.tags, votes: r.votes, sample: r.sample, createdAt: at }));
}

export type RepoChoice = 'duckdb' | 'memory' | 'sample';
export const repoChoice = (search = typeof location !== 'undefined' ? location.search : ''): RepoChoice => {
  const v = new URLSearchParams(search).get('repo');
  return v === 'sample' || v === 'memory' ? v : 'duckdb';
};

async function memoryRepo(sample: boolean, blobs?: Kv<Blob>, secrets?: Kv<string>): Promise<Repo> {
  const bank = await loadBank().catch(() => [] as Question[]);
  const data = sample ? sampleData() : emptyData();
  if (!sample) data.questions = bank.map((q) => ({ ...q }));
  return new MemoryRepo(data, blobs, secrets, bank);
}

/** A repo that becomes DuckDB (or the memory fallback) when `init()` runs. */
export function openRepo(choice: RepoChoice = repoChoice()): Repo {
  let inner: Repo | null = null;
  let opened!: () => void;
  const ready = new Promise<void>((res) => { opened = res; });
  const shell = {
    onChange: null as (() => void) | null,
    async init(onStatus?: (s: string) => void): Promise<RepoMode> {
      if (choice !== 'duckdb') {
        inner = await memoryRepo(choice === 'sample');
      } else {
        let idb: IDBDatabase | null = null;
        try { idb = await openIdb(); } catch { idb = null; }
        const blobs: Kv<Blob> = idb ? new IdbKv<Blob>(idb, 'blobs') : new MemoryKv<Blob>();
        const secrets: Kv<string> = idb ? new IdbKv<string>(idb, 'secrets') : new MemoryKv<string>();
        try {
          onStatus?.('Loading the database…');
          const { createBrowserEngine } = await import('./engine-browser.ts');
          const engine = await createBrowserEngine((pct) => onStatus?.('Loading the database… ' + pct + '%'));
          const snapshots = idb ? new SnapshotStore(new IdbKv(idb, 'snapshots'), (e) => putMany(idb!, 'snapshots', e)) : undefined;
          const d = new DuckRepo(engine, { snapshots, blobs, secrets, seedQuestions: () => loadBank() });
          inner = d;
          const flush = () => { void d.flush(); };
          addEventListener('pagehide', flush);
          document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
        } catch (e) {
          console.warn('DuckDB-Wasm could not start; using an in-memory library', e);
          inner = await memoryRepo(false, blobs, secrets);
        }
      }
      inner.onChange = () => shell.onChange?.();
      try { return await inner.init(onStatus); } catch (e) {
        // A snapshot that cannot load must not lock the user out: fall back to memory, keep the snapshot.
        console.error('Opening the library failed', e);
        inner = await memoryRepo(false);
        inner.onChange = () => shell.onChange?.();
        return inner.init(onStatus);
      } finally { opened(); }
    },
    mode(): RepoMode { return inner?.mode() ?? 'none'; },
    flush(): Promise<void> { return inner?.flush() ?? Promise.resolve(); },
  };
  return new Proxy(shell, {
    get(t, k, r) {
      if (k in t) return Reflect.get(t, k, r);
      // Before init finishes, calls wait for it (a screen may read blobs while the splash shows).
      if (!inner) return k === 'exportParquet' || typeof k === 'symbol' || k === 'then' ? undefined : (...a: unknown[]) => ready.then(() => (inner as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string](...a));
      const v = (inner as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(inner) : v;
    },
    has(t, k) { return k in t || (!!inner && k in inner); },
  }) as unknown as Repo;
}
