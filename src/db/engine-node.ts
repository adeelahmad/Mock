// Mock — the Node engine for unit tests: DuckDB-Wasm's blocking build, same SQL as the browser.
// Never imported by the app.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Engine, Row } from './engine.ts';
import { plainRow, tmpParquet } from './engine.ts';

const require = createRequire(import.meta.url);

export async function createNodeEngine(): Promise<Engine> {
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
  const db = await duckdb.createDuckDB({
    mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
  }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  const conn = db.connect();
  const rows = (t: { toArray(): { toJSON(): Row }[] }): Row[] => t.toArray().map((r) => plainRow(r.toJSON()));
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (!params.length) return rows(conn.query(sql)) as T[];
      const st = conn.prepare(sql);
      try { return rows(st.query(...params)) as T[]; } finally { st.close(); }
    },
    async exec(sql: string): Promise<void> { conn.query(sql); },
    async exportTable(table: string): Promise<Uint8Array> {
      // The Node runtime writes COPY targets to the real file system: use the temp dir, then clean up.
      const f = path.join(os.tmpdir(), tmpParquet(table));
      conn.query(`COPY ${table} TO '${f}' (FORMAT PARQUET)`);
      const buf = db.copyFileToBuffer(f);
      db.dropFile(f);
      fs.rmSync(f, { force: true });
      return buf;
    },
    async importTable(table: string, parquet: Uint8Array): Promise<void> {
      const f = tmpParquet(table);
      db.registerFileBuffer(f, parquet);
      try { conn.query(`INSERT INTO ${table} BY NAME SELECT * FROM read_parquet('${f}')`); } finally { db.dropFile(f); }
    },
    async close(): Promise<void> { conn.close(); },
  };
}
