// Mock — the backup document. M1: one JSON of every table (secrets never). M2 wraps it in a
// zip with Parquet tables, uploads and optional recordings, validates and migrates on restore.

import type { Exchange, Lp, PrepFile, Question, Session, Settings, Story, TranscriptEvent } from '../domain/types.ts';
import type { Repo } from './repo.ts';

export const BACKUP_VERSION = 1 as const;

export interface MockBackup {
  app: 'mock';
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  tables: { lps: Lp[]; stories: Story[]; questions: Question[]; files: PrepFile[]; sessions: Session[]; exchanges: Exchange[]; transcript: TranscriptEvent[]; settings: Settings };
}

const TABLES = ['lps', 'stories', 'questions', 'files', 'sessions', 'exchanges', 'transcript'] as const;

export const isMockBackup = (v: unknown): v is MockBackup => {
  if (!v || typeof v !== 'object') return false;
  const b = v as Partial<MockBackup>;
  if (b.app !== 'mock' || typeof b.version !== 'number' || !b.tables || typeof b.tables !== 'object') return false;
  const t = b.tables as Record<string, unknown>;
  return TABLES.every((k) => Array.isArray(t[k])) && !!t.settings && typeof t.settings === 'object';
};

/** Everything on the device as one document. The Gemini key is a secret and is never included. */
export async function buildBackup(repo: Repo): Promise<MockBackup> {
  const [lps, stories, questions, files, sessions, exchanges, settings] = await Promise.all([repo.lps(), repo.stories(), repo.questions(), repo.files(), repo.sessions(), repo.exchanges(), repo.settings()]);
  const transcript = (await Promise.all(sessions.map((s) => repo.transcript(s.id)))).flat();
  return { app: 'mock', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables: { lps, stories, questions, files, sessions, exchanges, transcript, settings } };
}

/** Replaces everything on the device with the backup. Validate with isMockBackup() first. */
export async function restoreBackup(repo: Repo, b: MockBackup): Promise<void> {
  if (!isMockBackup(b)) throw new Error('Not a Mock backup');
  if (b.version > BACKUP_VERSION) throw new Error('This backup was made by a newer Mock (v' + b.version + ')');
  // M2: migrations for older versions run here, in order.
  await repo.importBackup(b);
}

export const backupFileName = (): string => 'mock-backup-' + new Date().toISOString().slice(0, 10) + '.json';
