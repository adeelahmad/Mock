// Mock — "Answer it for me": the best story for a question, told as the candidate. Searches the
// uploaded prep files (the knowledge index) and weighs the passages against the story library,
// then a language model writes the story card (shown large on the screen) and the words to say.
// Without a model (no key, a failed call) the library story that shares the most words with the
// question is used as it is.

import type { ChatModel } from '../llm/chat.ts';
import { parseJsonReply } from '../llm/chat.ts';
import { reportUsage } from '../gemini/usage.ts';
import { contentWords } from '../domain/canvas.ts';
import type { Hit } from '../rag/knowledge.ts';
import type { KeyNumber, Lp, Story } from '../domain/types.ts';
import type { StoryCard } from './controller.ts';

export interface AnswerInput {
  question: string;
  /** The area the question tests, by name, when known. */
  lp?: string;
  lps: Lp[];
  stories: Story[];
  model: ChatModel | null;
  search?: ((query: string, k: number) => Promise<Hit[]>) | null;
  signal?: AbortSignal;
}

export interface Answered { card: StoryCard; spoken: string; by: 'ai' | 'local'; error?: string }

const SYSTEM = `You answer an interview question as the candidate, in the first person, from their own material only.
Pick the single best story for the question: from their story library, or built from the passages of their uploaded files. Prefer the one with the strongest, most specific result and numbers. Never invent a project, number, employer or outcome.
Reply with JSON only:
{"title":"short story title","lp":"area it answers","headline":"one decisive sentence, result first","situation":"one or two short sentences","action":"what I did: key decisions, one to three short sentences","result":"the result with numbers","learning":"one sentence","numbers":["label: value"],"source":"Your stories, or the file name","spoken":"the answer as I would say it out loud: 60 to 120 seconds, first person, situation briefly, mostly my actions, the result with the numbers, one line of learning"}`;

const storyBlock = (s: Story, lps: Lp[]): string => {
  const areas = s.links.map((l) => lps.find((x) => x.id === l.lpId)?.name ?? l.lpId).join(', ');
  const nums = s.numbers.map((n) => (n.label ? n.label + ': ' + n.value : n.value)).join('; ');
  return `<story title="${s.title}" areas="${areas}">Situation: ${s.situation} Task: ${s.task} Action: ${s.action} Result: ${s.result} Learning: ${s.learning} Numbers: ${nums}</story>`;
};

/** The library story closest to the question: shared words, plus the area it tests. */
export function closestStory(question: string, lp: string | undefined, lps: Lp[], stories: Story[]): Story | null {
  const q = new Set(contentWords(question + ' ' + (lp ?? '')));
  const area = lp ? lps.find((l) => l.name.toLowerCase() === lp.toLowerCase() || l.id === lp) : undefined;
  let best: Story | null = null, top = -1;
  for (const s of stories) {
    const linked = area ? s.links.find((l) => l.lpId === area.id) : undefined;
    const names = s.links.map((l) => { const x = lps.find((y) => y.id === l.lpId); return x ? x.name + ' ' + x.description : ''; }).join(' ');
    const words = contentWords([s.title, s.summary, s.situation, s.task, s.action, s.result, names].join(' '));
    const score = words.filter((w) => q.has(w)).length + (linked ? (linked.role === 'primary' ? 6 : 3) : 0) + (s.numbers.length ? 1 : 0);
    if (score > top) { top = score; best = s; }
  }
  return best;
}

export function cardOf(s: Story, lp: string, lps: Lp[]): StoryCard {
  const area = lp || lps.find((l) => l.id === s.links[0]?.lpId)?.name || '';
  return { title: s.title, lp: area, headline: s.summary, situation: s.situation, action: s.action, result: s.result, learning: s.learning, numbers: s.numbers, source: 'Your stories' };
}

/** What to say for a library story with no model to write it. */
export function spokenOf(s: Story): string {
  return [s.situation, s.task, s.action, s.result, s.learning].filter(Boolean).join(' ');
}

const splitNumber = (x: string): KeyNumber => { const i = x.indexOf(':'); return i > 0 ? { label: x.slice(0, i).trim(), value: x.slice(i + 1).trim() } : { label: '', value: x.trim() }; };

export async function answerAs(o: AnswerInput): Promise<Answered | null> {
  const fallback = closestStory(o.question, o.lp, o.lps, o.stories);
  const local = (error?: string): Answered | null => (fallback ? { card: cardOf(fallback, o.lp ?? '', o.lps), spoken: spokenOf(fallback), by: 'local', error } : null);
  if (!o.model) return local();
  let hits: Hit[] = [];
  try { hits = o.search ? await o.search(o.question + (o.lp ? ' (' + o.lp + ')' : ''), 5) : []; } catch { hits = []; }
  const material = [
    'Question: ' + o.question,
    o.lp ? 'Area it tests: ' + o.lp : '',
    'Story library:\n' + (o.stories.map((s) => storyBlock(s, o.lps)).join('\n') || '(empty)'),
    hits.length ? 'Passages from uploaded files:\n' + hits.map((h) => `<passage file="${h.fileName}"${h.heading ? ' section="' + h.heading + '"' : ''}>${h.text}</passage>`).join('\n') : 'No uploaded file passages.',
  ].filter(Boolean).join('\n\n');
  try {
    const reply = await o.model.complete({ system: SYSTEM, turns: [{ role: 'user', text: material }], tools: [], temperature: 0.2, signal: o.signal });
    if (reply.usage) reportUsage(o.model.model, null, reply.usage);
    const j = parseJsonReply<Record<string, unknown>>(reply.text);
    const s = (k: string): string => (typeof j[k] === 'string' ? (j[k] as string).trim() : '');
    if (!s('title') || !(s('result') || s('spoken'))) return local('unexpected reply');
    const nums = Array.isArray(j.numbers) ? (j.numbers as unknown[]).map((x) => String(x)).filter((x) => x.trim()).map(splitNumber) : [];
    const card: StoryCard = { title: s('title'), lp: s('lp') || o.lp || '', headline: s('headline'), situation: s('situation'), action: s('action'), result: s('result'), learning: s('learning'), numbers: nums, source: s('source') };
    return { card, spoken: s('spoken') || [card.situation, card.action, card.result, card.learning].filter(Boolean).join(' '), by: 'ai' };
  } catch (err) {
    if (o.signal?.aborted) throw err;
    return local((err as Error).message || 'failed');
  }
}
