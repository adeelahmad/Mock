// Mock — the real written analysis (plan §1 "Analysis and reports"): on exchange close the clip
// (when one exists), the exchange transcript, the coach's spoken feedback and the candidate's
// stories go to Flash with ANALYSIS_SCHEMA. Pace, duration and fillers are measured locally;
// the spoken verdict is matched locally in the coaching text first. A failed call throws, so
// the controller can surface it; `FallbackAnalyzer` turns that into a local card instead.

import type { Analysis, Lp, Story } from '../domain/types.ts';
import { measureDelivery, normalizeAnalysis } from '../domain/analysis.ts';
import type { AnalysisInput, Analyzer } from '../live/analyzer.ts';
import { ANALYSIS_SCHEMA } from './schemas.ts';
import { audioPart, generateJson, type Part } from './flash.ts';

export interface GeminiAnalyzerOptions {
  key: string;
  model: string;
  lps: Lp[];
  stories: Story[];
  fetch?: typeof fetch;
}

export const ANALYSIS_SYSTEM = [
  'You are a bar-raising interviewer writing the written feedback card for ONE behavioural answer.',
  'Judge against the area being tested (the competency or principle named below) and against the candidate\'s own prep notes (their stories and numbers).',
  'Be specific and terse. Quote numbers exactly as written in the notes. Never invent a story that is not in the list.',
  'Verdict scale: strong_hire (clear, owned, quantified, the area shows), inclined (good with gaps), not_inclined (vague, "we", no result), strong_no_hire (wrong area, no story, or a red flag).',
].join('\n');

export function storyNotes(stories: Story[]): string {
  return stories.map((s) => {
    const nums = s.numbers.map((n) => (n.label ? n.label + ': ' : '') + n.value).join('; ');
    return '<story title="' + s.title.replace(/"/g, "'") + '">' + s.summary + (nums ? '\nNumbers: ' + nums : '') + (s.result ? '\nResult: ' + s.result : '') + '</story>';
  }).join('\n');
}

export function analysisPrompt(input: AnalysisInput, lps: Lp[], stories: Story[], withAudio: boolean): string {
  const ex = input.exchange;
  const lp = lps.find((l) => l.id === ex.lpId);
  const lines = input.transcript.map((t) => (t.speaker === 'me' ? 'CANDIDATE' : t.speaker === 'coach' ? 'COACH' : 'INTERVIEWER') + ': ' + t.text.trim()).filter((l) => !/:\s*$/.test(l));
  return [
    'Question (' + ex.interviewer.name + ', ' + ex.interviewer.role + '): ' + ex.questionText,
    'Area: ' + (lp ? lp.name + ' — ' + lp.description : 'not given; infer it'),
    'Answer length: ' + Math.round(input.durationSec) + ' s.' + (withAudio ? ' The attached audio is the exchange; use it for delivery and confidence.' : ''),
    '',
    'Transcript of the exchange (the candidate\'s answer with any follow-ups, then the coach):',
    lines.join('\n') || '(empty)',
    '',
    'Coach\'s spoken feedback (extract spokenVerdict from this):',
    input.coachText.trim() || '(none)',
    '',
    'The candidate\'s stories (their prep notes):',
    storyNotes(stories) || '(no stories yet)',
  ].join('\n');
}

export class GeminiAnalyzer implements Analyzer {
  constructor(private o: GeminiAnalyzerOptions) {}
  async analyze(input: AnalysisInput): Promise<Analysis> {
    const audio = await audioPart(input.clip);
    const parts: Part[] = [{ text: analysisPrompt(input, this.o.lps, this.o.stories, !!audio) }];
    if (audio) parts.push(audio);
    const raw = await generateJson({ key: this.o.key, model: this.o.model, system: ANALYSIS_SYSTEM, parts, schema: ANALYSIS_SCHEMA, temperature: 0.2, fetch: this.o.fetch, lpId: input.exchange.lpId });
    const lpName = this.o.lps.find((l) => l.id === input.exchange.lpId)?.name ?? '';
    return normalizeAnalysis(raw, { measured: measureDelivery(input.transcript, input.durationSec), stories: this.o.stories, lpName, coachText: input.coachText });
  }
}

/** Tries the primary analyzer; on failure uses the fallback and reports why. */
export class FallbackAnalyzer implements Analyzer {
  constructor(private primary: Analyzer, private fallback: Analyzer, private onFallback?: (err: Error) => void) {}
  async analyze(input: AnalysisInput): Promise<Analysis> {
    try { return await this.primary.analyze(input); } catch (err) { this.onFallback?.(err as Error); return this.fallback.analyze(input); }
  }
}
