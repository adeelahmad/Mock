// Mock server — persistence. Three small tables:
//
//   config     key → JSON value: the setup (OAuth clients, allowed emails, admin), the Auth.js secret
//   users      one row per signed-in account (provider + account id), last seen
//   libraries  one document per user: the MockBackup the browsers sync, with a revision number
//
// SQLite (node:sqlite, a file under ./data by default) or Postgres when DATABASE_URL is set.
// Writes to a library are compare-and-swap on `rev`, so two browsers never overwrite each other
// blindly: the loser gets the current document back and merges.

export interface UserRow { id: string; provider: string; email: string | null; name: string | null; image: string | null; createdAt: string; lastSeenAt: string }
export interface LibraryRow { rev: number; doc: unknown; updatedAt: string }
export type PutResult = { ok: true; rev: number; updatedAt: string } | { ok: false; current: LibraryRow | null };

export interface Store {
  kind: 'sqlite' | 'postgres';
  getConfig<T = unknown>(key: string): Promise<T | null>;
  setConfig(key: string, value: unknown): Promise<void>;
  upsertUser(u: Omit<UserRow, 'createdAt' | 'lastSeenAt'>): Promise<UserRow>;
  getUser(id: string): Promise<UserRow | null>;
  countUsers(): Promise<number>;
  getLibrary(userId: string): Promise<LibraryRow | null>;
  /** Writes `doc` when the stored revision is still `baseRev` (0 = none yet). */
  putLibrary(userId: string, baseRev: number, doc: unknown): Promise<PutResult>;
  deleteLibrary(userId: string): Promise<void>;
  close(): Promise<void>;
}

const now = (): string => new Date().toISOString();

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT, name TEXT, image TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS libraries (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL)',
];

type Row = Record<string, unknown>;
const toUser = (r: Row): UserRow => ({ id: String(r.id), provider: String(r.provider), email: (r.email as string) ?? null, name: (r.name as string) ?? null, image: (r.image as string) ?? null, createdAt: String(r.created_at), lastSeenAt: String(r.last_seen_at) });
const toLibrary = (r: Row): LibraryRow => ({ rev: Number(r.rev), doc: JSON.parse(String(r.doc)), updatedAt: String(r.updated_at) });

/** A file-backed (or `:memory:`) SQLite store. */
export async function openSqlite(path: string): Promise<Store> {
  if (path !== ':memory:') {
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(path), { recursive: true });
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  for (const s of SCHEMA) db.exec(s);
  const one = (sql: string, ...a: (string | number | null)[]): Row | undefined => db.prepare(sql).get(...a) as Row | undefined;
  const run = (sql: string, ...a: (string | number | null)[]) => db.prepare(sql).run(...a);
  return {
    kind: 'sqlite',
    async getConfig<T>(key: string) { const r = one('SELECT value FROM config WHERE key = ?', key); return r ? (JSON.parse(String(r.value)) as T) : null; },
    async setConfig(key, value) { run('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value)); },
    async upsertUser(u) {
      const t = now();
      run('INSERT INTO users (id, provider, email, name, image, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, image = excluded.image, last_seen_at = excluded.last_seen_at', u.id, u.provider, u.email, u.name, u.image, t, t);
      return toUser(one('SELECT * FROM users WHERE id = ?', u.id)!);
    },
    async getUser(id) { const r = one('SELECT * FROM users WHERE id = ?', id); return r ? toUser(r) : null; },
    async countUsers() { return Number(one('SELECT COUNT(*) AS n FROM users')!.n); },
    async getLibrary(userId) { const r = one('SELECT * FROM libraries WHERE user_id = ?', userId); return r ? toLibrary(r) : null; },
    async putLibrary(userId, baseRev, doc) {
      const t = now();
      const body = JSON.stringify(doc);
      // node:sqlite is synchronous, so the check and the write cannot interleave with another request.
      const cur = one('SELECT rev FROM libraries WHERE user_id = ?', userId);
      const curRev = cur ? Number(cur.rev) : 0;
      if (curRev !== baseRev) return { ok: false, current: cur ? toLibrary(one('SELECT * FROM libraries WHERE user_id = ?', userId)!) : null };
      if (cur) run('UPDATE libraries SET rev = ?, doc = ?, updated_at = ? WHERE user_id = ?', curRev + 1, body, t, userId);
      else run('INSERT INTO libraries (user_id, rev, doc, updated_at) VALUES (?, 1, ?, ?)', userId, body, t);
      return { ok: true, rev: curRev + 1, updatedAt: t };
    },
    async deleteLibrary(userId) { run('DELETE FROM libraries WHERE user_id = ?', userId); },
    async close() { db.close(); },
  };
}

/** Postgres via `pg` (DATABASE_URL=postgres://…). */
export async function openPostgres(url: string): Promise<Store> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  for (const s of SCHEMA) await pool.query(s.replace('rev INTEGER', 'rev BIGINT'));
  const one = async (sql: string, a: unknown[] = []): Promise<Row | undefined> => (await pool.query(sql, a)).rows[0] as Row | undefined;
  return {
    kind: 'postgres',
    async getConfig<T>(key: string) { const r = await one('SELECT value FROM config WHERE key = $1', [key]); return r ? (JSON.parse(String(r.value)) as T) : null; },
    async setConfig(key, value) { await pool.query('INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]); },
    async upsertUser(u) {
      const t = now();
      const r = await one('INSERT INTO users (id, provider, email, name, image, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, image = EXCLUDED.image, last_seen_at = EXCLUDED.last_seen_at RETURNING *', [u.id, u.provider, u.email, u.name, u.image, t]);
      return toUser(r!);
    },
    async getUser(id) { const r = await one('SELECT * FROM users WHERE id = $1', [id]); return r ? toUser(r) : null; },
    async countUsers() { return Number((await one('SELECT COUNT(*) AS n FROM users'))!.n); },
    async getLibrary(userId) { const r = await one('SELECT * FROM libraries WHERE user_id = $1', [userId]); return r ? toLibrary(r) : null; },
    async putLibrary(userId, baseRev, doc) {
      const t = now();
      const body = JSON.stringify(doc);
      // One statement each way, so the revision check is atomic.
      const r = baseRev === 0
        ? await one('INSERT INTO libraries (user_id, rev, doc, updated_at) VALUES ($1, 1, $2, $3) ON CONFLICT (user_id) DO NOTHING RETURNING rev', [userId, body, t])
        : await one('UPDATE libraries SET rev = rev + 1, doc = $2, updated_at = $3 WHERE user_id = $1 AND rev = $4 RETURNING rev', [userId, body, t, baseRev]);
      if (r) return { ok: true, rev: Number(r.rev), updatedAt: t };
      const cur = await one('SELECT * FROM libraries WHERE user_id = $1', [userId]);
      return { ok: false, current: cur ? toLibrary(cur) : null };
    },
    async deleteLibrary(userId) { await pool.query('DELETE FROM libraries WHERE user_id = $1', [userId]); },
    async close() { await pool.end(); },
  };
}

export function openStore(env: { DATABASE_URL?: string; MOCK_DB?: string } = process.env): Promise<Store> {
  return env.DATABASE_URL ? openPostgres(env.DATABASE_URL) : openSqlite(env.MOCK_DB || 'data/mock.db');
}
