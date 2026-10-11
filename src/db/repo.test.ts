// The Repo contract, run against both implementations: the in-memory one and DuckDB (the
// Node build of DuckDB-Wasm, same SQL as the browser). Then DuckDB-only checks: snapshots
// round-trip through Parquet, migrations run on load, a fresh install seeds LPs + the bank.

import { describe, it, expect, beforeAll } from 'vitest';
import type { Question, Story } from '../domain/types.ts';
import type { Repo } from './repo.ts';
import { MemoryRepo, sampleData, emptyData } from './memory.ts';
import { DuckRepo } from './duck.ts';
import { MemoryKv } from './kv.ts';
import { SnapshotStore } from './snapshots.ts';
import { createNodeEngine } from './engine-node.ts';
import { buildBackup } from './backup.ts';
import { SCHEMA_VERSION, ddlAt, migrationsBetween, type Migration } from './schema.ts';

const q = (id: string, text: string, lpIds: string[] = [], extra: Partial<Question> = {}): Question => ({ id, text, lpIds, source: 'custom', difficulty: 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: '2026-10-01T00:00:00.000Z', ...extra });

async function duck(snapshots?: SnapshotStore, seedQuestions?: () => Promise<Question[]>): Promise<DuckRepo> {
  const r = new DuckRepo(await createNodeEngine(), { snapshots, blobs: new MemoryKv<Blob>(), secrets: new MemoryKv<string>(), seedQuestions, snapshotDelayMs: 0 });
  await r.init();
  return r;
}

type Make = () => Promise<Repo>;
const impls: [string, Make][] = [
  ['memory', async () => { const r = new MemoryRepo(sampleData()); await r.init(); return r; }],
  ['duckdb', async () => { const r = await duck(); await r.loadSample(); return r; }],
];

describe.each(impls)('Repo contract · %s', (_name, make) => {
  let repo: Repo;
  beforeAll(async () => { repo = await make(); }, 60_000);

  it('reads the sample library', async () => {
    expect((await repo.lps()).length).toBe(16);
    expect((await repo.lps())[0].order).toBeLessThanOrEqual((await repo.lps())[1].order);
    expect((await repo.stories()).length).toBe(sampleData().stories.length);
    expect((await repo.sessions())[0].number).toBe(Math.max(...sampleData().sessions.map((s) => s.number)));
    expect(await repo.nextSessionNumber()).toBe(Math.max(...sampleData().sessions.map((s) => s.number)) + 1);
  });

  it('returns the same rows as the fixtures', async () => {
    const d = sampleData();
    const byId = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(await repo.stories())).toEqual(byId(d.stories));
    expect(byId(await repo.questions())).toEqual(byId(d.questions));
    expect(byId(await repo.files())).toEqual(byId(d.files));
    expect(byId(await repo.sessions())).toEqual(byId(d.sessions));
    expect(byId(await repo.exchanges())).toEqual(byId(d.exchanges));
    const s14 = d.transcript.filter((t) => t.sessionId === 's14').sort((a, b) => a.tMs - b.tMs);
    expect(await repo.transcript('s14')).toEqual(s14);
    expect(await repo.settings()).toEqual(d.settings);
  });

  it('filters questions', async () => {
    const all = await repo.questions();
    const lp = all.find((x) => x.lpIds.length)!.lpIds[0];
    expect((await repo.questions({ lpId: lp })).every((x) => x.lpIds.includes(lp))).toBe(true);
    expect((await repo.questions({ notAsked: true })).every((x) => x.timesAsked === 0)).toBe(true);
    expect((await repo.questions({ source: 'previous' })).every((x) => x.source === 'previous')).toBe(true);
    const word = all[0].text.split(' ')[3].toLowerCase();
    expect((await repo.questions({ text: word })).every((x) => x.text.toLowerCase().includes(word))).toBe(true);
    const ordered = await repo.questions();
    for (let i = 1; i < ordered.length; i++) expect(ordered[i - 1].timesAsked).toBeGreaterThanOrEqual(ordered[i].timesAsked);
  });

  it('adds questions once (case/space-insensitive) and updates their LPs', async () => {
    const n = await repo.addQuestions([q('qa', 'Tell me about a brand new thing.', ['own']), q('qb', '  tell me about a BRAND new thing.  ')]);
    expect(n).toBe(1);
    await repo.updateQuestion('qa', { lpIds: ['dive', 'own'], difficulty: 3 });
    const got = (await repo.questions({ text: 'brand new' }))[0];
    expect(got.lpIds).toEqual(['dive', 'own']);
    expect(got.difficulty).toBe(3);
    expect((await repo.questions({ untagged: true })).some((x) => x.id === 'qa')).toBe(false);
    await repo.deleteQuestion('qa');
    expect(await repo.questions({ text: 'brand new' })).toEqual([]);
  });

  it('edits stories and cycles a grid mapping', async () => {
    const s: Story = { ...(await repo.stories())[0], id: 'st_new', title: 'New story', numbers: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }], links: [] };
    await repo.upsertStory(s);
    await repo.setStoryLp('st_new', 'big', 'primary');
    await repo.setStoryLp('st_new', 'dive', 'secondary');
    await repo.setStoryLp('st_new', 'big', null);
    const got = (await repo.story('st_new'))!;
    expect(got.links).toEqual([{ lpId: 'dive', role: 'secondary' }]);
    expect(got.numbers.map((n) => n.value)).toEqual(['1', '2']);
    await repo.deleteStory('st_new');
    expect(await repo.story('st_new')).toBeNull();
  });

  it('upserts files by id or name and toggles inclusion', async () => {
    const f = (await repo.files())[0];
    await repo.upsertFile({ ...f, id: 'f_other', content: 'replaced' });
    const list = await repo.files();
    expect(list.filter((x) => x.name === f.name)).toHaveLength(1);
    expect(list.find((x) => x.name === f.name)!.content).toBe('replaced');
    await repo.setFileIncluded('f_other', false);
    expect((await repo.files()).find((x) => x.id === 'f_other')!.included).toBe(false);
  });

  it('records a session, its exchanges, analysis, best attempt and transcript', async () => {
    const ex0 = (await repo.exchanges('s14'))[0];
    const n = await repo.nextSessionNumber();
    await repo.insertSession({ ...(await repo.session('s14'))!, id: 's_new', number: n, report: null, endedAt: null });
    await repo.insertExchange({ ...ex0, id: 'e_new', sessionId: 's_new', analysis: null, verdict: null, isBest: false, endedAt: null, endMs: null });
    await repo.updateExchange('e_new', { endMs: 1234, storyTitle: 'Payments outage' });
    await repo.setAnalysis('e_new', { ...ex0.analysis!, verdict: 'strong_hire' });
    await repo.setBestAttempt('e_new');
    await repo.appendTranscript([{ id: 't1', sessionId: 's_new', exchangeId: 'e_new', tMs: 5, speaker: 'me', text: 'hello' }]);
    await repo.updateSession('s_new', { endedAt: '2026-10-11T00:00:00.000Z' });
    const e = (await repo.exchanges('s_new'))[0];
    expect(e.endMs).toBe(1234);
    expect(e.verdict).toBe('strong_hire');
    expect(e.analysis!.verdict).toBe('strong_hire');
    expect(e.isBest).toBe(true);
    expect((await repo.exchanges()).filter((x) => x.questionText === ex0.questionText && x.isBest)).toHaveLength(1);
    expect((await repo.session('s_new'))!.endedAt).toBe('2026-10-11T00:00:00.000Z');
    expect((await repo.transcript('s_new')).map((t) => t.text)).toEqual(['hello']);
    await repo.deleteSession('s_new');
    expect(await repo.session('s_new')).toBeNull();
    expect(await repo.exchanges('s_new')).toEqual([]);
  });

  it('lists reports newest first and patches settings', async () => {
    const r = await repo.reports(3);
    expect(r.length).toBeGreaterThan(0);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].session.number).toBeGreaterThan(r[i].session.number);
    await repo.setSettings({ pauseMs: 3000 });
    expect((await repo.settings()).pauseMs).toBe(3000);
  });

  it('keeps blobs and secrets', async () => {
    await repo.putBlob('rec:x', new Blob(['abc'], { type: 'audio/webm' }));
    expect(await repo.listBlobs('rec:')).toEqual(['rec:x']);
    expect(await (await repo.getBlob('rec:x'))!.text()).toBe('abc');
    await repo.setSecret('gemini.key', 'k');
    expect(await repo.getSecret('gemini.key')).toBe('k');
    await repo.setSecret('gemini.key', null);
    expect(await repo.getSecret('gemini.key')).toBeNull();
  });

  it('restores a backup (replace) and resets', async () => {
    const b = await buildBackup(repo);
    await repo.reset();
    expect(await repo.stories()).toEqual([]);
    expect((await repo.lps()).length).toBe(16);
    expect((await repo.settings()).onboarded).toBe(false);
    await repo.importBackup(b);
    expect((await repo.stories()).length).toBe(b.tables.stories.length);
    expect((await repo.sessions()).length).toBe(b.tables.sessions.length);
  });
});

