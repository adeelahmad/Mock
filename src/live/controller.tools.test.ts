import { describe, it, expect } from 'vitest';
import { SessionController } from './controller.ts';
import { Emitter, type LiveConfig, type LiveTransport, type ToolResponse, type TransportEvent } from './transport.ts';
import { MemoryRepo, sampleData } from '../db/memory.ts';
import { INTERVIEWERS, LPS, STORIES } from '../fixtures/sample.ts';
import type { Hit } from '../rag/knowledge.ts';

class ToolTransport extends Emitter implements LiveTransport {
  readonly kind = 'simulated' as const;
  config: LiveConfig | null = null;
  responses: ToolResponse[][] = [];
  async connect(c: LiveConfig) { this.config = c; queueMicrotask(() => this.emit({ type: 'ready' })); }
  sendText() {}
  sendToolResponse(r: ToolResponse[]) { this.responses.push(r); }
  setMuted() {}
  stopPlayback() {}
  isSpeaking() { return false; }
  close() {}
  fire(e: TransportEvent) { this.emit(e); }
}

const until = async (pred: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};

const HIT: Hit = { fileId: 'f1', fileName: 'resume.md', heading: 'Payments', text: 'Cut p99 latency by 40%.', score: 0.8 };

async function make(retriever: ((q: string, k: number) => Promise<Hit[]>) | null) {
  const repo = new MemoryRepo(sampleData());
  const t = new ToolTransport();
  const c = new SessionController(t, null, repo, () => Date.now(), false, { tickMs: 50 });
  await c.start({ mode: 'loop', focus: null, focusLabel: '', coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, systemInstruction: '', interviewers: INTERVIEWERS, lps: LPS, stories: STORIES, pauseMs: 8, model: 'sim', voice: 'sim', retriever });
  return { repo, t, c };
}

describe('controller tools: search_prep, save_story, the hint source', () => {
  it('declares search_prep only with a retriever', async () => {
    const a = await make(async () => [HIT]);
    expect(a.t.config?.tools.map((x) => x.name)).toEqual(['new_question', 'search_prep', 'save_story']);
    a.c.destroy();
    const b = await make(null);
    expect(b.t.config?.tools.map((x) => x.name)).toEqual(['new_question', 'save_story']);
    b.c.destroy();
  });

  it('finds the source passage for a new question and answers search_prep', async () => {
    const asked: string[] = [];
    const { t, c } = await make(async (q, k) => { asked.push(q + '|' + k); return [HIT]; });
    t.fire({ type: 'toolCall', calls: [{ id: '1', name: 'new_question', args: { interviewer: 'Dana Whitfield', question: 'Tell me about a time you dove deep.', lp: 'Dive Deep' } }] });
    await until(() => c.meta.source !== null);
    expect(c.meta.source?.fileName).toBe('resume.md');
    expect(asked[0]).toMatch(/dove deep.*Dive Deep.*\|1$/);
    t.fire({ type: 'toolCall', calls: [{ id: '2', name: 'search_prep', args: { query: 'latency', limit: 20 } }] });
    await until(() => t.responses.length >= 2);
    const r = t.responses[1][0];
    expect(r.response).toEqual({ ok: true, passages: [{ file: 'resume.md', section: 'Payments', text: 'Cut p99 latency by 40%.' }] });
    expect(asked[1]).toBe('latency|8');
    c.destroy();
  });

  it('saves a story built with the coach, linked to the LP', async () => {
    const { repo, t, c } = await make(async () => []);
    t.fire({ type: 'toolCall', calls: [{ id: '3', name: 'save_story', args: { title: 'Checkout latency', situation: 'Checkout was slow.', task: 'I owned p99.', action: 'I profiled and cached.', result: 'p99 fell 40%. Revenue up.', lp: 'Dive Deep', numbers: ['p99: -40%', '$1.2M'] } }] });
    await until(() => t.responses.length >= 1);
    expect(t.responses[0][0].response.ok).toBe(true);
    const s = (await repo.stories()).find((x) => x.title === 'Checkout latency')!;
    expect(s.numbers).toEqual([{ label: 'p99', value: '-40%' }, { label: '', value: '$1.2M' }]);
    expect(s.links[0]).toEqual({ lpId: LPS.find((l) => l.name === 'Dive Deep')!.id, role: 'primary' });
    expect(c.meta.savedStory?.title).toBe('Checkout latency');
    t.fire({ type: 'toolCall', calls: [{ id: '4', name: 'save_story', args: { title: '' } }] });
    await until(() => t.responses.length >= 2);
    expect(t.responses[1][0].response.ok).toBe(false);
    c.destroy();
  });
});

describe('role swap: the story on screen', () => {
  it('declares show_story, prefills the library story on new_question, then shows what the model sends', async () => {
    const repo = new MemoryRepo(sampleData());
    const t = new ToolTransport();
    const c = new SessionController(t, null, repo, () => Date.now(), false, { tickMs: 50 });
    await c.start({ mode: 'reverse', focus: null, focusLabel: '', coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, systemInstruction: '', interviewers: INTERVIEWERS, lps: LPS, stories: STORIES, pauseMs: 8, model: 'sim', voice: 'sim', retriever: null });
    expect(t.config?.tools.map((x) => x.name)).toContain('show_story');
    t.fire({ type: 'toolCall', calls: [{ id: 'q', name: 'new_question', args: { interviewer: 'You', question: 'Tell me about a problem others missed', lp: 'Dive Deep' } }] });
    await until(() => !!c.meta.answer);
    expect(c.meta.answer?.title).toBe('Payments outage');
    t.fire({ type: 'toolCall', calls: [{ id: 's', name: 'show_story', args: { title: 'Billing migration', headline: 'Moved 14 TB with zero downtime.', result: 'Zero downtime', numbers: ['data: 14 TB', 'downtime: 0'] } }] });
    await until(() => c.meta.answer?.title === 'Billing migration');
    expect(c.meta.answer?.numbers).toEqual([{ label: 'data', value: '14 TB' }, { label: 'downtime', value: '0' }]);
    c.destroy();
  });
});
