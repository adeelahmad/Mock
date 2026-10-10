import { describe, it, expect } from 'vitest';
import { SessionController } from './controller.ts';
import { SimulatedTransport } from './simulated.ts';
import { SimulatedAnalyzer } from './analyzer.ts';
import { DEMO_SCRIPT } from './scripts/demo.ts';
import { MemoryRepo, sampleData } from '../db/memory.ts';
import { INTERVIEWERS, LPS, STORIES } from '../fixtures/sample.ts';
import type { SessionState } from '../domain/session-machine.ts';

const until = async (pred: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); }
};

function make(speed = 0.03) {
  const repo = new MemoryRepo(sampleData());
  const transport = new SimulatedTransport(DEMO_SCRIPT, { speed });
  const analyzer = new SimulatedAnalyzer(DEMO_SCRIPT, 5);
  const c = new SessionController(transport, analyzer, repo, () => Date.now(), false, { tickMs: 2 });
  const seen: string[] = [];
  let last: SessionState = c.state;
  c.subscribe((s) => { last = s; const tag = (s.pausedFrom ? 'paused:' : '') + s.phase + (s.reconnecting ? '+recon' : ''); if (seen[seen.length - 1] !== tag) seen.push(tag); });
  const start = () => c.start({ mode: 'loop', focus: null, focusLabel: '', coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, systemInstruction: '', interviewers: INTERVIEWERS, lps: LPS, stories: STORIES, pauseMs: 8, model: 'sim', voice: 'sim' });
  return { repo, transport, c, seen, state: () => last, start };
}

describe('session controller on the simulated transport', () => {
  it('plays the demo through every state to the recap and persists the session', async () => {
    const { repo, c, seen, state, start } = make();
    await start();
    await until(() => state().questionsAsked >= 1);
    expect(state().phase === 'interviewer' || state().phase === 'answering').toBe(true);
    expect(state().qText).toMatch(/found a problem/);
    expect(state().interviewer.mono).toBe('DW');
    expect(state().lpName).toBe('Dive Deep');
    await until(() => state().analysis !== null, 15000);
    expect(state().phase).toBe('coaching');
    expect(state().analysis?.verdict).toBe('not_inclined');
    await until(() => state().questionsAsked >= 2, 15000);
    expect(state().qLabel).toBe('Q2');
    expect(state().interviewer.mono).toBe('MO');
    await until(() => state().reconnecting, 15000);
    await until(() => !state().reconnecting, 15000);
    await until(() => state().answers.length >= 2, 20000);
    await c.end('Dive Deep next.');
    expect(state().phase).toBe('ended');
    expect(state().answers.map((a) => a.verdict)).toEqual(['not_inclined', 'inclined']);
    expect(seen).toContain('connecting');
    expect(seen).toContain('answering');
    expect(seen).toContain('thinking');
    expect(seen).toContain('coaching');
    expect(seen.some((s) => s.endsWith('+recon'))).toBe(true);
    const sessions = await repo.sessions();
    const mine = sessions[0];
    expect(mine.number).toBe(15);
    expect(mine.endedAt).not.toBeNull();
    const exchanges = await repo.exchanges(mine.id);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].analysis?.verdict).toBe('not_inclined');
    expect(exchanges[0].storyTitle).toBe('Payments outage');
    expect(exchanges[1].endedAt).not.toBeNull();
    const transcript = await repo.transcript(mine.id);
    expect(transcript.some((t) => t.speaker === 'me')).toBe(true);
    expect(transcript.some((t) => t.speaker === 'coach')).toBe(true);
    c.destroy();
  });

  it('pause mutes and holds; redo re-asks the same question; hint shows a story', async () => {
    const { transport, c, state, start } = make();
    await start();
    await until(() => state().phase === 'answering', 15000);
    c.pause();
    expect(state().pausedFrom).toBe('answering');
    expect(transport.sent).toContain('[PAUSE]');
    c.resume();
    expect(state().pausedFrom).toBeNull();
    c.hint();
    expect(state().hint).toBe(true);
    expect(state().hintText).toMatch(/Payments outage/);
    c.dismissHint();
    expect(state().hint).toBe(false);
    const asked = state().questionsAsked;
    c.redo();
    await until(() => state().questionsAsked > asked, 15000);
    expect(state().qText).toMatch(/found a problem/);
    expect(transport.sent).toContain('[REDO]');
    await c.end();
    c.destroy();
  });
});
