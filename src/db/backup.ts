// Mock — backups. The canonical document is `MockBackup` (every table as JSON, secrets never),
// carried inside a zip:
//
//   manifest.json          what is inside, counts, schema version, scope
//   data.json              the MockBackup document — what restore reads
//   tables/<t>.parquet     the same tables as Parquet (DuckDB builds), for use in any tool
//   uploads/<key>          uploaded originals
//   recordings/<key>.<ext> session recordings and clips (optional)
//   blobs.json             path → original blob key and type
//
// With a passphrase the whole zip is sealed: "MOCKENC1" · salt(16) · iv(12) · AES-GCM ciphertext,
// key from PBKDF2-SHA-256. Restore validates the manifest and document, migrates older schema
// versions in order, and either replaces everything or merges into the current library.
// A plain M1 JSON backup still restores.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Exchange, Lp, PrepFile, Question, Session, Settings, Story, TranscriptEvent } from '../domain/types.ts';
import type { Repo } from './repo.ts';
import { SCHEMA_VERSION } from './schema.ts';

export const BACKUP_VERSION = SCHEMA_VERSION;

export interface MockBackup {
  app: 'mock';
  version: number;
  exportedAt: string;
  tables: { lps: Lp[]; stories: Story[]; questions: Question[]; files: PrepFile[]; sessions: Session[]; exchanges: Exchange[]; transcript: TranscriptEvent[]; settings: Settings };
}

const TABLE_KEYS = ['lps', 'stories', 'questions', 'files', 'sessions', 'exchanges', 'transcript'] as const;

export const isMockBackup = (v: unknown): v is MockBackup => {
  if (!v || typeof v !== 'object') return false;
  const b = v as Partial<MockBackup>;
  if (b.app !== 'mock' || typeof b.version !== 'number' || !b.tables || typeof b.tables !== 'object') return false;
  const t = b.tables as Record<string, unknown>;
  return TABLE_KEYS.every((k) => Array.isArray(t[k])) && !!t.settings && typeof t.settings === 'object';
};

/** Everything on the device as one document. The Gemini key is a secret and is never included. */
export async function buildBackup(repo: Repo): Promise<MockBackup> {
  const [lps, stories, questions, files, sessions, exchanges, settings] = await Promise.all([repo.lps(), repo.stories(), repo.questions(), repo.files(), repo.sessions(), repo.exchanges(), repo.settings()]);
  const transcript = (await Promise.all(sessions.map((s) => repo.transcript(s.id)))).flat();
  return { app: 'mock', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables: { lps, stories, questions, files, sessions, exchanges, transcript, settings } };
}

// ------------------------------------------------------------------ migrations (document level)

/** Document migrations, keyed by the version they produce. Empty until the schema changes. */
export const BACKUP_MIGRATIONS: Record<number, (b: MockBackup) => MockBackup> = {};

export function migrateBackup(b: MockBackup, to = BACKUP_VERSION, steps = BACKUP_MIGRATIONS): MockBackup {
  if (b.version > to) throw new BackupError('newer', 'This backup was made by a newer Mock (v' + b.version + '). Update Mock, then restore.');
  let out = b;
  for (let v = b.version + 1; v <= to; v++) { const step = steps[v]; if (step) out = step(out); out = { ...out, version: v }; }
  return out;
}

/** Replaces everything on the device with the backup. */
export async function restoreBackup(repo: Repo, b: MockBackup): Promise<void> {
  if (!isMockBackup(b)) throw new BackupError('invalid', 'Not a Mock backup');
  await repo.importBackup(migrateBackup(b));
}

// ------------------------------------------------------------------ merge

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const later = (a: string, b: string): boolean => (b || '') > (a || '');

