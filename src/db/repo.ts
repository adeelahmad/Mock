// Mock — the storage interface the screens and the session controller use. M1 implements it
// in memory (sample data, tests, fallback); `duck.ts` implements it on DuckDB-Wasm with
// IndexedDB snapshots.
// The shapes are the domain types; derived numbers (counts, latest verdicts, heat, trend)
// are computed by `domain/selectors.ts` from these reads, or by SQL in the DuckDB repo.

import type { Analysis, Exchange, Lp, LpRole, PrepFile, Question, Report, Session, Settings, Story, TokenUsage, TranscriptEvent } from '../domain/types.ts';
import type { MockBackup } from './backup.ts';

export interface UsageEntry { model: string; lpId: string | null; usage: TokenUsage }

export type RepoMode = 'memory' | 'duckdb' | 'none';

export interface QuestionFilter {
  lpId?: string | null;
  source?: Question['source'] | 'all';
  difficulty?: 1 | 2 | 3 | null;
  notAsked?: boolean;
  lastVerdict?: Question['lastVerdict'] | 'all';
  untagged?: boolean;
  amazon?: boolean;
  text?: string;
}

export interface Repo {
  init(onStatus?: (status: string) => void): Promise<RepoMode>;
  mode(): RepoMode;
  /** Called after every write so the app can refresh. */
  onChange: (() => void) | null;
  /** Persists pending writes now (no-op in memory). */
  flush(): Promise<void>;
  /** Every table as Parquet, when the repository can (DuckDB); backups include them. */
  exportParquet?(): Promise<Record<string, Uint8Array>>;

  // ---- reads
  lps(): Promise<Lp[]>;
  stories(): Promise<Story[]>;
  story(id: string): Promise<Story | null>;
  questions(filter?: QuestionFilter): Promise<Question[]>;
  files(): Promise<PrepFile[]>;
  sessions(): Promise<Session[]>;
  session(id: string): Promise<Session | null>;
  exchanges(sessionId?: string): Promise<Exchange[]>;
  transcript(sessionId: string): Promise<TranscriptEvent[]>;
  reports(limit?: number): Promise<{ session: Session; report: Report }[]>;
  settings(): Promise<Settings>;

  // ---- writes
  setSettings(patch: Partial<Settings>): Promise<void>;
  /** Adds Gemini token counts to the budget ledger (read-modify-write in one step). */
  addUsage(entries: UsageEntry[]): Promise<void>;
  /** Areas back to the AWS Leadership Principles preset. */
  resetLps(): Promise<void>;
  /** Replace the areas (a custom interview's own list); links to removed ids stay but show nowhere. */
  setLps(lps: Lp[]): Promise<void>;
  updateLp(id: string, patch: Partial<Pick<Lp, 'name' | 'description'>>): Promise<void>;
  upsertStory(story: Story): Promise<void>;
  deleteStory(id: string): Promise<void>;
  setStoryLp(storyId: string, lpId: string, role: LpRole | null): Promise<void>;
  addQuestions(questions: Question[]): Promise<number>;
  updateQuestion(id: string, patch: Partial<Question>): Promise<void>;
  deleteQuestion(id: string): Promise<void>;
  upsertFile(file: PrepFile): Promise<void>;
  setFileIncluded(id: string, included: boolean): Promise<void>;
  deleteFile(id: string): Promise<void>;
  insertSession(session: Session): Promise<void>;
  updateSession(id: string, patch: Partial<Session>): Promise<void>;
  deleteSession(id: string): Promise<void>;
  insertExchange(exchange: Exchange): Promise<void>;
  updateExchange(id: string, patch: Partial<Exchange>): Promise<void>;
  setAnalysis(exchangeId: string, analysis: Analysis): Promise<void>;
  setBestAttempt(exchangeId: string): Promise<void>;
  appendTranscript(events: TranscriptEvent[]): Promise<void>;
  nextSessionNumber(): Promise<number>;
  /** Wipe everything (asks twice in the UI). */
  reset(): Promise<void>;
  /** Dev only: load the sample library. */
  loadSample(): Promise<void>;
  /** Replace every table with the backup's, in one go. Secrets are untouched. */
  importBackup(b: MockBackup): Promise<void>;

  // ---- blobs (recordings, clips, uploads)
  putBlob(key: string, blob: Blob): Promise<boolean>;
  getBlob(key: string): Promise<Blob | null>;
  listBlobs(prefix?: string): Promise<string[]>;
  deleteBlob(key: string): Promise<void>;

  // ---- secrets (never in snapshots or backups)
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string | null): Promise<void>;
}

export const newId = (prefix: string): string => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
