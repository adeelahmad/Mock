// Mock — read-only tools the live model calls to pull detail from the app's library mid-session:
// a story in full, more questions for an LP, and how that LP went before. The system prompt
// already carries a summary of everything; these answer "what exactly did they say last time"
// without growing the prompt. Answers come straight from the repository, so a story edited a
// minute ago is what the interviewer sees. Lookups are BLOCKING (the model waits for the answer).

import type { Repo } from '../db/repo.ts';
import type { Lp, Story } from '../domain/types.ts';
import type { ToolDeclaration } from './transport.ts';

export interface ToolHandler {
  declaration: ToolDeclaration;
  handle(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** An LP by id, exact name, or a name prefix ("Ownership", "dive deep"). */
export function findLp(lps: Lp[], q: string): Lp | null {
  const n = q.trim().toLowerCase();
  if (!n) return null;
  return lps.find((l) => l.id.toLowerCase() === n || l.name.toLowerCase() === n)
    ?? lps.find((l) => l.name.toLowerCase().startsWith(n))
    ?? lps.find((l) => n.length > 4 && l.name.toLowerCase().includes(n))
    ?? null;
}

/** A story by id, exact title, or a title fragment. */
export function findStory(stories: Story[], q: string): Story | null {
  const n = q.trim().toLowerCase();
  if (!n) return null;
  return stories.find((s) => s.id.toLowerCase() === n || s.title.toLowerCase() === n)
    ?? stories.find((s) => s.title.toLowerCase().includes(n))
    ?? null;
}

export function contextTools(repo: Repo): ToolHandler[] {
  const getStory: ToolHandler = {
    declaration: {
      name: 'get_story',
      description: 'Look up one of the candidate’s stories in full (situation, task, action, result, learning, key numbers, LP links). Use it to check what the candidate has written before probing or coaching.',
      parameters: { type: 'OBJECT', properties: { story: { type: 'STRING', description: 'The story id or title' } }, required: ['story'] },
    },
    async handle(args) {
      const [stories, lps] = await Promise.all([repo.stories(), repo.lps()]);
      const s = findStory(stories, str(args.story));
      if (!s) return { ok: false, error: 'No story matches "' + str(args.story) + '"', titles: stories.map((x) => x.title) };
      const name = (id: string) => lps.find((l) => l.id === id)?.name ?? id;
      return {
        ok: true, id: s.id, title: s.title, summary: s.summary, situation: s.situation, task: s.task, action: s.action, result: s.result, learning: s.learning,
        numbers: s.numbers.map((k) => (k.label ? k.label + ': ' + k.value : k.value)),
        lps: s.links.map((k) => name(k.lpId) + ' (' + k.role + ')'),
      };
    },
  };

  const findQuestions: ToolHandler = {
    declaration: {
      name: 'find_questions',
      description: 'Get more interview questions for a Leadership Principle from the candidate’s question bank, most-asked first. Use it when the questions in your instructions run out for that LP.',
      parameters: {
        type: 'OBJECT',
        properties: {
          lp: { type: 'STRING', description: 'The Leadership Principle, by full name' },
          not_asked: { type: 'BOOLEAN', description: 'Only questions never asked in a session' },
          limit: { type: 'INTEGER', description: 'How many (default 5, at most 15)' },
        },
        required: ['lp'],
      },
    },
    async handle(args) {
      const lp = findLp(await repo.lps(), str(args.lp));
      if (!lp) return { ok: false, error: 'Unknown Leadership Principle "' + str(args.lp) + '"' };
      const limit = Math.max(1, Math.min(15, Number(args.limit) || 5));
      const qs = await repo.questions({ lpId: lp.id, notAsked: args.not_asked === true });
      return { ok: true, lp: lp.name, questions: qs.slice(0, limit).map((q) => ({ id: q.id, text: q.text, source: q.source, times_asked: q.timesAsked, last_verdict: q.lastVerdict })) };
    },
  };

  const lpHistory: ToolHandler = {
    declaration: {
      name: 'lp_history',
      description: 'How the candidate has done on a Leadership Principle in earlier sessions: the latest answers with their verdicts, the story used and the fixes the coach gave. Use it to re-test a weak spot or avoid repeating a strong one.',
      parameters: { type: 'OBJECT', properties: { lp: { type: 'STRING', description: 'The Leadership Principle, by full name' } }, required: ['lp'] },
    },
    async handle(args) {
      const lp = findLp(await repo.lps(), str(args.lp));
      if (!lp) return { ok: false, error: 'Unknown Leadership Principle "' + str(args.lp) + '"' };
      const [sessions, exchanges] = await Promise.all([repo.sessions(), repo.exchanges()]);
      const number = new Map(sessions.map((s) => [s.id, s.number]));
      const rows = exchanges
        .filter((e) => e.lpId === lp.id && e.verdict)
        .sort((a, b) => (number.get(b.sessionId) ?? 0) - (number.get(a.sessionId) ?? 0) || b.index - a.index)
        .slice(0, 5)
        .map((e) => ({ session: number.get(e.sessionId) ?? null, question: e.questionText, verdict: e.verdict, story: e.storyTitle, fixes: e.analysis?.fixes ?? [] }));
      return { ok: true, lp: lp.name, answers: rows, never_tested: rows.length === 0 };
    },
  };

  return [getStory, findQuestions, lpHistory];
}
