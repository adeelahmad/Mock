// Mock — the DuckDB repository (M2). Same `Repo` interface as the in-memory one; every read is
// SQL over schema v1, every write marks its tables for the next IndexedDB snapshot. Calls run
// one at a time (a read never sees half of a write). Blobs and secrets live in their own
// IndexedDB stores, outside DuckDB and outside snapshots.

import type { Analysis, Exchange, Interviewer, Lp, LpRole, PrepFile, Question, Report, Session, Settings, Story, TranscriptEvent } from '../domain/types.ts';
import { LPS, EMPTY_SETTINGS } from '../fixtures/sample.ts';
import { sampleData as sampleTables } from './memory.ts';
import type { Engine, Row } from './engine.ts';
import type { Kv } from './kv.ts';
import type { QuestionFilter, Repo, RepoMode } from './repo.ts';
import type { MockBackup } from './backup.ts';
import { SCHEMA_VERSION, TABLES, ddlAt, migrationsBetween, type Table } from './schema.ts';
import { SnapshotStore, Snapshotter } from './snapshots.ts';

export interface DuckRepoOptions {
  snapshots?: SnapshotStore;
  blobs: Kv<Blob>;
  secrets: Kv<string>;
  /** The question bank a fresh install starts with (plan D3). */
  seedQuestions?: () => Promise<Question[]>;
  snapshotDelayMs?: number;
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const json = <T,>(v: unknown, fallback: T): T => { if (v == null || v === '') return fallback; try { return JSON.parse(String(v)) as T; } catch { return fallback; } };

type Cols = Record<string, unknown>;

export class DuckRepo implements Repo {
  public onChange: (() => void) | null = null;
  private ready = false;
  private chain: Promise<unknown> = Promise.resolve();
  private snap: Snapshotter | null = null;
  /** True when the database was loaded from a snapshot (not a fresh install). */
  public restoredFromSnapshot = false;

  constructor(private db: Engine, private o: DuckRepoOptions) {
    if (o.snapshots) this.snap = new Snapshotter(o.snapshots, (t) => this.db.exportTable(t), () => SCHEMA_VERSION, o.snapshotDelayMs ?? 250);
  }

  // ---------------------------------------------------------------- plumbing
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.chain.then(fn, fn); this.chain = p.catch(() => undefined); return p; }
  private q<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> { return this.db.query<T>(sql, params); }
  private async run(sql: string, params: unknown[] = []): Promise<void> { await this.db.query(sql, params); }
  private changed(...tables: Table[]): void { this.snap?.touch(...tables); this.onChange?.(); }

