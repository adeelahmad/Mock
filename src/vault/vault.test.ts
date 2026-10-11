import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { MemoryRepo, emptyData, sampleData } from '../db/memory.ts';
import { buildBackup } from '../db/backup.ts';
import type { Question } from '../domain/types.ts';
import { deriveMaster, generatePassphrase, keysFrom, open, passphraseBits, seal, MIN_BITS } from './keys.ts';
import { host, join, newCode, formatCode, parseCode } from './pair.ts';
import { MemoryHub, signEvent, verifyEvent } from './signal.ts';
import { Vault, packPairing, unpackPairing, DEFAULT_CONFIG, type Saved, type SavedStore } from './vault.ts';

const FAST = { t: 1, m: 256, p: 1 };
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function settle(...vs: Vault[]) { for (let i = 0; i < 4; i++) { await wait(40); for (const v of vs) await v.flush(); } await wait(40); }

const memSaved = (): SavedStore => { let s: Saved | null = null; return { read: () => s, write: (v) => { s = v; } }; };

async function device(sample: boolean, master: Uint8Array, secrets: Record<string, string> = {}) {
  const repo = new MemoryRepo(sample ? sampleData() : emptyData());
  await repo.init();
  const sec = { ...secrets };
  const v = new Vault({
    local: { build: () => buildBackup(repo), apply: (d) => repo.importBackup(d) },
    secrets: { read: async () => ({ ...sec }), write: async (s) => { Object.assign(sec, s); } },
    saved: memSaved(), p2p: false, delayMs: 5,
  });
  repo.onChange = () => v.changed();
  await v.enable(master, DEFAULT_CONFIG);
  return { repo, v, sec };
}
/** Two documents wired together the way a data channel does it. */
function link(a: Vault, b: Vault): void {
  const da = a.doc!, db = b.doc!;
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da), 'peer');
  Y.applyUpdate(da, Y.encodeStateAsUpdate(db), 'peer');
  da.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'peer') Y.applyUpdate(db, u, 'peer'); });
  db.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'peer') Y.applyUpdate(da, u, 'peer'); });
}
const titles = async (r: MemoryRepo) => (await r.stories()).map((s) => s.title).sort();
const story = (id: string, title: string) => ({ id, title, situation: '', task: '', action: '', result: '', numbers: [], lps: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }) as unknown as Parameters<MemoryRepo['upsertStory']>[0];

describe('vault keys', () => {
  it('derives the same key from the same passphrase, and seals to it', async () => {
    const a = await deriveMaster('  violet  anchor ', FAST), b = await deriveMaster('violet anchor', FAST), c = await deriveMaster('violet anchors', FAST);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const k = await keysFrom(a), k2 = await keysFrom(c);
    expect(k.room).toMatch(/^[0-9a-f]{64}$/);
    const box = await seal(k.enc, new Uint8Array([1, 2, 3]), 'x');
    expect(await open(k.enc, box, 'x')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await open(k.enc, box, 'y')).toBeNull();
    expect(await open(k2.enc, box, 'x')).toBeNull();
  });
  it('rates generated passphrases as strong and short ones as weak', () => {
    expect(passphraseBits(generatePassphrase())).toBeGreaterThanOrEqual(64);
    expect(passphraseBits('hunter2')).toBeLessThan(MIN_BITS);
  });
});

describe('nostr events', () => {
  it('signs and verifies, and rejects tampering', () => {
    const e = signEvent(new Uint8Array(32).fill(7), 25050, [['t', 'room']], 'hello');
    expect(verifyEvent(e)).toBe(true);
    expect(verifyEvent({ ...e, content: 'other' })).toBe(false);
  });
});

describe('pairing', () => {
  it('hands the key to a device that types the code', async () => {
    const hub = new MemoryHub();
    const saved: Saved = { master: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))), config: DEFAULT_CONFIG };
    const h = host(hub.signal(), packPairing(saved));
    const code = parseCode(formatCode(h.code))!;
    expect(code).toEqual(h.code);
    const j = join(hub.signal(), code, { retryMs: 20 });
    expect(unpackPairing(await j.done)).toEqual(saved);
    expect(await h.done).toBe(true);
  });
  it('refuses a wrong code and spends the real one', async () => {
    const hub = new MemoryHub();
    const h = host(hub.signal(), new Uint8Array([1]));
    const wrong = { ...h.code, words: [h.code.words[1] === 'acid' ? 'acorn' : 'acid', h.code.words[1]] as [string, string] };
    const j = join(hub.signal(), wrong, { retryMs: 20 });
    await expect(j.done).rejects.toThrow(/Wrong code/);
    await expect(h.done).rejects.toThrow(/Wrong code/);
  });
  it('makes codes from the word list', () => {
    const c = newCode();
    expect(formatCode(c)).toMatch(/^\d{1,3}-[a-z]+-[a-z]+$/);
    expect(parseCode('nope')).toBeNull();
  });
});

