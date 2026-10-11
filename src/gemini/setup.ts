// Mock — picks the analyzer and reporter for a session. With a key: Flash (or the session's
// OpenAI-compatible model when it uses one), falling back to the offline card / local report
// when a call fails. Without one: the scripted cards when the transport replays a script (the
// demo), the offline card otherwise. The local report needs no key.

import type { Lp, Story } from '../domain/types.ts';
import { LocalAnalyzer, SimulatedAnalyzer, type Analyzer } from '../live/analyzer.ts';
import { LocalReporter, type Reporter } from '../live/reporter.ts';
import type { LiveScript } from '../live/script.ts';
import { FallbackAnalyzer, GeminiAnalyzer } from './analysis.ts';
import { GeminiReporter } from './report.ts';
import type { TextLlm } from '../llm/chat.ts';

export interface PipelineOptions {
  key: string | null;
  textModel: string;
  lps: Lp[];
  stories: Story[];
  /** The script the transport replays, when it is simulated. */
  script: LiveScript | null;
  onFallback?: (what: 'analysis' | 'report', err: Error) => void;
  /** The session's model when it is not Gemini (an OpenAI-compatible endpoint): it writes the cards and the report. */
  llm?: TextLlm | null;
}

export function analysisPipeline(o: PipelineOptions): { analyzer: Analyzer; reporter: Reporter } {
  const offline: Analyzer = o.script ? new SimulatedAnalyzer(o.script) : new LocalAnalyzer(o.stories, o.lps);
  if (!o.key && !o.llm) return { analyzer: offline, reporter: new LocalReporter() };
  const key = o.key ?? '', llm = o.llm ?? null;
  return {
    analyzer: new FallbackAnalyzer(new GeminiAnalyzer({ key, model: o.textModel, lps: o.lps, stories: o.stories, llm }), offline, (err) => o.onFallback?.('analysis', err)),
    reporter: new GeminiReporter({ key, model: o.textModel, llm, onFallback: (err) => o.onFallback?.('report', err) }),
  };
}
