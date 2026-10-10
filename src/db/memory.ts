// Mock — in-memory repository. Used by M1 (sample data), by tests, and as the fallback when
// DuckDB-Wasm cannot start. Keeps everything in plain arrays; `mode()` reports 'memory' so the
// Library badge can say so, as the design shows.

import type { Analysis, Exchange, Lp, LpRole, PrepFile, Question, Report, Session, Settings, Story, TranscriptEvent } from '../domain/types.ts';
import * as SAMPLE from '../fixtures/sample.ts';
import type { QuestionFilter, Repo, RepoMode } from './repo.ts';
import type { MockBackup } from './backup.ts';

export interface MemoryData {
  lps: Lp[]; stories: Story[]; questions: Question[]; files: PrepFile[]; sessions: Session[]; exchanges: Exchange[]; transcript: TranscriptEvent[]; settings: Settings;
}

export function sampleData(): MemoryData {
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return { lps: clone(SAMPLE.LPS), stories: clone(SAMPLE.STORIES), questions: clone(SAMPLE.QUESTIONS), files: clone(SAMPLE.FILES), sessions: clone(SAMPLE.SESSIONS), exchanges: clone(SAMPLE.EXCHANGES), transcript: clone(SAMPLE.TRANSCRIPT), settings: clone(SAMPLE.SETTINGS) };
}

export function emptyData(): MemoryData {
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return { lps: clone(SAMPLE.LPS), stories: [], questions: [], files: [], sessions: [], exchanges: [], transcript: [], settings: clone(SAMPLE.EMPTY_SETTINGS) };
}

export class MemoryRepo implements Repo {
  private d: MemoryData;
  private blobs = new Map<string, Blob>();
  private secrets = new Map<string, string>();
  private ready = false;
  /** Called after every write so the app can refresh. */
  public onChange: (() => void) | null = null;

  constructor(data: MemoryData = sampleData()) { this.d = data; }

  async init(onStatus?: (s: string) => void): Promise<RepoMode> { onStatus?.('Loading the sample library…'); this.ready = true; return 'memory'; }
  mode(): RepoMode { return this.ready ? 'memory' : 'none'; }
  private changed(): void { this.onChange?.(); }
  private clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

