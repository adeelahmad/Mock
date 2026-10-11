// Mock — DuckDB schema v1 and its migrations (docs/plan.md §3). Timestamps are ISO strings,
// list-shaped values (analysis, report, interviewer) are JSON text, and there are no key
// constraints: the repository replaces rows by id, which keeps snapshots and restores simple.
//
// Versioning: `SCHEMA_VERSION` is what this build writes. A snapshot or backup from an older
// version is loaded into the tables as they were at that version (`ddlAt(v)`), then the
// migrations after it run in order. Each migration is plain SQL, so the same steps serve
// IndexedDB snapshots and Parquet in backups.

export const SCHEMA_VERSION = 1;

/** Every persisted table, in load order. `meta` carries schema_version. */
export const TABLES = ['meta', 'lp', 'story', 'story_number', 'story_lp', 'question', 'question_lp', 'file', 'session', 'report', 'exchange', 'analysis', 'transcript_event', 'setting'] as const;
export type Table = (typeof TABLES)[number];

const V1: Record<Table, string> = {
  meta: 'key VARCHAR, value VARCHAR',
  lp: 'id VARCHAR, name VARCHAR, short VARCHAR, description VARCHAR, ord INTEGER, is_default BOOLEAN',
  story: 'id VARCHAR, title VARCHAR, summary VARCHAR, situation VARCHAR, task VARCHAR, action VARCHAR, result VARCHAR, learning VARCHAR, created_at VARCHAR, updated_at VARCHAR',
  story_number: 'story_id VARCHAR, label VARCHAR, value VARCHAR, sort INTEGER',
  story_lp: 'story_id VARCHAR, lp_id VARCHAR, role VARCHAR, sort INTEGER',
  question: 'id VARCHAR, text VARCHAR, source VARCHAR, difficulty INTEGER, times_asked INTEGER, last_verdict VARCHAR, best_exchange_id VARCHAR, tags VARCHAR, votes INTEGER, sample VARCHAR, created_at VARCHAR',
  question_lp: 'question_id VARCHAR, lp_id VARCHAR, sort INTEGER',
  file: 'id VARCHAR, name VARCHAR, type VARCHAR, content VARCHAR, included BOOLEAN, size DOUBLE, updated_at VARCHAR, summary VARCHAR',
  session: 'id VARCHAR, number INTEGER, mode VARCHAR, focus VARCHAR, coaching VARCHAR, question_source VARCHAR, story_notes BOOLEAN, seed DOUBLE, started_at VARCHAR, ended_at VARCHAR, recording_key VARCHAR, recording_mime VARCHAR',
  report: 'session_id VARCHAR, json VARCHAR',
  exchange: 'id VARCHAR, session_id VARCHAR, idx INTEGER, question_id VARCHAR, question_text VARCHAR, interviewer VARCHAR, lp_id VARCHAR, story_id VARCHAR, story_title VARCHAR, started_at VARCHAR, ended_at VARCHAR, start_ms DOUBLE, end_ms DOUBLE, clip_key VARCHAR, verdict VARCHAR, is_best BOOLEAN',
  analysis: 'exchange_id VARCHAR, verdict VARCHAR, created_at VARCHAR, json VARCHAR',
  transcript_event: 'id VARCHAR, session_id VARCHAR, exchange_id VARCHAR, t_ms DOUBLE, speaker VARCHAR, text VARCHAR',
  setting: 'key VARCHAR, value VARCHAR',
};

export interface Migration {
  /** The version this migration produces. */
  to: number;
  /** SQL statements, run in order. */
  sql: string[];
}

/** Migrations after v1, ascending. Empty until the schema changes. */
export const MIGRATIONS: Migration[] = [];

/** CREATE statements for the tables as they were at schema version 1. */
export const ddlV1 = (): string[] => TABLES.map((t) => `CREATE TABLE IF NOT EXISTS ${t} (${V1[t]})`);

/** The migrations that take a database from `from` to `to`, in order. */
export function migrationsBetween(from: number, to: number = SCHEMA_VERSION, list: Migration[] = MIGRATIONS): Migration[] {
  if (from > to) throw new Error(`Data from a newer Mock (schema v${from}); this build reads up to v${to}`);
  return list.filter((m) => m.to > from && m.to <= to).sort((a, b) => a.to - b.to);
}

/** Statements that build the tables as they were at version `v`: v1 DDL plus migrations up to v. */
export const ddlAt = (v: number, list: Migration[] = MIGRATIONS): string[] => [...ddlV1(), ...migrationsBetween(1, v, list).flatMap((m) => m.sql)];