/** Current library + incoming backup, without losing either side. Pure; tested. */
export function mergeBackups(cur: MockBackup, inc: MockBackup): MockBackup {
  const c = cur.tables, n = inc.tables;
  const lps = [...c.lps, ...n.lps.filter((l) => !c.lps.some((x) => x.id === l.id))];

  const stories = [...c.stories];
  for (const s of n.stories) {
    const i = stories.findIndex((x) => x.id === s.id || norm(x.title) === norm(s.title));
    if (i < 0) stories.push(s); else if (later(stories[i].updatedAt, s.updatedAt)) stories[i] = { ...s, id: stories[i].id };
  }

  const questions = [...c.questions];
  const qIdMap = new Map<string, string>();
  for (const q of n.questions) {
    const i = questions.findIndex((x) => x.id === q.id || norm(x.text) === norm(q.text));
    if (i < 0) { questions.push(q); continue; }
    const x = questions[i];
    qIdMap.set(q.id, x.id);
    questions[i] = {
      ...x, lpIds: x.lpIds.length ? x.lpIds : q.lpIds, timesAsked: Math.max(x.timesAsked, q.timesAsked),
      lastVerdict: q.timesAsked > x.timesAsked ? q.lastVerdict ?? x.lastVerdict : x.lastVerdict ?? q.lastVerdict, bestExchangeId: x.bestExchangeId ?? q.bestExchangeId,
    };
  }

  const files = [...c.files];
  for (const f of n.files) {
    const i = files.findIndex((x) => x.id === f.id || x.name === f.name);
    if (i < 0) files.push(f); else if (later(files[i].updatedAt, f.updatedAt)) files[i] = { ...f, id: files[i].id };
  }

  const known = new Set(c.sessions.map((s) => s.id));
  const added = n.sessions.filter((s) => !known.has(s.id));
  let sessions = [...c.sessions, ...added];
  const numbers = new Set<number>();
  if (sessions.some((s) => (numbers.has(s.number) ? true : (numbers.add(s.number), false)))) {
    // Two devices numbered sessions independently: renumber by start time so History reads in order.
    sessions = sessions.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((s, i) => ({ ...s, number: i + 1 }));
  }
  const addedIds = new Set(added.map((s) => s.id));
  const exchanges = [...c.exchanges, ...n.exchanges.filter((e) => addedIds.has(e.sessionId)).map((e) => (e.questionId && qIdMap.has(e.questionId) ? { ...e, questionId: qIdMap.get(e.questionId)! } : e))];
  const transcript = [...c.transcript, ...n.transcript.filter((t) => addedIds.has(t.sessionId))];
  const settings: Settings = { ...c.settings, lastBackupAt: [c.settings.lastBackupAt, n.settings.lastBackupAt].filter(Boolean).sort().pop() ?? null };

  return { app: 'mock', version: cur.version, exportedAt: cur.exportedAt, tables: { lps, stories, questions, files, sessions, exchanges, transcript, settings } };
}

// ------------------------------------------------------------------ zip + passphrase

export type BackupScope = 'all' | 'library' | 'sessions';
export interface BackupManifest {
  app: 'mock';
  format: 'mock-backup';
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: string;
  scope: BackupScope;
  counts: { stories: number; questions: number; files: number; sessions: number; exchanges: number; recordings: number; uploads: number };
  parquet: boolean;
}
export interface BackupBuildOptions { scope?: BackupScope; recordings?: boolean; passphrase?: string }
export interface BuiltBackup { bytes: Uint8Array; name: string; mime: string; manifest: BackupManifest }
export interface ReadBackup { backup: MockBackup; blobs: { key: string; blob: Blob }[]; manifest: BackupManifest | null; encrypted: boolean }

export class BackupError extends Error {
  constructor(public code: 'invalid' | 'encrypted' | 'passphrase' | 'newer', message: string) { super(message); }
}

const MAGIC = strToU8('MOCKENC1');
const ITERATIONS = 210_000;

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', strToU8(passphrase) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(data: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await keyFrom(passphrase, salt), data as BufferSource));
  const out = new Uint8Array(MAGIC.length + 28 + ct.length);
  out.set(MAGIC, 0); out.set(salt, 8); out.set(iv, 24); out.set(ct, 36);
  return out;
}
export const isSealed = (b: Uint8Array): boolean => b.length > 36 && MAGIC.every((x, i) => b[i] === x);
export async function unseal(b: Uint8Array, passphrase: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(24, 36) as BufferSource }, await keyFrom(passphrase, b.slice(8, 24)), b.slice(36) as BufferSource));
  } catch { throw new BackupError('passphrase', 'That passphrase does not open this backup'); }
}

const safeKey = (k: string): string => k.replace(/[^a-z0-9._-]+/gi, '_');
const extOf = (mime: string): string => (mime.includes('mp4') ? '.m4a' : mime.includes('ogg') ? '.ogg' : mime.includes('wav') ? '.wav' : mime.includes('webm') ? '.webm' : '.bin');
const isRecording = (k: string): boolean => k.startsWith('rec:') || k.startsWith('clip:');

function scoped(b: MockBackup, scope: BackupScope): MockBackup {
  if (scope === 'all') return b;
  const t = b.tables;
  return scope === 'library'
    ? { ...b, tables: { ...t, sessions: [], exchanges: [], transcript: [] } }
    : { ...b, tables: { ...t, stories: [], questions: [], files: [] } };
}

export const backupFileName = (o: BackupBuildOptions = {}, date = new Date()): string =>
  'mock-' + (o.scope && o.scope !== 'all' ? o.scope : 'backup') + '-' + date.toISOString().slice(0, 10) + (o.passphrase ? '.mockbackup' : '.zip');