  async lps(): Promise<Lp[]> { return this.clone(this.d.lps).sort((a, b) => a.order - b.order); }
  async stories(): Promise<Story[]> { return this.clone(this.d.stories); }
  async story(id: string): Promise<Story | null> { const s = this.d.stories.find((x) => x.id === id); return s ? this.clone(s) : null; }
  async questions(f: QuestionFilter = {}): Promise<Question[]> {
    let qs = this.d.questions.slice();
    if (f.lpId) qs = qs.filter((q) => q.lpIds.includes(f.lpId!));
    if (f.source && f.source !== 'all') qs = qs.filter((q) => q.source === f.source);
    if (f.difficulty) qs = qs.filter((q) => q.difficulty === f.difficulty);
    if (f.notAsked) qs = qs.filter((q) => q.timesAsked === 0);
    if (f.lastVerdict && f.lastVerdict !== 'all') qs = qs.filter((q) => q.lastVerdict === f.lastVerdict);
    if (f.untagged) qs = qs.filter((q) => q.lpIds.length === 0);
    if (f.amazon) qs = qs.filter((q) => /amazon|aws/i.test(q.tags));
    if (f.text) { const t = f.text.toLowerCase(); qs = qs.filter((q) => q.text.toLowerCase().includes(t)); }
    return this.clone(qs.sort((a, b) => b.timesAsked - a.timesAsked || a.createdAt.localeCompare(b.createdAt)));
  }
  async files(): Promise<PrepFile[]> { return this.clone(this.d.files).sort((a, b) => a.name.localeCompare(b.name)); }
  async sessions(): Promise<Session[]> { return this.clone(this.d.sessions).sort((a, b) => b.number - a.number); }
  async session(id: string): Promise<Session | null> { const s = this.d.sessions.find((x) => x.id === id); return s ? this.clone(s) : null; }
  async exchanges(sessionId?: string): Promise<Exchange[]> { return this.clone(this.d.exchanges.filter((e) => !sessionId || e.sessionId === sessionId)).sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.index - b.index); }
  async transcript(sessionId: string): Promise<TranscriptEvent[]> { return this.clone(this.d.transcript.filter((t) => t.sessionId === sessionId)).sort((a, b) => a.tMs - b.tMs); }
  async reports(limit = 10): Promise<{ session: Session; report: Report }[]> {
    return this.clone(this.d.sessions.filter((s) => s.report).sort((a, b) => b.number - a.number).slice(0, limit).map((s) => ({ session: s, report: s.report! })));
  }
  async settings(): Promise<Settings> { return this.clone(this.d.settings); }

  async setSettings(patch: Partial<Settings>): Promise<void> { this.d.settings = { ...this.d.settings, ...patch }; this.changed(); }
  async resetLps(): Promise<void> { this.d.lps = this.clone(SAMPLE.LPS); this.changed(); }
  async updateLp(id: string, patch: Partial<Pick<Lp, 'name' | 'description'>>): Promise<void> { const l = this.d.lps.find((x) => x.id === id); if (l) Object.assign(l, patch, { isDefault: false }); this.changed(); }
  async upsertStory(story: Story): Promise<void> { const i = this.d.stories.findIndex((s) => s.id === story.id); if (i >= 0) this.d.stories[i] = this.clone(story); else this.d.stories.push(this.clone(story)); this.changed(); }
  async deleteStory(id: string): Promise<void> { this.d.stories = this.d.stories.filter((s) => s.id !== id); this.changed(); }
  async setStoryLp(storyId: string, lpId: string, role: LpRole | null): Promise<void> {
    const s = this.d.stories.find((x) => x.id === storyId); if (!s) return;
    s.links = s.links.filter((l) => l.lpId !== lpId); if (role) s.links.push({ lpId, role }); s.updatedAt = new Date().toISOString(); this.changed();
  }
  async addQuestions(questions: Question[]): Promise<number> {
    const have = new Set(this.d.questions.map((q) => q.text.trim().toLowerCase()));
    let n = 0;
    for (const q of questions) { const k = q.text.trim().toLowerCase(); if (have.has(k)) continue; have.add(k); this.d.questions.push(this.clone(q)); n++; }
    this.changed(); return n;
  }
  async updateQuestion(id: string, patch: Partial<Question>): Promise<void> { const q = this.d.questions.find((x) => x.id === id); if (q) Object.assign(q, patch); this.changed(); }
  async deleteQuestion(id: string): Promise<void> { this.d.questions = this.d.questions.filter((q) => q.id !== id); this.changed(); }
  async upsertFile(file: PrepFile): Promise<void> { const i = this.d.files.findIndex((f) => f.id === file.id || f.name === file.name); if (i >= 0) this.d.files[i] = this.clone(file); else this.d.files.push(this.clone(file)); this.changed(); }
  async setFileIncluded(id: string, included: boolean): Promise<void> { const f = this.d.files.find((x) => x.id === id); if (f) f.included = included; this.changed(); }
  async deleteFile(id: string): Promise<void> { this.d.files = this.d.files.filter((f) => f.id !== id); this.changed(); }
  async insertSession(session: Session): Promise<void> { this.d.sessions.push(this.clone(session)); this.changed(); }
  async updateSession(id: string, patch: Partial<Session>): Promise<void> { const s = this.d.sessions.find((x) => x.id === id); if (s) Object.assign(s, patch); this.changed(); }
  async deleteSession(id: string): Promise<void> { this.d.sessions = this.d.sessions.filter((s) => s.id !== id); this.d.exchanges = this.d.exchanges.filter((e) => e.sessionId !== id); this.d.transcript = this.d.transcript.filter((t) => t.sessionId !== id); this.changed(); }
  async insertExchange(exchange: Exchange): Promise<void> { this.d.exchanges.push(this.clone(exchange)); this.changed(); }
  async updateExchange(id: string, patch: Partial<Exchange>): Promise<void> { const e = this.d.exchanges.find((x) => x.id === id); if (e) Object.assign(e, patch); this.changed(); }
  async setAnalysis(exchangeId: string, analysis: Analysis): Promise<void> {
    const e = this.d.exchanges.find((x) => x.id === exchangeId); if (!e) return;
    e.analysis = this.clone(analysis); e.verdict = analysis.verdict;
    const q = e.questionId ? this.d.questions.find((x) => x.id === e.questionId) : this.d.questions.find((x) => x.text === e.questionText);
    if (q) { q.lastVerdict = analysis.verdict; }
    this.changed();
  }
  async setBestAttempt(exchangeId: string): Promise<void> {
    const e = this.d.exchanges.find((x) => x.id === exchangeId); if (!e) return;
    for (const x of this.d.exchanges) if (x.questionText === e.questionText) x.isBest = x.id === exchangeId;
    const q = e.questionId ? this.d.questions.find((x) => x.id === e.questionId) : this.d.questions.find((x) => x.text === e.questionText);
    if (q) q.bestExchangeId = exchangeId;
    this.changed();
  }
  async appendTranscript(events: TranscriptEvent[]): Promise<void> { this.d.transcript.push(...this.clone(events)); this.changed(); }
  async nextSessionNumber(): Promise<number> { return this.d.sessions.reduce((m, s) => Math.max(m, s.number), 0) + 1; }
  async reset(): Promise<void> { this.d = emptyData(); this.blobs.clear(); this.changed(); }
  async loadSample(): Promise<void> { this.d = sampleData(); this.changed(); }
  async importBackup(b: MockBackup): Promise<void> {
    const t = b.tables;
    this.d = { lps: this.clone(t.lps.length ? t.lps : SAMPLE.LPS), stories: this.clone(t.stories), questions: this.clone(t.questions), files: this.clone(t.files), sessions: this.clone(t.sessions), exchanges: this.clone(t.exchanges), transcript: this.clone(t.transcript), settings: { ...this.clone(SAMPLE.EMPTY_SETTINGS), ...this.clone(t.settings), onboarded: true } };
    this.changed();
  }

  async putBlob(key: string, blob: Blob): Promise<boolean> { this.blobs.set(key, blob); return true; }
  async getBlob(key: string): Promise<Blob | null> { return this.blobs.get(key) ?? null; }
  async listBlobs(prefix = ''): Promise<string[]> { return Array.from(this.blobs.keys()).filter((k) => k.startsWith(prefix)); }
  async deleteBlob(key: string): Promise<void> { this.blobs.delete(key); }
  async getSecret(key: string): Promise<string | null> { return this.secrets.get(key) ?? null; }
  async setSecret(key: string, value: string | null): Promise<void> { if (value == null) this.secrets.delete(key); else this.secrets.set(key, value); }
}
