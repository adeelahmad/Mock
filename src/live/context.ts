// Mock — fills prompts/coach.md for one session. M1 ships the template fill and the tag
// wrappers; M3 adds token counting against the live model and the trim ladder
// (old reports → low-priority questions → long files), with tests.

import coachTemplate from '../../prompts/coach.md?raw';
import type { Coaching, Lp, Mode, PrepFile, Question, QuestionSourceSetting, Report, Session, Story } from '../domain/types.ts';

export interface ContextInput {
  sessionNumber: number;
  date: string;
  mode: Mode;
  focus: string;
  coaching: Coaching;
  questionSource: QuestionSourceSetting;
  previous: { session: Session; report: Report }[];
  lps: Lp[];
  stories: Story[];
  questions: Question[];
  files: PrepFile[];
  /** Appended after the template: the user's own system instruction from Settings. */
  userInstruction?: string;
}

export interface BuiltContext { text: string; estimatedTokens: number; trimmed: string[] }

const esc = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');

export function renderPrevious(previous: ContextInput['previous']): string {
  if (!previous.length) return '(none — this is session 1)';
  return previous.map(({ session, report }, i) => {
    const head = `<session number="${session.number}" mode="${session.mode}" date="${session.startedAt.slice(0, 10)}">`;
    if (i < 3) {
      const verdicts = report.verdicts.map((v) => `${v.lpName}: ${v.verdict}`).join('; ');
      return `${head}\nVerdicts: ${verdicts}\nImprovement: ${esc(report.improvement)}\nFixes: ${report.fixes.map(esc).join(' | ')}\nStory swaps: ${report.storySwaps.map((s) => `${s.lpName} → ${s.useStory}${s.insteadOf ? ' (instead of ' + s.insteadOf + ')' : ''}`).join('; ') || 'none'}\nNext focus: ${esc(report.nextFocus)}\n</session>`;
    }
    return `${head} ${esc(report.summary || report.nextFocus)} </session>`;
  }).join('\n');
}

export const renderLps = (lps: Lp[]): string => lps.map((l) => `<lp id="${l.id}">${esc(l.name)} — ${esc(l.description)}</lp>`).join('\n');

export const renderStories = (stories: Story[], lps: Lp[]): string => stories.map((s) => {
  const name = (id: string) => lps.find((l) => l.id === id)?.name ?? id;
  const links = s.links.map((k) => `${name(k.lpId)} (${k.role})`).join(', ');
  const nums = s.numbers.map((n) => (n.label ? `${n.label}: ${n.value}` : n.value)).join(' · ');
  const star = ['situation', 'task', 'action', 'result', 'learning'].filter((k) => (s as unknown as Record<string, string>)[k]).map((k) => `${k[0].toUpperCase() + k.slice(1)}: ${esc((s as unknown as Record<string, string>)[k])}`).join('\n');
  return `<story id="${s.id}" title="${esc(s.title)}">\nSummary: ${esc(s.summary)}\nLPs: ${links || 'unmapped'}\nKey numbers: ${nums || 'none recorded'}\n${star}\n</story>`;
}).join('\n');

export const renderQuestions = (questions: Question[], lps: Lp[]): string => questions.map((q) => {
  const lp = q.lpIds[0] ? (lps.find((l) => l.id === q.lpIds[0])?.name ?? q.lpIds[0]) : 'untagged';
  return `<question id="${q.id}" lp="${esc(lp)}" source="${q.source}">${esc(q.text)}</question>`;
}).join('\n');

export const renderFiles = (files: PrepFile[]): string => files.filter((f) => f.included).map((f) => `<file name="${esc(f.name)}" type="${f.type}">\n${esc(f.summary ?? f.content)}\n</file>`).join('\n') || '(no files included)';

/** Rough token estimate: 4 characters per token for English prose. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Questions for this mode in priority order: previous-interview questions first, then the
 * weakest LPs (by the order given), then never-asked, then the rest; stable within groups.
 */
export function prioritiseQuestions(questions: Question[], opts: { mode: Mode; focusLpId?: string | null; weakLpIds: string[]; limit?: number }): Question[] {
  let qs = questions.slice();
  if (opts.mode === 'lp' && opts.focusLpId) qs = qs.filter((q) => q.lpIds.includes(opts.focusLpId!));
  const rank = (q: Question): number => {
    if (q.source === 'previous') return 0;
    const w = q.lpIds.findIndex((id) => opts.weakLpIds.includes(id));
    if (w >= 0) return 1;
    if (q.timesAsked === 0) return 2;
    return 3;
  };
  const weakIndex = (q: Question) => Math.min(...q.lpIds.map((id) => { const i = opts.weakLpIds.indexOf(id); return i < 0 ? 99 : i; }), 99);
  qs.sort((a, b) => rank(a) - rank(b) || weakIndex(a) - weakIndex(b) || b.votes - a.votes);
  return qs.slice(0, opts.limit ?? 40);
}

export function buildContext(input: ContextInput): BuiltContext {
  const fill: Record<string, string> = {
    SESSION_NUMBER: String(input.sessionNumber), DATE: input.date, MODE: input.mode, FOCUS: input.focus || 'none', COACHING: input.coaching, QUESTION_SOURCE: input.questionSource,
    PREVIOUS_SESSIONS: renderPrevious(input.previous), LPS: renderLps(input.lps), STORIES: renderStories(input.stories, input.lps), QUESTIONS: renderQuestions(input.questions, input.lps), FILES: renderFiles(input.files),
  };
  let text = coachTemplate.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => fill[k] ?? '');
  if (input.userInstruction?.trim()) text += '\n\n## Candidate’s own instruction\n' + input.userInstruction.trim() + '\n';
  return { text, estimatedTokens: estimateTokens(text), trimmed: [] };
}
