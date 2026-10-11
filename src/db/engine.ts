// Mock — the SQL engine the DuckDB repository runs on. Two implementations: the browser one
// (DuckDB-Wasm in a worker, `engine-browser.ts`) and the Node one used by unit tests
// (`engine-node.ts`, the blocking build). The repository never knows which it has.

export type Row = Record<string, unknown>;

export interface Engine {
  /** Runs one statement with positional `?` parameters and returns plain rows. */
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  /** The table as a Parquet file. */
  exportTable(table: string): Promise<Uint8Array>;
  /** Appends a Parquet file's rows to the table (columns matched by name). */
  importTable(table: string, parquet: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Arrow rows → plain objects: BigInt → number, nested values kept. */
export function plainRow(r: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
}

let fileSeq = 0;
/** A unique virtual file name for Parquet buffers inside the engine. */
export const tmpParquet = (table: string): string => `mock_${table}_${Date.now().toString(36)}_${fileSeq++}.parquet`;
