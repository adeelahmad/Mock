// Mock — DuckDB persistence as IndexedDB snapshots (decision D1). After each write the changed
// tables are exported to Parquet and stored, debounced 250 ms; a full flush runs when the page
// is hidden. On start every stored table is loaded back, at the schema version it was saved
// with, and the migrations after it run.

import type { Kv } from './kv.ts';
import type { Table } from './schema.ts';

export interface SnapshotSet { version: number; tables: Partial<Record<Table, Uint8Array>> }

/** Where snapshots live. `version` is stored next to the tables under one key prefix. */
export class SnapshotStore {
  constructor(private kv: Kv<unknown>, private writeMany?: (entries: [string, unknown][]) => Promise<void>) {}

  async load(): Promise<SnapshotSet | null> {
    const version = await this.kv.get('version');
    if (typeof version !== 'number') return null;
    const tables: SnapshotSet['tables'] = {};
    for (const k of await this.kv.keys('table:')) {
      const v = await this.kv.get(k);
      if (v instanceof Uint8Array) tables[k.slice(6) as Table] = v;
      else if (v instanceof ArrayBuffer) tables[k.slice(6) as Table] = new Uint8Array(v);
    }
    return { version, tables };
  }

  async save(version: number, tables: Partial<Record<Table, Uint8Array>>): Promise<void> {
    const entries: [string, unknown][] = [['version', version], ...Object.entries(tables).map(([t, b]) => ['table:' + t, b] as [string, unknown])];
    if (this.writeMany) { await this.writeMany(entries); return; }
    for (const [k, v] of entries) await this.kv.put(k, v);
  }

  async clear(): Promise<void> { await this.kv.clear(); }
}

/** Debounces table exports: `touch()` marks tables dirty, `flush()` writes them now. */
export class Snapshotter {
  private dirty = new Set<Table>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();
  /** Last error, for the Library badge / Settings line. */
  public lastError: string | null = null;

  constructor(
    private store: SnapshotStore,
    private exportTable: (t: Table) => Promise<Uint8Array>,
    private version: () => number,
    private delayMs = 250,
  ) {}

  touch(...tables: Table[]): void {
    for (const t of tables) this.dirty.add(t);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delayMs);
  }

  /** Writes every dirty table (or the given ones). Calls queue behind each other. */
  flush(all?: readonly Table[]): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const next = this.running.then(async () => {
      const list = all ? [...all] : [...this.dirty];
      for (const t of list) this.dirty.delete(t);
      if (!list.length) return;
      try {
        const out: Partial<Record<Table, Uint8Array>> = {};
        for (const t of list) out[t] = await this.exportTable(t);
        await this.store.save(this.version(), out);
        this.lastError = null;
      } catch (e) {
        for (const t of list) this.dirty.add(t);
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    });
    this.running = next.catch(() => undefined);
    return next;
  }

  pending(): boolean { return this.dirty.size > 0 || this.timer !== null; }
}
