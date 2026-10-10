// Mock — the written analysis of one exchange. The real one (M4) sends the clip, the
// transcript and the material to a Flash model with a JSON schema. The simulated one
// returns the script's analysis after a short delay, so the live screen and History work
// end to end without an API key.

import type { Analysis, Exchange } from '../domain/types.ts';
import type { LiveScript } from './script.ts';

export interface AnalysisInput {
  exchange: Exchange;
  transcript: { speaker: 'interviewer' | 'coach' | 'me'; text: string; tMs: number }[];
  coachText: string;
  clip: Blob | null;
  durationSec: number;
}

export interface Analyzer {
  analyze(input: AnalysisInput): Promise<Analysis>;
}

export class SimulatedAnalyzer implements Analyzer {
  constructor(private script: LiveScript, private delayMs = 1200) {}
  async analyze(input: AnalysisInput): Promise<Analysis> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    const q = this.script.questions.find((x) => x.text === input.exchange.questionText) ?? this.script.questions[input.exchange.index % this.script.questions.length];
    const a = q?.analysis ?? FALLBACK;
    // Pace and duration come from timestamps, never from the model.
    const words = input.transcript.filter((t) => t.speaker === 'me').reduce((n, t) => n + t.text.split(/\s+/).length, 0);
    const durationSec = Math.max(1, Math.round(input.durationSec));
    const paceWpm = words ? Math.round(words / (durationSec / 60)) : a.delivery.paceWpm;
    return { ...a, delivery: { ...a.delivery, durationSec: input.durationSec > 0 ? durationSec : a.delivery.durationSec, paceWpm: input.durationSec > 0 && words > 20 ? paceWpm : a.delivery.paceWpm }, createdAt: new Date().toISOString() };
  }
}

const FALLBACK: Analysis = {
  lp: '', storyUsed: null, betterStory: null, numbersMissed: [], star: { s: 25, t: 20, a: 35, r: 20 }, iWeRatio: 0.5,
  delivery: { paceWpm: 150, paceNote: 'good', durationSec: 0, lengthNote: 'good', fillers: 0, confidence: 0.5, notes: '' },
  verdict: 'inclined', spokenVerdict: null, strength: '', fixes: [], createdAt: '',
};
