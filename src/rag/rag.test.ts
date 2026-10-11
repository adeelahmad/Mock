import { describe, it, expect } from 'vitest';
import { chunkText } from './chunk.ts';
import { KnowledgeIndex, keywordScores } from './knowledge.ts';
import { geminiEmbedder, normalise, type Embedder } from './embed.ts';
import { MemoryRepo } from '../db/memory.ts';
import type { PrepFile } from '../domain/types.ts';

const file = (id: string, name: string, content: string, over: Partial<PrepFile> = {}): PrepFile => ({ id, name, type: 'Background', content, included: true, size: content.length, updatedAt: '2026-10-11T00:00:00Z', summary: null, ...over });

const RESUME = `# Resume

## Payments platform, 2023
Led the migration of checkout to a new payments service. Cut p99 latency by 40% and saved $1.2M a year.

## Hiring
Grew the team from 4 to 11 engineers and built the interview loop.

## Disagreement with product
Pushed back on launching without load tests; we delayed one week and avoided an outage on Prime Day.`;

// A toy embedder: one dimension per vocabulary word, so related text is close.
const VOCAB = ['latency', 'payments', 'hiring', 'team', 'disagree', 'pushed', 'outage', 'checkout', 'engineers', 'launch'];
const toy: Embedder = async (texts) => texts.map((t) => normalise([...VOCAB.map((w): number => (t.toLowerCase().includes(w) ? 1 : 0)), 0.01]));

describe('chunkText', () => {
  it('cuts at headings and keeps the heading with each chunk', () => {
    const c = chunkText(RESUME);
    expect(c.map((x) => x.heading)).toEqual(['Payments platform, 2023', 'Hiring', 'Disagreement with product']);
    expect(c[0].text).toMatch(/40%/);
  });
  it('splits long paragraphs at sentences and never exceeds max', () => {
    const long = Array.from({ length: 60 }, (_, i) => 'Sentence number ' + i + ' talks about something.').join(' ');
    const c = chunkText(long, { target: 300, max: 400 });
    expect(c.length).toBeGreaterThan(3);
    for (const x of c) expect(x.text.length).toBeLessThanOrEqual(400);
  });
  it('returns nothing for blank text', () => { expect(chunkText('  \n\n ')).toEqual([]); });
});

describe('knowledge index', () => {
  it('finds the right passage by keywords without an embedder', async () => {
    const k = new KnowledgeIndex(new MemoryRepo());
    await k.sync([file('f1', 'resume.md', RESUME)], null);
    const [hit] = await k.search('Tell me about a time you disagreed and pushed back', 1);
    expect(hit.heading).toBe('Disagreement with product');
    expect(keywordScores('zebra', [{ heading: '', text: 'nothing' }])).toEqual([0]);
  });

  it('embeds, ranks by cosine, persists and reloads', async () => {
    const repo = new MemoryRepo();
    const k = new KnowledgeIndex(repo);
    const st = await k.sync([file('f1', 'resume.md', RESUME), file('f2', 'old.md', 'stale notes', { included: false })], toy);
    expect(st).toEqual({ files: 1, chunks: 3, embedded: 3 });
    const [hit] = await k.search('How did you grow the team and hiring?', 1, toy);
    expect(hit.heading).toBe('Hiring');
    const again = await KnowledgeIndex.load(repo);
    expect(again.status()).toEqual(st);
    expect((await again.search('latency of checkout payments', 1, toy))[0].heading).toBe('Payments platform, 2023');
    expect(again.stale([file('f1', 'resume.md', RESUME)], true)).toBe(false);
    expect(again.stale([file('f1', 'resume.md', RESUME, { updatedAt: '2026-10-12T00:00:00Z' })], true)).toBe(true);
  });

  it('re-embeds only changed files and drops removed ones', async () => {
    const k = new KnowledgeIndex(new MemoryRepo());
    let calls = 0;
    const counting: Embedder = async (t, task) => { calls++; return toy(t, task); };
    await k.sync([file('f1', 'a.md', RESUME), file('f2', 'b.md', 'Hiring plan for engineers')], counting);
    expect(calls).toBe(2);
    await k.sync([file('f1', 'a.md', RESUME)], counting);
    expect(calls).toBe(2);
    expect(k.status().files).toBe(1);
  });

  it('keeps chunks for keyword search when embedding fails, and embeds them on the next sync', async () => {
    const k = new KnowledgeIndex(new MemoryRepo());
    const broken: Embedder = async () => { throw new Error('quota'); };
    await expect(k.sync([file('f1', 'resume.md', RESUME)], broken)).rejects.toThrow('quota');
    expect(k.status()).toEqual({ files: 1, chunks: 3, embedded: 0 });
    expect((await k.search('outage on Prime Day', 1))[0].heading).toBe('Disagreement with product');
    expect(k.stale([file('f1', 'resume.md', RESUME)], true)).toBe(true);
    expect((await k.sync([file('f1', 'resume.md', RESUME)], toy)).embedded).toBe(3);
  });
});

describe('geminiEmbedder', () => {
  it('batches, sends the task type and normalises', async () => {
    const bodies: any[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)); bodies.push(b);
      return new Response(JSON.stringify({ embeddings: b.requests.map(() => ({ values: [3, 4] })) }), { status: 200 });
    }) as unknown as typeof fetch;
    let used = 0;
    const e = geminiEmbedder({ key: 'k', fetchImpl, onUsage: (n) => { used += n; } });
    const v = await e(Array.from({ length: 150 }, (_, i) => 'text ' + i), 'RETRIEVAL_DOCUMENT');
    expect(bodies.length).toBe(2);
    expect(bodies[0].requests[0].taskType).toBe('RETRIEVAL_DOCUMENT');
    expect(bodies[0].requests[0].outputDimensionality).toBe(768);
    expect(v[0][0]).toBeCloseTo(0.6);
    expect(used).toBeGreaterThan(0);
  });
  it('surfaces API errors', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(geminiEmbedder({ key: 'k', fetchImpl })(['x'], 'RETRIEVAL_QUERY')).rejects.toThrow('bad key');
  });
});