export async function buildBackupZip(repo: Repo, o: BackupBuildOptions = {}): Promise<BuiltBackup> {
  const scope = o.scope ?? 'all';
  await repo.flush();
  const doc = scoped(await buildBackup(repo), scope);
  const files: Zippable = { 'data.json': strToU8(JSON.stringify(doc)) };
  let parquet = false;
  if (scope === 'all' && repo.exportParquet) {
    for (const [t, buf] of Object.entries(await repo.exportParquet())) files['tables/' + t + '.parquet'] = buf;
    parquet = true;
  }
  let uploads = 0, recordings = 0;
  const index: Record<string, { key: string; type: string }> = {};
  const add = async (dir: string, k: string): Promise<boolean> => {
    const b = await repo.getBlob(k);
    if (!b) return false;
    const path = dir + '/' + safeKey(k) + (dir === 'recordings' ? extOf(b.type) : '');
    files[path] = new Uint8Array(await b.arrayBuffer()); index[path] = { key: k, type: b.type };
    return true;
  };
  if (scope !== 'sessions') for (const k of await repo.listBlobs('upload:')) if (await add('uploads', k)) uploads++;
  if (o.recordings && scope !== 'library') {
    const ids = new Set([...doc.tables.sessions.map((s) => s.id), ...doc.tables.exchanges.map((e) => e.id)]);
    const keys = new Set([...doc.tables.sessions.map((s) => s.recordingKey), ...doc.tables.exchanges.map((e) => e.clipKey)].filter(Boolean) as string[]);
    for (const k of await repo.listBlobs()) {
      if (!isRecording(k) || !(keys.has(k) || ids.has(k.slice(k.indexOf(':') + 1)))) continue;
      if (await add('recordings', k)) recordings++;
    }
  }
  const t = doc.tables;
  const manifest: BackupManifest = {
    app: 'mock', format: 'mock-backup', formatVersion: 1, schemaVersion: doc.version, exportedAt: doc.exportedAt, scope,
    counts: { stories: t.stories.length, questions: t.questions.length, files: t.files.length, sessions: t.sessions.length, exchanges: t.exchanges.length, recordings, uploads }, parquet,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  if (Object.keys(index).length) files['blobs.json'] = strToU8(JSON.stringify(index));
  // Audio and Parquet are already compressed; JSON is not.
  let bytes: Uint8Array = zipSync(files, { level: 6 });
  if (o.passphrase) bytes = await seal(bytes, o.passphrase);
  return { bytes, name: backupFileName({ ...o, scope }), mime: o.passphrase ? 'application/octet-stream' : 'application/zip', manifest };
}

/** Reads a backup file: a zip, a sealed zip (needs the passphrase), or an M1 JSON document. */
export async function readBackupFile(bytes: Uint8Array, passphrase?: string): Promise<ReadBackup> {
  let encrypted = false;
  if (isSealed(bytes)) {
    encrypted = true;
    if (!passphrase) throw new BackupError('encrypted', 'This backup is protected with a passphrase');
    bytes = await unseal(bytes, passphrase);
  }
  if (bytes[0] === 0x7b || bytes[0] === 0x5b || bytes[0] === 0xef) {
    let doc: unknown = null;
    try { doc = JSON.parse(strFromU8(bytes).replace(/^﻿/, '')); } catch { /* fall through */ }
    if (!isMockBackup(doc)) throw new BackupError('invalid', 'Not a Mock backup');
    return { backup: migrateBackup(doc), blobs: [], manifest: null, encrypted };
  }
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new BackupError('invalid', 'Not a Mock backup (not a zip)'); }
  const manifest = entries['manifest.json'] ? (JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest) : null;
  if (!manifest || manifest.app !== 'mock' || manifest.format !== 'mock-backup') throw new BackupError('invalid', 'Not a Mock backup (no manifest)');
  if (!entries['data.json']) throw new BackupError('invalid', 'The backup is missing data.json');
  let doc: unknown;
  try { doc = JSON.parse(strFromU8(entries['data.json'])); } catch { throw new BackupError('invalid', 'data.json is damaged'); }
  if (!isMockBackup(doc)) throw new BackupError('invalid', 'data.json is not a Mock backup');
  const blobs: ReadBackup['blobs'] = [];
  const index = entries['blobs.json'] ? (JSON.parse(strFromU8(entries['blobs.json'])) as Record<string, { key: string; type: string }>) : {};
  for (const [path, meta] of Object.entries(index)) {
    const data = entries[path];
    if (data && typeof meta?.key === 'string') blobs.push({ key: meta.key, blob: new Blob([data as BlobPart], { type: meta.type || '' }) });
  }
  return { backup: migrateBackup(doc), blobs, manifest, encrypted };
}

/** Restores a read backup: 'replace' wipes the library first, 'merge' keeps both sides. */
export async function applyBackup(repo: Repo, r: ReadBackup, how: 'replace' | 'merge'): Promise<void> {
  const doc = how === 'merge' ? mergeBackups(await buildBackup(repo), r.backup) : r.backup;
  await repo.importBackup(doc);
  const have = how === 'merge' ? new Set(await repo.listBlobs()) : new Set<string>();
  for (const b of r.blobs) if (!have.has(b.key)) await repo.putBlob(b.key, b.blob);
  await repo.flush();
}

/** One line for the restore sheet: what is inside. */
export function describeBackup(r: ReadBackup): string {
  const t = r.backup.tables;
  const plural = (n: number, w: string, p = w + 's') => n + ' ' + (n === 1 ? w : p);
  const bits = [plural(t.stories.length, 'story', 'stories'), plural(t.questions.length, 'question'), plural(t.sessions.length, 'session')];
  const recs = r.blobs.filter((b) => isRecording(b.key)).length;
  if (recs) bits.push(plural(recs, 'recording'));
  return bits.join(' · ') + ' · ' + new Date(r.backup.exportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
