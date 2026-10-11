// Mock — the Flash session report: the cards and earlier verdicts go in, the prose comes back
// with REPORT_SCHEMA and is merged onto the local report (normalizeReport), so the verdicts
// stay arithmetic. Any failure falls back to the local report.

import type { Report } from '../domain/types.ts';
import { localReport, normalizeReport, type ReportInput } from '../domain/report.ts';
import { VERDICT_LABEL } from '../domain/verdict.ts';
import type { Reporter } from '../live/reporter.ts';
import { REPORT_SCHEMA } from './schemas.ts';
import { generateJson } from './flash.ts';
import type { TextLlm } from '../llm/chat.ts';

export const REPORT_SYSTEM = 'You are the debrief lead of an interview loop writing the session report for the candidate. Be specific to their answers and their own stories; terse, imperative fixes; no generic advice.';

export function reportPrompt(input: ReportInput): string {
  const base = localReport(input);
  const lpName = (id: string | null, fallback: string) => input.lps.find((l) => l.id === id)?.name ?? fallback;
  const answers = input.exchanges.map((e, i) => {
    const a = e.analysis;
    return ['Q' + (i + 1) + ' · ' + e.interviewer.name + ' (' + e.interviewer.role + ') · ' + lpName(e.lpId, a?.lp ?? '') + ' · ' + (e.verdict ? VERDICT_LABEL[e.verdict] : 'not judged'),
      '  Question: ' + e.questionText,
      a ? '  Story: ' + (e.storyTitle ?? a.storyUsed ?? 'none') + (a.betterStory ? ' (better: ' + a.betterStory.title + ' — ' + a.betterStory.reason + ')' : '') : '',
      a?.numbersMissed.length ? '  Numbers missed: ' + a.numbersMissed.map((m) => m.notes).join('; ') : '',
      a ? '  Strength: ' + a.strength : '',
      a?.fixes.length ? '  Fixes: ' + a.fixes.join(' | ') : ''].filter(Boolean).join('\n');
  });
  const history = input.previous.slice(0, 5).map((p) => 'Session ' + p.session.number + ': ' + p.exchanges.filter((e) => e.verdict).map((e) => lpName(e.lpId, e.analysis?.lp ?? '?') + ' ' + VERDICT_LABEL[e.verdict!]).join(', '));
  return [
    'Session ' + input.session.number + ' answers:', answers.join('\n') || '(none)', '',
    'Votes (fixed — write only the reasons): ' + base.votes.map((v) => v.interviewer.name + ' ' + VERDICT_LABEL[v.verdict]).join('; '), '',
    'Earlier sessions (newest first):', history.join('\n') || '(none — this is the first)', '',
    'Their stories: ' + input.stories.map((s) => s.title).join('; '),
  ].join('\n');
}

export class GeminiReporter implements Reporter {
  constructor(private o: { key: string; model: string; fetch?: typeof fetch; onFallback?: (err: Error) => void; llm?: TextLlm | null }) {}
  async report(input: ReportInput): Promise<Report> {
    if (!input.exchanges.some((e) => e.verdict)) return localReport(input);
    try {
      const raw = await generateJson({ key: this.o.key, model: this.o.model, system: REPORT_SYSTEM, parts: [{ text: reportPrompt(input) }], schema: REPORT_SCHEMA, temperature: 0.3, fetch: this.o.fetch, via: this.o.llm });
      return normalizeReport(raw, input);
    } catch (err) {
      this.o.onFallback?.(err as Error);
      return localReport(input);
    }
  }
}
