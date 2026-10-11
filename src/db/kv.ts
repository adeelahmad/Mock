// Mock — small key/value stores on IndexedDB: `snapshots` (Parquet per table), `blobs`
// (recordings, clips, uploaded originals) and `secrets` (the Gemini key; never in snapshots or
// backups). `MemoryKv` stands in when IndexedDB is unavailable and in unit tests.

export interface Kv<T = unknown> {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

export class MemoryKv<T = unknown> implements Kv<T> {
  private m = new Map<string, T>();
  async get(key: string): Promise<T | null> { return this.m.has(key) ? this.m.get(key)! : null; }
  async put(key: string, value: T): Promise<void> { this.m.set(key, value); }
  async delete(key: string): Promise<void> { this.m.delete(key); }
  async keys(prefix = ''): Promise<string[]> { return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  async clear(): Promise<void> { this.m.clear(); }
}

const DB_NAME = 'mock';
const DB_VERSION = 1;
export const STORES = ['snapshots', 'blobs', 'secrets'] as const;
export type StoreName = (typeof STORES)[number];

const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

let opening: Promise<IDBDatabase> | null = null;
export function openIdb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB is not available')); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB is blocked by another tab'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}

export class IdbKv<T = unknown> implements Kv<T> {
  constructor(private db: IDBDatabase, private store: StoreName) {}
  private tx(mode: IDBTransactionMode): IDBObjectStore { return this.db.transaction(this.store, mode).objectStore(this.store); }
  async get(key: string): Promise<T | null> { const v = await req(this.tx('readonly').get(key)); return v === undefined ? null : (v as T); }
  async put(key: string, value: T): Promise<void> { await req(this.tx('readwrite').put(value, key)); }
  async delete(key: string): Promise<void> { await req(this.tx('readwrite').delete(key)); }
  async keys(prefix = ''): Promise<string[]> {
    const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
    return ((await req(this.tx('readonly').getAllKeys(range))) as IDBValidKey[]).map(String).sort();
  }
  async clear(): Promise<void> { await req(this.tx('readwrite').clear()); }
}

/** Writes several snapshot entries in one transaction, so a snapshot is never half-written. */
export async function putMany(db: IDBDatabase, store: StoreName, entries: [string, unknown][], remove: string[] = []): Promise<void> {
  await new Promise<void>((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const k of remove) s.delete(k);
    for (const [k, v] of entries) s.put(v, k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error ?? new Error('snapshot write aborted'));
  });
}
