// Mock — the library as a CRDT. A Yjs document mirrors the device library so that edits made on
// different devices, in any order, online or not, combine into the same library everywhere:
//
//   t.<table>   one Y.Map per table: row id → the row as JSON (a row is replaced whole)
//   settings    field → JSON value (two devices changing different settings both keep theirs)
//   usage       "<model>|<lp>" → spend bucket (the larger count wins, nothing counted twice)
//   secrets     the Gemini key, when the user chose to sync it (the document only ever leaves
//               the device encrypted)
//
// The device library (DuckDB) stays what the app reads. `VaultBridge` keeps the two in step:
// local writes become the smallest set of row changes since the last state both agreed on, and
// changes from peers rebuild the library from the document.

import * as Y from 'yjs';
import type { MockBackup } from '../db/backup.ts';
import type { Question, Settings, UsageBucket } from '../domain/types.ts';
import { mergeLedgers } from '../sync/engine.ts';

export const TABLES = ['lps', 'stories', 'questions', 'files', 'sessions', 'exchanges', 'transcript'] as const;
export type TableKey = (typeof TABLES)[number];
/** Settings fields that are merged on their own (usage) or are per-device bookkeeping. */
const OWN_FIELDS = new Set<keyof Settings>(['usage', 'lastBackupAt']);

/** Origin of transactions that come from this device's library. */
export const LOCAL = 'local';

/** The library flattened: map name → key → JSON. What the bridge diffs. */
export type Flat = Map<string, Map<string, string>>;

const bucketKey = (b: UsageBucket): string => b.model + '|' + (b.lpId ?? '');
const bigger = (a: UsageBucket, b: UsageBucket): boolean => a.calls > b.calls || (a.calls === b.calls && a.input + a.output > b.input + b.output);

export function flatten(b: MockBackup, secrets: Record<string, string> = {}): Flat {
  const out: Flat = new Map();
  for (const t of TABLES) out.set('t.' + t, new Map((b.tables[t] as { id: string }[]).map((r) => [r.id, JSON.stringify(r)])));
  const s = new Map<string, string>();
  for (const [k, v] of Object.entries(b.tables.settings)) if (!OWN_FIELDS.has(k as keyof Settings) && v !== undefined) s.set(k, JSON.stringify(v));
  out.set('settings', s);
  out.set('usage', new Map((b.tables.settings.usage ?? []).map((u) => [bucketKey(u), JSON.stringify(u)])));
  out.set('secrets', new Map(Object.entries(secrets).filter(([, v]) => !!v)));
  return out;
}

export const MAPS = [...TABLES.map((t) => 't.' + t), 'settings', 'usage', 'secrets'];

/** Writes the difference between two flattened libraries into the document. */
export function writeDiff(doc: Y.Doc, prev: Flat, next: Flat, only: string[] = MAPS, deletes = true): number {
  let n = 0;
  doc.transact(() => {
    for (const name of only) {
      const y = doc.getMap<string>(name);
      const a = prev.get(name) ?? new Map(), b = next.get(name) ?? new Map();
      for (const [k, v] of b) {
        if (a.get(k) === v || y.get(k) === v) continue;
        if (name === 'usage' && y.has(k) && !bigger(JSON.parse(v), JSON.parse(y.get(k)!))) continue;
        y.set(k, v); n++;
      }
      if (deletes) for (const k of a.keys()) if (!b.has(k) && y.has(k)) { y.delete(k); n++; }
    }
  }, LOCAL);
  return n;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Two devices that each seeded the common question bank hold the same questions under different
 * ids. Every device keeps the same one (smallest id), points answers at it and drops the others
 * from the document, so the merge settles everywhere.
 */
function dedupeQuestions(doc: Y.Doc): void {
  const qs = doc.getMap<string>('t.questions');
  const byText = new Map<string, string>();
  const loser = new Map<string, string>();
  for (const id of [...qs.keys()].sort()) {
    const q = JSON.parse(qs.get(id)!) as Question;
    const k = norm(q.text);
    const keep = byText.get(k);
    if (keep) loser.set(id, keep); else byText.set(k, id);
  }
  if (!loser.size) return;
  doc.transact(() => {
    const ex = doc.getMap<string>('t.exchanges');
    for (const [id, raw] of ex) {
      const e = JSON.parse(raw) as { questionId: string | null };
      if (e.questionId && loser.has(e.questionId)) ex.set(id, JSON.stringify({ ...e, questionId: loser.get(e.questionId) }));
    }
    for (const id of loser.keys()) qs.delete(id);
  }, LOCAL);
}

/** The document as a library. `base` fills settings the document does not carry yet. */
export function materialize(doc: Y.Doc, base: MockBackup): { backup: MockBackup; secrets: Record<string, string> } {
  dedupeQuestions(doc);
  const rows = <T,>(t: TableKey): T[] => [...doc.getMap<string>('t.' + t).values()].map((v) => JSON.parse(v) as T);
  const tables = Object.fromEntries(TABLES.map((t) => [t, rows(t)])) as unknown as MockBackup['tables'];
  const settings: Settings = { ...base.tables.settings };
  for (const [k, v] of doc.getMap<string>('settings')) (settings as unknown as Record<string, unknown>)[k] = JSON.parse(v);
  // Buckets this device has not written yet (it joined with default settings) are kept too.
  settings.usage = mergeLedgers([...doc.getMap<string>('usage').values()].map((v) => JSON.parse(v) as UsageBucket), base.tables.settings.usage);
  tables.settings = settings;
  // Stable order: the app sorts for display, but tests and diffs like a fixed one.
  tables.sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const seen = new Set<number>();
  if (tables.sessions.some((s) => (seen.has(s.number) ? true : (seen.add(s.number), false)))) {
    // Two devices numbered sessions independently: renumber by start time.
    tables.sessions = tables.sessions.map((s, i) => ({ ...s, number: i + 1 }));
  }
  return { backup: { ...base, tables }, secrets: Object.fromEntries(doc.getMap<string>('secrets').entries()) };
}

export const isEmpty = (doc: Y.Doc): boolean => MAPS.every((m) => doc.getMap(m).size === 0);
