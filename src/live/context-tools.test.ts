import { describe, it, expect } from 'vitest';
import { contextTools, findLp, findStory } from './context-tools.ts';
import { SessionController } from './controller.ts';
import { GeminiLiveTransport } from './gemini.ts';
import { FakeSocket, FakeAudio } from './testing.ts';
import { MemoryRepo, sampleData } from '../db/memory.ts';
import { INTERVIEWERS, LPS, STORIES } from '../fixtures/sample.ts';
import type { Analyzer } from './analyzer.ts';

const tool = (repo: MemoryRepo, name: string) => contextTools(repo).find((t) => t.declaration.name === name)!;
const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};

describe('context tools', () => {
  it('matches LPs by id, name and prefix, and stories by title fragment', () => {
    expect(findLp(LPS, 'dive deep')?.name).toBe('Dive Deep');
    expect(findLp(LPS, 'Ownership')?.name).toBe('Ownership');
    expect(findLp(LPS, LPS[3].id)?.id).toBe(LPS[3].id);
    expect(findLp(LPS, 'nonsense')).toBeNull();
    expect(findStory(STORIES, 'payments')?.title).toBe('Payments outage');
    expect(findStory(STORIES, '')).toBeNull();
  });

  it('get_story returns the story in full, or the titles when nothing matches', async () => {
    const repo = new MemoryRepo(sampleData());
    const r = await tool(repo, 'get_story').handle({ story: 'Payments outage' });
    expect(r.ok).toBe(true);
    expect(r.title).toBe('Payments outage');
    expect((r.numbers as string[]).length).toBeGreaterThan(0);
    expect((r.lps as string[]).some((x) => /\((primary|secondary)\)$/.test(x))).toBe(true);
    const miss = await tool(repo, 'get_story').handle({ story: 'zzz' });
    expect(miss.ok).toBe(false);
    expect(miss.titles).toContain('Payments outage');
  });

  it('find_questions filters by LP and caps the count', async () => {
    const repo = new MemoryRepo(sampleData());
    const lp = LPS.find((l) => l.name === 'Dive Deep')!;
    const r = await tool(repo, 'find_questions').handle({ lp: 'Dive Deep', limit: 2 });
    expect(r.ok).toBe(true);
    const qs = r.questions as { id: string }[];
    expect(qs.length).toBeLessThanOrEqual(2);
    const all = await repo.questions({ lpId: lp.id });
    for (const q of qs) expect(all.map((x) => x.id)).toContain(q.id);
    expect((await tool(repo, 'find_questions').handle({ lp: '' })).ok).toBe(false);
  });

  it('lp_history lists the latest verdicts, newest session first', async () => {
    const repo = new MemoryRepo(sampleData());
    const r = await tool(repo, 'lp_history').handle({ lp: 'Dive Deep' });
    expect(r.ok).toBe(true);
    const rows = r.answers as { session: number; verdict: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].session).toBeGreaterThanOrEqual(rows[i].session);
  });

  it('the controller declares the tools and answers their calls from the repository', async () => {
    FakeSocket.all = [];
    const repo = new MemoryRepo(sampleData());
    const t = new GeminiLiveTransport({ auth: { kind: 'key', key: 'K' }, audio: new FakeAudio(), socket: (u) => new FakeSocket(u), retryDelaysMs: [1] });
    const noAnalysis: Analyzer = { analyze: () => new Promise(() => undefined) };
    const c = new SessionController(t, noAnalysis, repo, () => Date.now(), false, { tickMs: 5 });
    const sock = () => FakeSocket.all[FakeSocket.all.length - 1];
    const started = c.start({ mode: 'loop', focus: null, focusLabel: '', coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, systemInstruction: 'SYS', interviewers: INTERVIEWERS, lps: LPS, stories: STORIES, pauseMs: 2500, model: 'gemini-3.8-live', voice: 'Aoede', tools: contextTools(repo) });
    await until(() => !!sock()?.sent.length);
    const names = sock().sent[0].setup.tools[0].functionDeclarations.map((d: { name: string }) => d.name);
    expect(names).toEqual(['new_question', 'save_story', 'get_story', 'find_questions', 'lp_history']);
    sock().server({ setupComplete: {} });
    await started;
    sock().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'get_story', args: { story: 'payments' } }, { id: 'c2', name: 'nope', args: {} }] } });
    const reply = () => sock().sent.find((m) => m.toolResponse);
    await until(() => !!reply());
    const [a, b] = reply().toolResponse.functionResponses;
    expect(a).toMatchObject({ id: 'c1', name: 'get_story', response: { ok: true, title: 'Payments outage' } });
    expect(b).toMatchObject({ id: 'c2', response: { ok: false, error: 'unknown tool' } });
    c.destroy();
  });
});