  /** Multi-row INSERT in chunks, parameters bound positionally. */
  private async insert(table: Table, rows: Cols[]): Promise<void> {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const per = Math.max(1, Math.floor(900 / cols.length));
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      const ph = '(' + cols.map(() => '?').join(', ') + ')';
      await this.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => ph).join(', ')}`, chunk.flatMap((r) => cols.map((c) => (r[c] === undefined ? null : r[c]))));
    }
  }

  // ---------------------------------------------------------------- lifecycle
  init(onStatus?: (s: string) => void): Promise<RepoMode> {
    return this.serial(async () => {
      const set = this.o.snapshots ? await this.o.snapshots.load().catch(() => null) : null;
      const from = set?.version ?? SCHEMA_VERSION;
      onStatus?.(set ? 'Opening your library…' : 'Setting up your library…');
      for (const s of ddlAt(from)) await this.db.exec(s);
      if (set) {
        for (const t of TABLES) { const b = set.tables[t]; if (b && b.byteLength) await this.db.importTable(t, b); }
        const steps = migrationsBetween(from);
        for (const m of steps) for (const s of m.sql) await this.db.exec(s);
        this.restoredFromSnapshot = true;
        if (steps.length) { await this.writeMeta(); await this.snap?.flush(TABLES); }
      } else {
        await this.writeMeta();
        await this.seedFresh();
        await this.snap?.flush(TABLES);
      }
      this.ready = true;
      return 'duckdb' as const;
    });
  }

  mode(): RepoMode { return this.ready ? 'duckdb' : 'none'; }
  /** Writes pending snapshots now (page hide, before a backup). */
  flush(): Promise<void> { return this.snap ? this.snap.flush() : Promise.resolve(); }
  snapshotError(): string | null { return this.snap?.lastError ?? null; }
  /** Every table as Parquet, for backups. */
  exportParquet(): Promise<Record<string, Uint8Array>> {
    return this.serial(async () => { const out: Record<string, Uint8Array> = {}; for (const t of TABLES) out[t] = await this.db.exportTable(t); return out; });
  }

  private async writeMeta(): Promise<void> {
    await this.run('DELETE FROM meta');
    await this.insert('meta', [{ key: 'schema_version', value: String(SCHEMA_VERSION) }, { key: 'created_by', value: 'mock' }]);
  }

  private async seedFresh(): Promise<void> {
    await this.writeLps(LPS);
    await this.writeSettings(EMPTY_SETTINGS);
    const bank = this.o.seedQuestions ? await this.o.seedQuestions().catch(() => []) : [];
    if (bank.length) await this.addQuestionsRaw(bank);
  }

  // ---------------------------------------------------------------- row ⇄ domain
  private async readLps(): Promise<Lp[]> {
    return (await this.q('SELECT * FROM lp ORDER BY ord, rowid')).map((r) => ({ id: str(r.id), name: str(r.name), short: str(r.short), description: str(r.description), order: num(r.ord), isDefault: !!r.is_default }));
  }
  private async writeLps(lps: Lp[]): Promise<void> {
    await this.run('DELETE FROM lp');
    await this.insert('lp', lps.map((l) => ({ id: l.id, name: l.name, short: l.short, description: l.description, ord: l.order, is_default: l.isDefault })));
  }

  private async readStories(where = '', params: unknown[] = []): Promise<Story[]> {
    const rows = await this.q(`SELECT * FROM story ${where} ORDER BY rowid`, params);
    if (!rows.length) return [];
    const ids = rows.map((r) => str(r.id));
    const inList = ids.map(() => '?').join(', ');
    const nums = await this.q(`SELECT * FROM story_number WHERE story_id IN (${inList}) ORDER BY story_id, sort`, ids);
    const links = await this.q(`SELECT * FROM story_lp WHERE story_id IN (${inList}) ORDER BY story_id, sort`, ids);
    return rows.map((r) => {
      const id = str(r.id);
      return {
        id, title: str(r.title), summary: str(r.summary), situation: str(r.situation), task: str(r.task), action: str(r.action), result: str(r.result), learning: str(r.learning),
        numbers: nums.filter((n) => n.story_id === id).map((n) => ({ label: str(n.label), value: str(n.value) })),
        links: links.filter((l) => l.story_id === id).map((l) => ({ lpId: str(l.lp_id), role: (str(l.role) === 'secondary' ? 'secondary' : 'primary') as LpRole })),
        createdAt: str(r.created_at), updatedAt: str(r.updated_at),
      };
    });
  }
  private async deleteStoryRows(id: string): Promise<void> {
    await this.run('DELETE FROM story WHERE id = ?', [id]);
    await this.run('DELETE FROM story_number WHERE story_id = ?', [id]);
    await this.run('DELETE FROM story_lp WHERE story_id = ?', [id]);
  }
  private async writeStories(list: Story[]): Promise<void> {
    await this.insert('story', list.map((s) => ({ id: s.id, title: s.title, summary: s.summary, situation: s.situation, task: s.task, action: s.action, result: s.result, learning: s.learning, created_at: s.createdAt, updated_at: s.updatedAt })));
    await this.insert('story_number', list.flatMap((s) => s.numbers.map((n, i) => ({ story_id: s.id, label: n.label, value: n.value, sort: i }))));
    await this.insert('story_lp', list.flatMap((s) => s.links.map((l, i) => ({ story_id: s.id, lp_id: l.lpId, role: l.role, sort: i }))));
  }

  private async readQuestions(where = '', params: unknown[] = []): Promise<Question[]> {
    const rows = await this.q(`SELECT * FROM question ${where} ORDER BY times_asked DESC, created_at, rowid`, params);
    if (!rows.length) return [];
    const lps = await this.q('SELECT question_id, lp_id FROM question_lp ORDER BY question_id, sort');
    const byQ = new Map<string, string[]>();
    for (const l of lps) { const k = str(l.question_id); const a = byQ.get(k) ?? []; a.push(str(l.lp_id)); byQ.set(k, a); }
    return rows.map((r) => ({
      id: str(r.id), text: str(r.text), lpIds: byQ.get(str(r.id)) ?? [], source: str(r.source) as Question['source'], difficulty: (num(r.difficulty) || 2) as 1 | 2 | 3,
      timesAsked: num(r.times_asked), lastVerdict: strOrNull(r.last_verdict) as Question['lastVerdict'], bestExchangeId: strOrNull(r.best_exchange_id),
      tags: str(r.tags), votes: num(r.votes), sample: str(r.sample), createdAt: str(r.created_at),
    }));
  }
  private async writeQuestions(list: Question[]): Promise<void> {
    await this.insert('question', list.map((q) => ({ id: q.id, text: q.text, source: q.source, difficulty: q.difficulty, times_asked: q.timesAsked, last_verdict: q.lastVerdict, best_exchange_id: q.bestExchangeId, tags: q.tags, votes: q.votes, sample: q.sample, created_at: q.createdAt })));
    await this.insert('question_lp', list.flatMap((q) => q.lpIds.map((lp, i) => ({ question_id: q.id, lp_id: lp, sort: i }))));
  }
  private async deleteQuestionRows(id: string): Promise<void> {
    await this.run('DELETE FROM question WHERE id = ?', [id]);
    await this.run('DELETE FROM question_lp WHERE question_id = ?', [id]);
  }
  private async addQuestionsRaw(questions: Question[]): Promise<number> {
    const have = new Set((await this.q('SELECT lower(trim(text)) AS k FROM question')).map((r) => str(r.k)));
    const fresh: Question[] = [];
    for (const q of questions) { const k = q.text.trim().toLowerCase(); if (have.has(k)) continue; have.add(k); fresh.push(q); }
    await this.writeQuestions(fresh);
    return fresh.length;
  }

  private fileOf(r: Row): PrepFile {
    return { id: str(r.id), name: str(r.name), type: str(r.type) as PrepFile['type'], content: str(r.content), included: !!r.included, size: num(r.size), updatedAt: str(r.updated_at), summary: strOrNull(r.summary) };
  }
  private async writeFiles(list: PrepFile[]): Promise<void> {
    await this.insert('file', list.map((f) => ({ id: f.id, name: f.name, type: f.type, content: f.content, included: f.included, size: f.size, updated_at: f.updatedAt, summary: f.summary })));
  }

  private async readSessions(where = '', params: unknown[] = []): Promise<Session[]> {
    const rows = await this.q(`SELECT s.*, r.json AS report_json FROM session s LEFT JOIN report r ON r.session_id = s.id ${where} ORDER BY s.number DESC, s.rowid`, params);
    return rows.map((r) => ({
      id: str(r.id), number: num(r.number), mode: str(r.mode) as Session['mode'], focus: strOrNull(r.focus), coaching: str(r.coaching) as Session['coaching'],
      questionSource: str(r.question_source) as Session['questionSource'], storyNotes: !!r.story_notes, seed: num(r.seed), startedAt: str(r.started_at), endedAt: strOrNull(r.ended_at),
      recordingKey: strOrNull(r.recording_key), recordingMime: strOrNull(r.recording_mime), report: json<Report | null>(r.report_json, null),
    }));
  }
  private async writeSessions(list: Session[]): Promise<void> {
    await this.insert('session', list.map((s) => ({ id: s.id, number: s.number, mode: s.mode, focus: s.focus, coaching: s.coaching, question_source: s.questionSource, story_notes: s.storyNotes, seed: s.seed, started_at: s.startedAt, ended_at: s.endedAt, recording_key: s.recordingKey, recording_mime: s.recordingMime })));
    await this.insert('report', list.filter((s) => s.report).map((s) => ({ session_id: s.id, json: JSON.stringify(s.report) })));
  }
  private async deleteSessionRow(id: string): Promise<void> {
    await this.run('DELETE FROM session WHERE id = ?', [id]);
    await this.run('DELETE FROM report WHERE session_id = ?', [id]);
  }

  private async readExchanges(where = '', params: unknown[] = []): Promise<Exchange[]> {
    const rows = await this.q(`SELECT e.*, a.json AS analysis_json FROM exchange e LEFT JOIN analysis a ON a.exchange_id = e.id ${where} ORDER BY e.session_id, e.idx, e.rowid`, params);
    return rows.map((r) => ({
      id: str(r.id), sessionId: str(r.session_id), index: num(r.idx), questionId: strOrNull(r.question_id), questionText: str(r.question_text),
      interviewer: json<Interviewer>(r.interviewer, { n: 0, name: '', role: '', mono: '' }), lpId: strOrNull(r.lp_id), storyId: strOrNull(r.story_id), storyTitle: strOrNull(r.story_title),
      startedAt: str(r.started_at), endedAt: strOrNull(r.ended_at), startMs: num(r.start_ms), endMs: numOrNull(r.end_ms), clipKey: strOrNull(r.clip_key),
      analysis: json<Analysis | null>(r.analysis_json, null), verdict: strOrNull(r.verdict) as Exchange['verdict'], isBest: !!r.is_best,
    }));
  }
  private async writeExchanges(list: Exchange[]): Promise<void> {
    await this.insert('exchange', list.map((e) => ({ id: e.id, session_id: e.sessionId, idx: e.index, question_id: e.questionId, question_text: e.questionText, interviewer: JSON.stringify(e.interviewer), lp_id: e.lpId, story_id: e.storyId, story_title: e.storyTitle, started_at: e.startedAt, ended_at: e.endedAt, start_ms: e.startMs, end_ms: e.endMs, clip_key: e.clipKey, verdict: e.verdict, is_best: e.isBest })));
    await this.insert('analysis', list.filter((e) => e.analysis).map((e) => ({ exchange_id: e.id, verdict: e.analysis!.verdict, created_at: e.analysis!.createdAt, json: JSON.stringify(e.analysis) })));
  }
  private async deleteExchangeRow(id: string): Promise<void> {
    await this.run('DELETE FROM exchange WHERE id = ?', [id]);
    await this.run('DELETE FROM analysis WHERE exchange_id = ?', [id]);
  }

  private async writeTranscript(list: TranscriptEvent[]): Promise<void> {
    await this.insert('transcript_event', list.map((t) => ({ id: t.id, session_id: t.sessionId, exchange_id: t.exchangeId, t_ms: t.tMs, speaker: t.speaker, text: t.text })));
  }

  private async readSettings(): Promise<Settings> {
    const s: Settings = { ...EMPTY_SETTINGS };
    for (const r of await this.q('SELECT key, value FROM setting')) {
      const k = str(r.key) as keyof Settings;
      if (k in s) (s as unknown as Record<string, unknown>)[k] = json<unknown>(r.value, (s as unknown as Record<string, unknown>)[k]);
    }
    return s;
  }
  private async writeSettings(s: Settings): Promise<void> {
    await this.run('DELETE FROM setting');
    await this.insert('setting', Object.entries(s).map(([key, v]) => ({ key, value: JSON.stringify(v) })));
  }

  private async replaceAll(t: MockBackup['tables']): Promise<void> {
    for (const tb of TABLES) if (tb !== 'meta') await this.run(`DELETE FROM ${tb}`);
    await this.writeLps(t.lps.length ? t.lps : LPS);
    await this.writeStories(t.stories);
    await this.writeQuestions(t.questions);
    await this.writeFiles(t.files);
    await this.writeSessions(t.sessions);
    await this.writeExchanges(t.exchanges);
    await this.writeTranscript(t.transcript);
    await this.writeSettings({ ...EMPTY_SETTINGS, ...t.settings });
  }

  // ---------------------------------------------------------------- reads
  lps(): Promise<Lp[]> { return this.serial(() => this.readLps()); }
  stories(): Promise<Story[]> { return this.serial(() => this.readStories()); }
  story(id: string): Promise<Story | null> { return this.serial(async () => (await this.readStories('WHERE id = ?', [id]))[0] ?? null); }
  questions(f: QuestionFilter = {}): Promise<Question[]> {
    return this.serial(() => {
      const w: string[] = []; const p: unknown[] = [];
      if (f.lpId) { w.push('id IN (SELECT question_id FROM question_lp WHERE lp_id = ?)'); p.push(f.lpId); }
      if (f.source && f.source !== 'all') { w.push('source = ?'); p.push(f.source); }
      if (f.difficulty) { w.push('difficulty = ?'); p.push(f.difficulty); }
      if (f.notAsked) w.push('times_asked = 0');
      if (f.lastVerdict && f.lastVerdict !== 'all') { w.push('last_verdict = ?'); p.push(f.lastVerdict); }
      if (f.untagged) w.push('id NOT IN (SELECT question_id FROM question_lp)');
      if (f.amazon) w.push("(contains(lower(tags), 'amazon') OR contains(lower(tags), 'aws'))");
      if (f.text) { w.push('contains(lower(text), ?)'); p.push(f.text.toLowerCase()); }
      return this.readQuestions(w.length ? 'WHERE ' + w.join(' AND ') : '', p);
    });
  }
  files(): Promise<PrepFile[]> { return this.serial(async () => (await this.q('SELECT * FROM file ORDER BY name, rowid')).map((r) => this.fileOf(r))); }
  sessions(): Promise<Session[]> { return this.serial(() => this.readSessions()); }
  session(id: string): Promise<Session | null> { return this.serial(async () => (await this.readSessions('WHERE s.id = ?', [id]))[0] ?? null); }
  exchanges(sessionId?: string): Promise<Exchange[]> { return this.serial(() => (sessionId ? this.readExchanges('WHERE e.session_id = ?', [sessionId]) : this.readExchanges())); }
  transcript(sessionId: string): Promise<TranscriptEvent[]> {
    return this.serial(async () => (await this.q('SELECT * FROM transcript_event WHERE session_id = ? ORDER BY t_ms, rowid', [sessionId])).map((r) => ({
      id: str(r.id), sessionId: str(r.session_id), exchangeId: strOrNull(r.exchange_id), tMs: num(r.t_ms), speaker: str(r.speaker) as TranscriptEvent['speaker'], text: str(r.text),
    })));
  }
  reports(limit = 10): Promise<{ session: Session; report: Report }[]> {
    return this.serial(async () => (await this.readSessions('WHERE r.json IS NOT NULL')).slice(0, limit).map((s) => ({ session: s, report: s.report! })));
  }
  settings(): Promise<Settings> { return this.serial(() => this.readSettings()); }
  nextSessionNumber(): Promise<number> { return this.serial(async () => num((await this.q('SELECT coalesce(max(number), 0) AS n FROM session'))[0]?.n) + 1); }

  // ---------------------------------------------------------------- writes
  setSettings(patch: Partial<Settings>): Promise<void> {
    return this.serial(async () => { await this.writeSettings({ ...(await this.readSettings()), ...patch }); this.changed('setting'); });
  }
  resetLps(): Promise<void> { return this.serial(async () => { await this.writeLps(LPS); this.changed('lp'); }); }
  setLps(lps: Lp[]): Promise<void> { return this.serial(async () => { await this.writeLps(lps); this.changed('lp'); }); }
  updateLp(id: string, patch: Partial<Pick<Lp, 'name' | 'description'>>): Promise<void> {
    return this.serial(async () => {
      if (patch.name !== undefined) await this.run('UPDATE lp SET name = ?, is_default = false WHERE id = ?', [patch.name, id]);
      if (patch.description !== undefined) await this.run('UPDATE lp SET description = ?, is_default = false WHERE id = ?', [patch.description, id]);
      this.changed('lp');
    });
  }
  upsertStory(story: Story): Promise<void> {
    return this.serial(async () => { await this.deleteStoryRows(story.id); await this.writeStories([story]); this.changed('story', 'story_number', 'story_lp'); });
  }
  deleteStory(id: string): Promise<void> { return this.serial(async () => { await this.deleteStoryRows(id); this.changed('story', 'story_number', 'story_lp'); }); }
  setStoryLp(storyId: string, lpId: string, role: LpRole | null): Promise<void> {
    return this.serial(async () => {
      const s = (await this.readStories('WHERE id = ?', [storyId]))[0];
      if (!s) return;
      s.links = s.links.filter((l) => l.lpId !== lpId);
      if (role) s.links.push({ lpId, role });
      s.updatedAt = new Date().toISOString();
      await this.deleteStoryRows(storyId); await this.writeStories([s]);
      this.changed('story', 'story_number', 'story_lp');
    });
  }
  addQuestions(questions: Question[]): Promise<number> {
    return this.serial(async () => { const n = await this.addQuestionsRaw(questions); this.changed('question', 'question_lp'); return n; });
  }
  updateQuestion(id: string, patch: Partial<Question>): Promise<void> {
    return this.serial(async () => {
      const q = (await this.readQuestions('WHERE id = ?', [id]))[0];
      if (!q) return;
      await this.deleteQuestionRows(id); await this.writeQuestions([{ ...q, ...patch, id }]);
      this.changed('question', 'question_lp');
    });
  }
  deleteQuestion(id: string): Promise<void> { return this.serial(async () => { await this.deleteQuestionRows(id); this.changed('question', 'question_lp'); }); }
  upsertFile(file: PrepFile): Promise<void> {
    return this.serial(async () => { await this.run('DELETE FROM file WHERE id = ? OR name = ?', [file.id, file.name]); await this.writeFiles([file]); this.changed('file'); });
  }
  setFileIncluded(id: string, included: boolean): Promise<void> { return this.serial(async () => { await this.run('UPDATE file SET included = ? WHERE id = ?', [included, id]); this.changed('file'); }); }
  deleteFile(id: string): Promise<void> { return this.serial(async () => { await this.run('DELETE FROM file WHERE id = ?', [id]); this.changed('file'); }); }
  insertSession(session: Session): Promise<void> { return this.serial(async () => { await this.writeSessions([session]); this.changed('session', 'report'); }); }
  updateSession(id: string, patch: Partial<Session>): Promise<void> {
    return this.serial(async () => {
      const s = (await this.readSessions('WHERE s.id = ?', [id]))[0];
      if (!s) return;
      await this.deleteSessionRow(id); await this.writeSessions([{ ...s, ...patch, id }]);
      this.changed('session', 'report');
    });
  }
  deleteSession(id: string): Promise<void> {
    return this.serial(async () => {
      await this.deleteSessionRow(id);
      await this.run('DELETE FROM analysis WHERE exchange_id IN (SELECT id FROM exchange WHERE session_id = ?)', [id]);
      await this.run('DELETE FROM exchange WHERE session_id = ?', [id]);
      await this.run('DELETE FROM transcript_event WHERE session_id = ?', [id]);
      this.changed('session', 'report', 'exchange', 'analysis', 'transcript_event');
    });
  }
  insertExchange(exchange: Exchange): Promise<void> { return this.serial(async () => { await this.writeExchanges([exchange]); this.changed('exchange', 'analysis'); }); }
  updateExchange(id: string, patch: Partial<Exchange>): Promise<void> {
    return this.serial(async () => {
      const e = (await this.readExchanges('WHERE e.id = ?', [id]))[0];
      if (!e) return;
      await this.deleteExchangeRow(id); await this.writeExchanges([{ ...e, ...patch, id }]);
      this.changed('exchange', 'analysis');
    });
  }
  setAnalysis(exchangeId: string, analysis: Analysis): Promise<void> {
    return this.serial(async () => {
      const e = (await this.readExchanges('WHERE e.id = ?', [exchangeId]))[0];
      if (!e) return;
      await this.deleteExchangeRow(exchangeId); await this.writeExchanges([{ ...e, analysis, verdict: analysis.verdict }]);
      const qid = e.questionId ?? str((await this.q('SELECT id FROM question WHERE text = ? ORDER BY rowid LIMIT 1', [e.questionText]))[0]?.id);
      if (qid) await this.run('UPDATE question SET last_verdict = ? WHERE id = ?', [analysis.verdict, qid]);
      this.changed('exchange', 'analysis', 'question');
    });
  }
  setBestAttempt(exchangeId: string): Promise<void> {
    return this.serial(async () => {
      const e = (await this.readExchanges('WHERE e.id = ?', [exchangeId]))[0];
      if (!e) return;
      await this.run('UPDATE exchange SET is_best = (id = ?) WHERE question_text = ?', [exchangeId, e.questionText]);
      const qid = e.questionId ?? str((await this.q('SELECT id FROM question WHERE text = ? ORDER BY rowid LIMIT 1', [e.questionText]))[0]?.id);
      if (qid) await this.run('UPDATE question SET best_exchange_id = ? WHERE id = ?', [exchangeId, qid]);
      this.changed('exchange', 'question');
    });
  }
  appendTranscript(events: TranscriptEvent[]): Promise<void> { return this.serial(async () => { await this.writeTranscript(events); this.changed('transcript_event'); }); }

  reset(): Promise<void> {
    return this.serial(async () => {
      for (const t of TABLES) if (t !== 'meta') await this.run(`DELETE FROM ${t}`);
      await this.seedFresh();
      await this.o.blobs.clear();
      this.changed(...TABLES);
    });
  }
  loadSample(): Promise<void> { return this.serial(async () => { await this.replaceAll(sampleTables()); this.changed(...TABLES); }); }
  importBackup(b: MockBackup): Promise<void> {
    return this.serial(async () => { await this.replaceAll({ ...b.tables, settings: { ...b.tables.settings, onboarded: true } }); this.changed(...TABLES); });
  }

  // ---------------------------------------------------------------- blobs + secrets
  async putBlob(key: string, blob: Blob): Promise<boolean> { try { await this.o.blobs.put(key, blob); return true; } catch { return false; } }
  getBlob(key: string): Promise<Blob | null> { return this.o.blobs.get(key); }
  listBlobs(prefix = ''): Promise<string[]> { return this.o.blobs.keys(prefix); }
  deleteBlob(key: string): Promise<void> { return this.o.blobs.delete(key); }
  getSecret(key: string): Promise<string | null> { return this.o.secrets.get(key); }
  async setSecret(key: string, value: string | null): Promise<void> { if (value == null || value === '') await this.o.secrets.delete(key); else await this.o.secrets.put(key, value); }
}
