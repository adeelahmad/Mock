import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../db/memory.ts';
import { loadInsights, localPolish, localSentiment, localStory, normalizeSentiment, saveInsights } from './insights.ts';
import { readSentiment, rewritePrompt } from '../gemini/insights.ts';
import type { Story, TranscriptEvent } from './types.ts';

const story = (o: Partial<Story>): Story => ({ id: 's1', title: 'Cache rollout', summary: 'Rolled out a cache', situation: 'Latency was 900 ms', task: 'Fix it', action: 'I added a cache', result: 'p99 fell to 120 ms', learning: '', numbers: [{ label: 'p99', value: '120 ms' }] as Story['numbers'], links: [], createdAt: '', updatedAt: '', ...o });

describe('transcript insights', () => {
  it('reads tone offline per speaker', () => {
    expect(localSentiment('We delivered on time and reduced costs, a great success.', 'me')).toMatchObject({ label: 'positive', tone: 'confident' });
    expect(localSentiment('They were frustrated, the build failed and we had a problem.', 'me').label).toBe('negative');
    expect(localSentiment('Tell me about a time.', 'interviewer').label).toBe('neutral');
    expect(localSentiment('Um, maybe, I think, kind of, uh, sort of did it.', 'me').tone).toBe('hesitant');
  });

  it('normalizes Flash sentiment', () => {
    expect(normalizeSentiment({ label: 'positive', score: 3, tone: 'Very Confident Indeed' })).toEqual({ label: 'positive', score: 1, tone: 'very confident' });
    expect(normalizeSentiment({ label: 'meh' })).toBeNull();
  });

  it('polishes a line offline', () => {
    expect(localPolish('um we actually helped them actually containerize AWS AWS containers')).toBe('I helped them containerize AWS containers.');
  });

  it('tells the best-linked story offline and cycles on repeat', () => {
    const a = story({ id: 'a', title: 'A', situation: 'A sit', links: [{ lpId: 'lp1', role: 'primary' }] });
    const b = story({ id: 'b', title: 'B', situation: 'B sit', links: [{ lpId: 'lp1', role: 'primary' }] });
    expect(localStory([a, b], 'lp1', 0)).toMatch(/^Situation — A sit/);
    expect(localStory([a, b], 'lp1', 1)).toMatch(/^Situation — B sit/);
    expect(localStory([], 'lp1', 0)).toMatch(/Add a story/);
  });

  it('keeps rewrites and sentiment per session', async () => {
    const repo = new MemoryRepo();
    await saveInsights(repo, 's9', { v: 1, sentiment: { t1: { label: 'neutral', score: 0, tone: 'steady' } }, rewrites: { t1: [{ id: 'r', kind: 'improve', text: 'x', at: '', by: 'local' }] } });
    const x = await loadInsights(repo, 's9');
    expect(x.rewrites.t1).toHaveLength(1);
    expect(x.sentiment?.t1.tone).toBe('steady');
    expect((await loadInsights(repo, 'none')).rewrites).toEqual({});
  });

  it('asks for a different angle when versions exist', () => {
    const p = rewritePrompt({ kind: 'story', line: 'I did a thing', question: 'Tell me about disagreeing', lp: null, stories: [story({})], previous: ['first try'] });
    expect(p).toMatch(/best answers this question/);
    expect(p).toMatch(/<version 1>first try<\/version>/);
    expect(p).toMatch(/Cache rollout/);
  });

  it('maps Flash sentiment back to line ids', async () => {
    const events: TranscriptEvent[] = [
      { id: 'e1', sessionId: 's', exchangeId: null, tMs: 0, speaker: 'interviewer', text: 'Hi' },
      { id: 'e2', sessionId: 's', exchangeId: null, tMs: 1, speaker: 'me', text: 'Hello there' },
    ];
    const reply = { candidates: [{ content: { parts: [{ text: JSON.stringify({ lines: [{ i: 0, label: 'neutral', score: 0, tone: 'warm' }, { i: 1, label: 'positive', score: 0.6, tone: 'confident' }, { i: 7, label: 'negative', score: -1, tone: 'x' }] }) }] } }] };
    const f = (async () => new Response(JSON.stringify(reply), { status: 200 })) as typeof fetch;
    const s = await readSentiment({ key: 'k', model: 'm', events, fetch: f });
    expect(Object.keys(s)).toEqual(['e1', 'e2']);
    expect(s.e2.tone).toBe('confident');
  });
});
