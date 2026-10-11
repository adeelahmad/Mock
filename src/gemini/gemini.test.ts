import { describe, it, expect } from 'vitest';
import { generateJson, generateText, GEMINI_BASE, audioPart, INLINE_LIMIT_BYTES } from './flash.ts';
import { GeminiAnalyzer, FallbackAnalyzer } from './analysis.ts';
import { GeminiReporter } from './report.ts';
import { writeModelAnswer } from './model-answer.ts';
import { LocalAnalyzer, type AnalysisInput } from '../live/analyzer.ts';
import { LPS, STORIES, INTERVIEWERS } from '../fixtures/sample.ts';
import type { Exchange, Session } from '../domain/types.ts';

type Call = { url: string; init: RequestInit; body: Record<string, any> };
function fakeFetch(reply: unknown, status = 200): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return new Response(status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) : JSON.stringify({ error: { message: 'quota' } }), { status });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const exchange: Exchange = { id: 'e1', sessionId: 's1', index: 0, questionId: null, questionText: 'Tell me about a time you found a problem others missed.', interviewer: INTERVIEWERS[2], lpId: 'deep', storyId: null, storyTitle: null, startedAt: '', endedAt: null, startMs: 0, endMs: null, clipKey: null, analysis: null, verdict: null, isBest: false };
const input: AnalysisInput = {
  exchange,
  transcript: [{ speaker: 'interviewer', text: exchange.questionText, tMs: 0 }, { speaker: 'me', text: 'Black Friday, card auths failed for 18% of EU traffic. I traced it myself, mitigated in 41 minutes.', tMs: 2000 }],
  coachText: 'Verdict on Dive Deep: not inclined.', clip: null, durationSec: 60,
};