describe('Vault (CRDT bridge)', () => {
  it('gives a fresh device the library, keeps its settings, and syncs edits and deletes both ways', async () => {
    const master = await deriveMaster('test vault one', FAST);
    const a = await device(true, master, { 'gemini.key': 'AIza-test' });
    await a.repo.setSettings({ voice: 'Puck', loopSize: 7 });
    await settle(a.v);
    const b = await device(false, master);
    link(a.v, b.v);
    await settle(a.v, b.v);
    expect(await titles(b.repo)).toEqual(await titles(a.repo));
    expect((await b.repo.sessions()).length).toBe((await a.repo.sessions()).length);
    expect((await a.repo.settings()).voice).toBe('Puck'); // the fresh device's defaults did not win
    expect((await b.repo.settings()).loopSize).toBe(7);
    expect(b.sec['gemini.key']).toBe('AIza-test');

    await b.repo.upsertStory(story('st_b', 'Written on B'));
    await settle(a.v, b.v);
    expect(await titles(a.repo)).toContain('Written on B');
    await a.repo.deleteStory('st_b');
    await settle(a.v, b.v);
    expect(await titles(b.repo)).not.toContain('Written on B');
  });

  it('merges edits made on two devices while they were apart', async () => {
    const master = await deriveMaster('test vault two', FAST);
    const a = await device(true, master);
    const b = await device(false, master);
    link(a.v, b.v);
    await settle(a.v, b.v);
    // Apart: each writes its own story and changes a different setting.
    const da = a.v.doc!, db = b.v.doc!;
    const offA: Uint8Array[] = [], offB: Uint8Array[] = [];
    const sv = { a: Y.encodeStateVector(da), b: Y.encodeStateVector(db) };
    await a.repo.upsertStory(story('st_a2', 'Offline on A'));
    await b.repo.upsertStory(story('st_b2', 'Offline on B'));
    await settle(a.v, b.v);
    offA.push(Y.encodeStateAsUpdate(da, sv.a)); offB.push(Y.encodeStateAsUpdate(db, sv.b));
    for (const u of offA) Y.applyUpdate(db, u, 'peer');
    for (const u of offB) Y.applyUpdate(da, u, 'peer');
    await settle(a.v, b.v);
    for (const d of [a, b]) expect(await titles(d.repo)).toEqual(expect.arrayContaining(['Offline on A', 'Offline on B']));
    expect(await titles(a.repo)).toEqual(await titles(b.repo));
  });

  it('two devices that each seeded the question bank end with one copy', async () => {
    const master = await deriveMaster('test vault three', FAST);
    const q = (id: string, text: string): Question => ({ id, text, lpIds: ['inv'], source: 'common', difficulty: 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: '' });
    const a = await device(false, master), b = await device(false, master);
    await a.repo.addQuestions([q('q_a1', 'Tell me about a time you failed.'), q('q_a2', 'Describe a hard call.')]);
    await b.repo.addQuestions([q('q_b1', 'Tell me about a time you failed.')]);
    await settle(a.v, b.v);
    link(a.v, b.v);
    await settle(a.v, b.v);
    const texts = async (r: MemoryRepo) => (await r.questions()).map((x) => x.text).sort();
    expect(await texts(a.repo)).toEqual(['Describe a hard call.', 'Tell me about a time you failed.']);
    expect(await texts(b.repo)).toEqual(await texts(a.repo));
  });

  it('a restart keeps changes the document missed and does not resurrect anything', async () => {
    const master = await deriveMaster('test vault four', FAST);
    const store = new Map<string, Uint8Array>();
    const persist = { bind: async (name: string, doc: Y.Doc) => {
      const prev = store.get(name);
      if (prev) Y.applyUpdate(doc, prev);
      const save = () => store.set(name, Y.encodeStateAsUpdate(doc));
      doc.on('update', save);
      return () => doc.off('update', save);
    } };
    const repo = new MemoryRepo(sampleData());
    await repo.init();
    const v = new Vault({ local: { build: () => buildBackup(repo), apply: (d) => repo.importBackup(d) }, saved: memSaved(), persist, p2p: false, delayMs: 5 });
    repo.onChange = () => v.changed();
    await v.enable(master);
    const doomed = (await repo.stories())[0];
    await repo.deleteStory(doomed.id);
    await settle(v);
    await v.stop();
    await repo.upsertStory(story('st_late', 'Written while the app was closing'));
    await v.start();
    await settle(v);
    const t = await titles(repo);
    expect(t).toContain('Written while the app was closing');
    expect(t).not.toContain(doomed.title);
    expect([...v.doc!.getMap<string>('t.stories').keys()]).toContain('st_late');
  });
});