describe('DuckDB persistence', () => {
  it('a fresh install seeds the 16 LPs and the question bank, onboarding not done', async () => {
    const r = await duck(undefined, async () => [q('b1', 'Bank question one?', ['own']), q('b2', 'Bank question two?')]);
    expect((await r.lps()).length).toBe(16);
    expect((await r.questions()).map((x) => x.id).sort()).toEqual(['b1', 'b2']);
    expect(await r.stories()).toEqual([]);
    expect((await r.settings()).onboarded).toBe(false);
  }, 60_000);

  it('snapshots every write to Parquet and loads them back in a new engine', async () => {
    const store = new SnapshotStore(new MemoryKv());
    const a = await duck(store);
    await a.loadSample();
    await a.addQuestions([q('qz', 'Persisted question?', ['dive'])]);
    await a.setSettings({ pauseMs: 1800 });
    await a.flush();
    const before = await buildBackup(a);
    const b = await duck(store);
    expect(b.restoredFromSnapshot).toBe(true);
    const after = await buildBackup(b);
    expect({ ...after, exportedAt: '' }).toEqual({ ...before, exportedAt: '' });
    expect((await b.settings()).pauseMs).toBe(1800);
  }, 60_000);

  it('runs migrations in order and refuses data from a newer schema', () => {
    const list: Migration[] = [{ to: 3, sql: ['C'] }, { to: 2, sql: ['B'] }];
    expect(migrationsBetween(1, 3, list).map((m) => m.to)).toEqual([2, 3]);
    expect(migrationsBetween(2, 3, list).map((m) => m.to)).toEqual([3]);
    expect(ddlAt(2, list).slice(-1)).toEqual(['B']);
    expect(() => migrationsBetween(SCHEMA_VERSION + 1)).toThrow(/newer Mock/);
  });

  it('memory and DuckDB start the same after reset', async () => {
    const m = new MemoryRepo(emptyData()); await m.init();
    const d = await duck();
    expect(await d.lps()).toEqual(await m.lps());
    expect(await d.settings()).toEqual(await m.settings());
  }, 60_000);
});
