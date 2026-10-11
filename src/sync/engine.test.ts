import { describe, it, expect } from 'vitest';
import { MemoryRepo, emptyData, sampleData } from '../db/memory.ts';
import { buildBackup, type MockBackup } from '../db/backup.ts';
import { SyncEngine, type MemoStore, type RemoteLibrary, type SyncApi, type SyncMemo } from './engine.ts';

/** The server in miniature: one library with compare-and-swap revisions. */
class FakeServer {
  lib: RemoteLibrary | null = null;
  puts = 0;
  api(): SyncApi {
    return {
      getLibrary: async () => (this.lib ? structuredClone(this.lib) : null),
      putLibrary: async (baseRev, doc) => {
        this.puts++;
        if ((this.lib?.rev ?? 0) !== baseRev) return { ok: false, current: this.lib };
        this.lib = { rev: baseRev + 1, doc: structuredClone(doc), updatedAt: new Date().toISOString() };
        return { ok: true, rev: this.lib.rev, updatedAt: this.lib.updatedAt };
      },
    };
  }
}
const memo = (): MemoStore & { m: Map<string, SyncMemo> } => { const m = new Map<string, SyncMemo>(); return { m, read: (u) => m.get(u) ?? null, write: (u, v) => { m.set(u, { ...v }); } }; };

async function device(server: FakeServer, sample = false, mem = memo()) {
  const repo = new MemoryRepo(sample ? sampleData() : emptyData());
  await repo.init();
  const engine = new SyncEngine(server.api(), { build: () => buildBackup(repo), apply: (d) => repo.importBackup(d) }, mem, { delayMs: 0 });
  repo.onChange = () => engine.changed();
  return { repo, engine, mem };
}
const titles = async (r: MemoryRepo) => (await r.stories()).map((s) => s.title).sort();
const story = (id: string, title: string) => ({ id, title, situation: '', task: '', action: '', result: '', numbers: [], lps: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }) as unknown as Parameters<MemoryRepo['upsertStory']>[0];

describe('SyncEngine', () => {
  it('uploads the first device and gives a fresh second device the same library', async () => {
    const server = new FakeServer();
    const a = await device(server, true);
    await a.engine.start('u1');
    expect(server.lib?.rev).toBe(1);
    const b = await device(server);
    await b.engine.start('u1');
    expect(await titles(b.repo)).toEqual(await titles(a.repo));
    expect((await b.repo.sessions()).length).toBe((await a.repo.sessions()).length);
    expect(server.puts).toBe(1); // b took the copy without pushing it back
    expect(b.engine.status).toMatchObject({ phase: 'idle', pending: false });
  });

  it('pushes local changes and the other device pulls them; deletes travel too', async () => {
    const server = new FakeServer();
    const a = await device(server, true); await a.engine.start('u1');
    const b = await device(server); await b.engine.start('u1');
    await a.repo.upsertStory(story('st_new', 'Brand new story'));
    await a.engine.sync();
    await b.engine.sync();
    expect(await titles(b.repo)).toContain('Brand new story');
    await b.repo.deleteStory('st_new');
    await b.engine.sync();
    await a.engine.sync();
    expect(await titles(a.repo)).not.toContain('Brand new story');
  });

  it('merges when both devices changed since the last sync', async () => {
    const server = new FakeServer();
    const a = await device(server, true); await a.engine.start('u1');
    const b = await device(server); await b.engine.start('u1');
    await a.repo.upsertStory(story('st_a', 'Written on A'));
    await b.repo.upsertStory(story('st_b', 'Written on B'));
    await a.engine.sync();
    await b.engine.sync(); // 409 path: pulls A's, merges, pushes
    await a.engine.sync();
    for (const d of [a, b]) expect(await titles(d.repo)).toEqual(expect.arrayContaining(['Written on A', 'Written on B']));
    expect(server.lib!.rev).toBe(3);
  });

  it('merges a device that already has its own library into the server copy on first sign-in', async () => {
    const server = new FakeServer();
    const a = await device(server, true); await a.engine.start('u1');
    const b = await device(server);
    await b.repo.upsertStory(story('st_local', 'Only on B before sign-in'));
    await b.engine.start('u1');
    expect(await titles(b.repo)).toEqual(expect.arrayContaining(['Only on B before sign-in', ...(await titles(a.repo))]));
    await a.engine.sync();
    expect(await titles(a.repo)).toContain('Only on B before sign-in');
  });

  it('remembers the revision per user and does not pull during a live session', async () => {
    const server = new FakeServer();
    const mem = memo();
    const a = await device(server, true, mem); await a.engine.start('u1');
    expect(mem.m.get('u1')).toMatchObject({ rev: 1, dirty: false });
    let live = true;
    const b = await device(server);
    const engine = new SyncEngine(server.api(), { build: () => buildBackup(b.repo), apply: (d) => b.repo.importBackup(d) }, memo(), { busy: () => live });
    await engine.start('u1');
    expect((await b.repo.sessions()).length).toBe(0);
    live = false;
    await engine.sync();
    expect((await b.repo.sessions()).length).toBe((await a.repo.sessions()).length);
  });

  it('reports errors and recovers', async () => {
    const server = new FakeServer();
    const a = await device(server, true);
    let down = true;
    const api = server.api();
    const flaky: SyncApi = { getLibrary: () => (down ? Promise.reject(new Error('502')) : api.getLibrary()), putLibrary: api.putLibrary };
    const e = new SyncEngine(flaky, { build: () => buildBackup(a.repo), apply: (d: MockBackup) => a.repo.importBackup(d) }, memo());
    await e.start('u1');
    expect(e.status).toMatchObject({ phase: 'error', error: '502' });
    down = false;
    await e.sync();
    expect(e.status.phase).toBe('idle');
    expect(server.lib?.rev).toBe(1);
  });
});
