import { describe, it, expect } from 'vitest';
import { MemoryRepo, sampleData, emptyData } from './memory.ts';
import { DuckRepo } from './duck.ts';
import { MemoryKv } from './kv.ts';
import { createNodeEngine } from './engine-node.ts';
import { BackupError, applyBackup, buildBackup, buildBackupZip, isSealed, mergeBackups, migrateBackup, readBackupFile, backupFileName, type MockBackup } from './backup.ts';

const sampleRepo = async () => { const r = new MemoryRepo(sampleData()); await r.init(); return r; };
const strip = (b: MockBackup) => ({ ...b, exportedAt: '' });

describe('backup zip', () => {
  it('round-trips every table, uploads and recordings through a zip', async () => {
    const a = await sampleRepo();
    await a.putBlob('rec:s14', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }));
    await a.putBlob('upload:f1', new Blob(['# notes'], { type: 'text/markdown' }));
    await a.putBlob('rec:gone', new Blob(['x'])); // belongs to no session: left out
    const z = await buildBackupZip(a, { recordings: true });
    expect(z.name).toMatch(/^mock-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(z.manifest.counts).toMatchObject({ sessions: 8, recordings: 1, uploads: 1 });
    const r = await readBackupFile(z.bytes);
    expect(r.manifest!.schemaVersion).toBe(1);
    const b = new MemoryRepo(emptyData()); await b.init();
    await applyBackup(b, r, 'replace');
    expect(strip(await buildBackup(b))).toEqual(strip({ ...(await buildBackup(a)), tables: { ...(await buildBackup(a)).tables, settings: { ...(await a.settings()), onboarded: true } } }));
    expect(await (await b.getBlob('upload:f1'))!.text()).toBe('# notes');
    expect((await b.getBlob('rec:s14'))!.type).toBe('audio/webm');
    expect(await b.getBlob('rec:gone')).toBeNull();
  });

  it('includes Parquet tables from DuckDB', async () => {
    const d = new DuckRepo(await createNodeEngine(), { blobs: new MemoryKv(), secrets: new MemoryKv() });
    await d.init(); await d.loadSample();
    const z = await buildBackupZip(d);
    expect(z.manifest.parquet).toBe(true);
    const { unzipSync } = await import('fflate');
    const names = Object.keys(unzipSync(z.bytes));
    expect(names).toContain('tables/question.parquet');
    expect(names).toContain('data.json');
  }, 60_000);

  it('seals with a passphrase and refuses the wrong one', async () => {
    const z = await buildBackupZip(await sampleRepo(), { passphrase: 'correct horse' });
    expect(isSealed(z.bytes)).toBe(true);
    expect(z.name).toMatch(/\.mockbackup$/);
    await expect(readBackupFile(z.bytes)).rejects.toMatchObject({ code: 'encrypted' });
    await expect(readBackupFile(z.bytes, 'wrong')).rejects.toMatchObject({ code: 'passphrase' });
    const r = await readBackupFile(z.bytes, 'correct horse');
    expect(r.encrypted).toBe(true);
    expect(r.backup.tables.sessions).toHaveLength(8);
  }, 30_000);

  it('partial exports: library only and sessions only', async () => {
    const a = await sampleRepo();
    const lib = await readBackupFile((await buildBackupZip(a, { scope: 'library' })).bytes);
    expect(lib.backup.tables.sessions).toEqual([]);
    expect(lib.backup.tables.stories.length).toBeGreaterThan(0);
    const ses = await readBackupFile((await buildBackupZip(a, { scope: 'sessions' })).bytes);
    expect(ses.backup.tables.stories).toEqual([]);
    expect(ses.backup.tables.sessions).toHaveLength(8);
    expect(backupFileName({ scope: 'library' }, new Date('2026-10-11T00:00:00Z'))).toBe('mock-library-2026-10-11.zip');
  });

  it('still restores an M1 JSON backup, and rejects other files', async () => {
    const doc = await buildBackup(await sampleRepo());
    const r = await readBackupFile(new TextEncoder().encode(JSON.stringify(doc)));
    expect(r.manifest).toBeNull();
    expect(r.backup.tables.questions.length).toBe(doc.tables.questions.length);
    await expect(readBackupFile(new TextEncoder().encode('{"hello":1}'))).rejects.toBeInstanceOf(BackupError);
    await expect(readBackupFile(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('migrates older documents in order and refuses newer ones', async () => {
    const doc = await buildBackup(await sampleRepo());
    const seen: number[] = [];
    const steps = { 2: (b: MockBackup) => { seen.push(2); return b; }, 3: (b: MockBackup) => { seen.push(3); return b; } };
    expect(migrateBackup({ ...doc, version: 1 }, 3, steps).version).toBe(3);
    expect(seen).toEqual([2, 3]);
    expect(() => migrateBackup({ ...doc, version: 99 })).toThrow(/newer Mock/);
  });
});

describe('merge', () => {
  it('keeps both libraries, dedupes questions by text and renumbers clashing sessions', async () => {
    const cur = await buildBackup(await sampleRepo());
    const inc: MockBackup = JSON.parse(JSON.stringify(cur));
    const s = inc.tables.sessions[0];
    inc.tables.sessions = [{ ...s, id: 's_other', number: s.number, startedAt: '2030-01-01T00:00:00.000Z' }];
    inc.tables.exchanges = inc.tables.exchanges.filter((e) => e.sessionId === s.id).map((e) => ({ ...e, id: e.id + '_o', sessionId: 's_other' }));
    inc.tables.transcript = [];
    inc.tables.questions = [{ ...inc.tables.questions[0], id: 'q_dup', text: '  ' + inc.tables.questions[0].text.toUpperCase(), timesAsked: 99 }, { ...inc.tables.questions[0], id: 'q_new', text: 'A genuinely new question?' }];
    inc.tables.stories = [{ ...inc.tables.stories[0], id: 'st_x', title: 'Brand new story', updatedAt: '2030-01-01' }];
    const m = mergeBackups(cur, inc);
    expect(m.tables.questions.length).toBe(cur.tables.questions.length + 1);
    expect(m.tables.questions.find((q) => q.id === cur.tables.questions[0].id)!.timesAsked).toBe(99);
    expect(m.tables.stories.length).toBe(cur.tables.stories.length + 1);
    expect(m.tables.sessions.length).toBe(cur.tables.sessions.length + 1);
    const nums = m.tables.sessions.map((x) => x.number);
    expect(new Set(nums).size).toBe(nums.length);
    expect(m.tables.sessions.find((x) => x.id === 's_other')!.number).toBe(nums.length);
    expect(m.tables.exchanges.filter((e) => e.sessionId === 's_other').length).toBeGreaterThan(0);
    expect(m.tables.settings).toEqual({ ...cur.tables.settings });
  });

  it('merge through applyBackup keeps the current library', async () => {
    const a = await sampleRepo();
    const other = new MemoryRepo(emptyData()); await other.init();
    await other.addQuestions([{ id: 'qq', text: 'Only on the other device?', lpIds: [], source: 'custom', difficulty: 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: '2026-01-01' }]);
    const r = await readBackupFile((await buildBackupZip(other)).bytes);
    const before = (await a.questions()).length;
    await applyBackup(a, r, 'merge');
    expect((await a.questions()).length).toBe(before + 1);
    expect((await a.sessions()).length).toBe(8);
  });
});
