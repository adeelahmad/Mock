// Mock — the ✦ model answer sheet's Flash call: a STAR answer to one question, written from
// the candidate's own stories with their real numbers, reproducible from the session seed.
// Same format as the local composer (Sheets.tsx): Situation · Task · Action · Result, then
// "Why this works for {area}", under 220 words.

import type { Lp, Story } from '../domain/types.ts';
import { storyNotes } from './analysis.ts';
import { generateText } from './flash.ts';

export const MODEL_ANSWER_SYSTEM = [
  'You write model answers for behavioural interviews, in the candidate\'s voice, from THEIR stories only.',
  'Pick the story that best fits the area being tested; use its numbers exactly as written; never invent facts.',
  'Format: four short paragraphs starting "Situation — ", "Task — ", "Action — ", "Result — ", then one starting "Why this works for {area} — ".',
  'First person, "I" for what they did. Under 220 words. Plain text, no markdown.',
].join('\n');

export async function writeModelAnswer(o: { key: string; model: string; question: string; lp: Lp | null; stories: Story[]; seed: number; fetch?: typeof fetch; signal?: AbortSignal }): Promise<string> {
  const primary = o.lp ? o.stories.filter((s) => s.links.some((k) => k.lpId === o.lp!.id)) : [];
  const pool = primary.length ? primary : o.stories;
  const text = await generateText({
    key: o.key, model: o.model, system: MODEL_ANSWER_SYSTEM, seed: o.seed, temperature: 0.7, fetch: o.fetch, signal: o.signal, timeoutMs: 45000,
    parts: [{ text: ['Question: ' + o.question, 'Area: ' + (o.lp ? o.lp.name + ' — ' + o.lp.description : 'infer it'), '', 'Stories:', storyNotes(pool)].join('\n') }],
  });
  return text.trim().replace(/\*\*/g, '');
}