describe('flash REST call', () => {
  it('posts generateContent with the key header and a JSON schema', async () => {
    const { fetch, calls } = fakeFetch({ ok: true });
    const out = await generateJson({ key: 'k', model: 'gemini-3.8-flash', system: 'sys', parts: [{ text: 'hi' }], schema: { type: 'object' }, seed: 7, fetch });
    expect(out).toEqual({ ok: true });
    expect(calls[0].url).toBe(GEMINI_BASE + '/models/gemini-3.8-flash:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(calls[0].body.generationConfig).toEqual({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, seed: 7 });
    expect(calls[0].body.systemInstruction.parts[0].text).toBe('sys');
  });
  it('accepts fenced JSON and surfaces API errors', async () => {
    expect(await generateJson({ key: 'k', model: 'm', parts: [], schema: {}, fetch: fakeFetch('```json\n{"a":1}\n```').fetch })).toEqual({ a: 1 });
    await expect(generateText({ key: 'k', model: 'm', parts: [], fetch: fakeFetch('', 429).fetch })).rejects.toThrow('quota');
  });
  it('inlines small clips only', async () => {
    expect(await audioPart(null)).toBeNull();
    const p = await audioPart(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' }));
    expect(p).toEqual({ inlineData: { mimeType: 'audio/webm', data: 'AQID' } });
    expect(INLINE_LIMIT_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('Flash analysis', () => {
  it('sends the transcript and stories, and normalises the card', async () => {
    const { fetch, calls } = fakeFetch({ lp: 'Dive Deep', storyUsed: 'Payments outage', betterStory: null, numbersMissed: [{ notes: '$1.2M exposure avoided', said: 'not said' }], star: { s: 40, t: 10, a: 30, r: 20 }, iWeRatio: 0.7, delivery: { confidence: 0.6, notes: 'Calm.' }, verdict: 'inclined', spokenVerdict: 'inclined', strength: 'Named the metric.', fixes: ['Say $1.2M.'] });
    const a = await new GeminiAnalyzer({ key: 'k', model: 'gemini-3.8-flash', lps: LPS, stories: STORIES, fetch }).analyze(input);
    const prompt = calls[0].body.contents[0].parts[0].text as string;
    expect(prompt).toContain('Dive Deep — ');
    expect(prompt).toContain('CANDIDATE: Black Friday');
    expect(prompt).toContain('<story title="Payments outage">');
    expect(calls[0].body.generationConfig.responseJsonSchema.required).toContain('verdict');
    expect(a.verdict).toBe('inclined');
    expect(a.spokenVerdict).toBe('not_inclined'); // what the coach said aloud wins
    expect(a.delivery.durationSec).toBe(60);
    expect(a.storyUsed).toBe('Payments outage');
  });
  it('falls back to the offline card when Flash fails', async () => {
    const errors: string[] = [];
    const an = new FallbackAnalyzer(new GeminiAnalyzer({ key: 'k', model: 'm', lps: LPS, stories: STORIES, fetch: fakeFetch('', 500).fetch }), new LocalAnalyzer(STORIES, LPS), (e) => errors.push(e.message));
    const a = await an.analyze(input);
    expect(errors).toEqual(['quota']);
    expect(a.storyUsed).toBe('Payments outage'); // matched by its numbers (18%, 41 min)
    expect(a.verdict).toBe('not_inclined'); // the spoken verdict
    expect(a.numbersMissed.map((m) => m.notes)).toContain('$1.2M exposure avoided');
  });
});

describe('Flash report and model answer', () => {
  const session: Session = { id: 's1', number: 3, mode: 'loop', focus: null, coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1, startedAt: '', endedAt: null, recordingKey: null, recordingMime: null, report: null };
  const judged: Exchange = { ...exchange, verdict: 'not_inclined', analysis: { lp: 'Dive Deep', storyUsed: 'Payments outage', betterStory: null, numbersMissed: [], star: { s: 25, t: 25, a: 25, r: 25 }, iWeRatio: 0.5, delivery: { paceWpm: 150, paceNote: 'good', durationSec: 60, lengthNote: 'short', fillers: 0, confidence: 0.5, notes: '' }, verdict: 'not_inclined', spokenVerdict: null, strength: 'x', fixes: ['Open with the numbers.'], createdAt: '' } };
  it('writes the prose and keeps local verdicts; falls back when it fails', async () => {
    const { fetch } = fakeFetch({ summary: 'One answer, not there yet.', votes: [], improvement: '', fixes: ['Say 41 minutes first.'], storySwaps: [], nextFocus: 'Dive Deep — lead with 41 minutes.' });
    const r = await new GeminiReporter({ key: 'k', model: 'm', fetch }).report({ session, exchanges: [judged], previous: [], lps: LPS, stories: STORIES });
    expect(r.summary).toBe('One answer, not there yet.');
    expect(r.verdicts).toEqual([{ lpId: 'deep', lpName: 'Dive Deep', verdict: 'not_inclined' }]);
    expect(r.nextFocusLpId).toBe('deep');
    let failed = false;
    const r2 = await new GeminiReporter({ key: 'k', model: 'm', fetch: fakeFetch('', 500).fetch, onFallback: () => { failed = true; } }).report({ session, exchanges: [judged], previous: [], lps: LPS, stories: STORIES });
    expect(failed).toBe(true);
    expect(r2.nextFocus).toBe('Dive Deep — open with the numbers.');
  });
  it('asks for a model answer with the seed and the LP\'s stories', async () => {
    const { fetch, calls } = fakeFetch('Situation — **Black Friday**.');
    const t = await writeModelAnswer({ key: 'k', model: 'm', question: 'Q?', lp: LPS.find((l) => l.id === 'deep')!, stories: STORIES, seed: 42, fetch });
    expect(t).toBe('Situation — Black Friday.');
    expect(calls[0].body.generationConfig.seed).toBe(42);
    expect(calls[0].body.contents[0].parts[0].text).toContain('Payments outage');
    expect(calls[0].body.contents[0].parts[0].text).not.toContain('Hiring bar reset');
  });
});
