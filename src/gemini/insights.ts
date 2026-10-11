// Mock — the Flash calls behind transcript insights: one request reads the tone of every line
// in a session (cached per session by the caller), and ✦ Ask AI rewrites ONE of the
// candidate's lines, either as a stronger telling of the same story or with the better story
// from their own library. Never invents facts: numbers come from their stories only.

import type { Lp, Story, TranscriptEvent } from '../domain/types.ts';
import { normalizeSentiment, type RewriteKind, type Sentiment } from '../domain/insights.ts';
import { storyNotes } from './analysis.ts';
import { generateJson, generateText } from './flash.ts';

export const SENTIMENT_SYSTEM = [
  'You read the emotional tone of each line of a mock behavioural interview transcript.',
  'For every numbered line return: label (positive | neutral | negative), score from -1 to 1, and tone — ONE lowercase word for how it comes across (e.g. confident, hesitant, defensive, frustrated, encouraging, critical, curious, warm, rambling).',
  'Judge how the speaker sounds, not whether the story itself is about a problem: a calm, owned account of a conflict is positive or neutral.',
].join('\n');

const SENTIMENT_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, label: { type: 'string', enum: ['positive', 'neutral', 'negative'] }, score: { type: 'number' }, tone: { type: 'string' } }, required: ['i', 'label', 'score', 'tone'] } } },
  required: ['lines'],
};

const WHO = { me: 'CANDIDATE', coach: 'COACH', interviewer: 'INTERVIEWER' } as const;
export const MAX_SENTIMENT_LINES = 240;

export async function readSentiment(o: { key: string; model: string; events: TranscriptEvent[]; fetch?: typeof fetch; signal?: AbortSignal }): Promise<Record<string, Sentiment>> {
  const ev = o.events.filter((t) => t.text.trim()).slice(0, MAX_SENTIMENT_LINES);
  if (!ev.length) return {};
  const lines = ev.map((t, i) => i + ' ' + WHO[t.speaker] + ': ' + t.text.trim().replace(/\s+/g, ' ').slice(0, 700));
  const raw = await generateJson<{ lines?: unknown[] }>({ key: o.key, model: o.model, system: SENTIMENT_SYSTEM, schema: SENTIMENT_SCHEMA, temperature: 0.1, fetch: o.fetch, signal: o.signal, timeoutMs: 45000, parts: [{ text: lines.join('\n') }] });
  const out: Record<string, Sentiment> = {};
  for (const x of raw?.lines ?? []) {
    const i = Number((x as { i?: unknown })?.i);
    const s = normalizeSentiment(x);
    if (s && Number.isInteger(i) && ev[i]) out[ev[i].id] = s;
  }
  return out;
}

export const REWRITE_SYSTEM = [
  'You coach a candidate for a behavioural interview. You rewrite ONE thing they said into what they should have said, in their voice: first person, "I" for what they did.',
  'Use only facts from what they said and from THEIR stories below; use the stories\' numbers exactly as written; never invent facts, names or numbers.',
  'Shape: Situation, Task, Action, Result — four short paragraphs starting "Situation — ", "Task — ", "Action — ", "Result — ". Under 200 words. Plain text, no markdown.',
].join('\n');

export function rewritePrompt(o: { kind: RewriteKind; line: string; question: string; lp: Lp | null; stories: Story[]; previous: string[] }): string {
  const ask = o.kind === 'improve'
    ? 'Rewrite their answer as a stronger telling of the SAME story: sharper "I" statements, the reasoning and the result made explicit, the numbers from the matching story added if they fit, filler and repetition gone.'
    : 'Pick the story from their library that best answers this question for this area (it may be a different one from what they told) and tell it. Start with one line "Story: {title}" before the four paragraphs.';
  return [
    'Question: ' + (o.question || '(unknown — infer it from the answer)'),
    'Area: ' + (o.lp ? o.lp.name + ' — ' + o.lp.description : 'infer it'),
    '',
    'What they said:',
    '"""' + o.line.trim() + '"""',
    '',
    ask,
    o.previous.length ? '\nDo not repeat these earlier versions; take a different angle:\n' + o.previous.map((p, i) => '<version ' + (i + 1) + '>' + p.slice(0, 900) + '</version>').join('\n') : '',
    '',
    'Their stories:',
    storyNotes(o.stories) || '(no stories yet — work from what they said)',
  ].join('\n');
}

export async function rewriteLine(o: { key: string; model: string; kind: RewriteKind; line: string; question: string; lp: Lp | null; stories: Story[]; previous: string[]; fetch?: typeof fetch; signal?: AbortSignal }): Promise<string> {
  const primary = o.lp ? o.stories.filter((s) => s.links.some((k) => k.lpId === o.lp!.id)) : [];
  const stories = o.kind === 'story' && primary.length ? primary : o.stories;
  const text = await generateText({ key: o.key, model: o.model, system: REWRITE_SYSTEM, temperature: o.previous.length ? 0.9 : 0.6, fetch: o.fetch, signal: o.signal, timeoutMs: 45000, lpId: o.lp?.id ?? null, parts: [{ text: rewritePrompt({ ...o, stories }) }] });
  return text.trim().replace(/\*\*/g, '');
}
