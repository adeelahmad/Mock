// Mock — the browser engine: DuckDB-Wasm in a worker. The `eh` bundle (exception handling,
// every current browser) with `mvp` as the fallback, both self-hosted by Vite and precached
// by the service worker — no CDN, no cross-origin isolation, works offline. Single-threaded.

import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import type { Engine, Row } from './engine.ts';
import { plainRow, tmpParquet } from './engine.ts';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

export async function createBrowserEngine(onProgress?: (pct: number) => void): Promise<Engine> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker, (p) => {
      if (onProgress && p.bytesTotal > 0) onProgress(Math.min(100, Math.round((p.bytesLoaded / p.bytesTotal) * 100)));
    });
  } catch (e) { worker.terminate(); throw e; }
  // No network extension loads: everything Mock needs (Parquet, core functions) is built in.
  await db.open({ query: { castBigIntToDouble: true } }).catch(() => db.open({}));
  const conn = await db.connect();
  const rows = (t: { toArray(): { toJSON(): Row }[] }): Row[] => t.toArray().map((r) => plainRow(r.toJSON()));
  // One statement at a time keeps the connection's order equal to the call order.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };
  return {
    query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      return serial(async () => {
        if (!params.length) return rows(await conn.query(sql)) as T[];
        const st = await conn.prepare(sql);
        try { return rows(await st.query(...params)) as T[]; } finally { await st.close(); }
      });
    },
    exec(sql: string): Promise<void> { return serial(async () => { await conn.query(sql); }); },
    exportTable(table: string): Promise<Uint8Array> {
      return serial(async () => {
        const f = tmpParquet(table);
        await db.registerEmptyFileBuffer(f);
        await conn.query(`COPY ${table} TO '${f}' (FORMAT PARQUET)`);
        const buf = await db.copyFileToBuffer(f);
        await db.dropFile(f);
        return buf;
      });
    },
    importTable(table: string, parquet: Uint8Array): Promise<void> {
      return serial(async () => {
        const f = tmpParquet(table);
        await db.registerFileBuffer(f, parquet);
        try { await conn.query(`INSERT INTO ${table} BY NAME SELECT * FROM read_parquet('${f}')`); } finally { await db.dropFile(f); }
      });
    },
    async close(): Promise<void> { await conn.close(); await db.terminate(); },
  };
}
