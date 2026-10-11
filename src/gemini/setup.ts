// Mock — picks the analyzer and reporter for a session. With a key: Flash, falling back to the
// offline card / local report when a call fails. Without one: the scripted cards when the
// transport replays a script (the demo), the offline card otherwise. The local report needs no key.

import type { Lp, Story } from '../domain/types.ts';
import { LocalAnalyzer, SimulatedAnalyzer, type Analyzer } from '../live/analyzer.ts';
import { LocalReporter, type Reporter } from '../live/reporter.ts';
import type { LiveScript } from '../live/script.ts';
import { FallbackAnalyzer, GeminiAnalyzer } from './analysis.ts';
import { GeminiReporter } from './report.ts';

export interface PipelineOptions {
  key: string | null;
  textModel: string;
  lps: Lp[];
  stories: Story[];
  /** The script the transport replays, when it is simulated. */
  script: LiveScript | null;
  onFallback?: (what: 'analysis' | 'report', err: Error) => void;
}

export function analysisPipeline(o: PipelineOptions): { analyzer: Analyzer; reporter: Reporter } {
  const offline: Analyzer = o.script ? new SimulatedAnalyzer(o.script) : new LocalAnalyzer(o.stories, o.lps);
  if (!o.key) return { analyzer: offline, reporter: new LocalReporter() };
  return {
    analyzer: new FallbackAnalyzer(new GeminiAnalyzer({ key: o.key, model: o.textModel, lps: o.lps, stories: o.stories }), offline, (err) => o.onFallback?.('analysis', err)),
    reporter: new GeminiReporter({ key: o.key, model: o.textModel, onFallback: (err) => o.onFallback?.('report', err) }),
  };
}
