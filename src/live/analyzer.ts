// Mock — the written analysis of one exchange. The real one (gemini/analysis.ts) sends the
// clip, the transcript and the material to a Flash model with a JSON schema. The simulated one
// returns the script's analysis after a short delay, so the live screen and History work
// end to end without an API key.

import type { Analysis, Exchange, Lp, Story } from '../domain/types.ts';
import { extractSpokenVerdict, measureDelivery, normalizeAnalysis } from '../domain/analysis.ts';
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

/**
 * The offline card: no model, only what the app can measure or match — pace, length and
 * fillers from the timestamps, "I" vs "we" from the words, the story by its title or numbers,
 * the numbers from its notes that were never said, and the coach's spoken verdict. Used when
 * there is no key or the Flash call fails, so every exchange still gets a card.
 */
export class LocalAnalyzer implements Analyzer {
  constructor(private stories: Story[], private lps: Lp[]) {}
  async analyze(input: AnalysisInput): Promise<Analysis> {
    const mine = input.transcript.filter((t) => t.speaker === 'me').map((t) => t.text).join(' ');
    const low = mine.toLowerCase();
    const i = (low.match(/\b(i|i'm|i've|i'd|my|me)\b/g) ?? []).length;
    const we = (low.match(/\b(we|we're|we've|our|us)\b/g) ?? []).length;
    const digits = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []);
    const said = new Set(digits(mine));
    const score = (s: Story) => (low.includes(s.title.toLowerCase()) ? 10 : 0) + s.numbers.filter((n) => digits(n.value).some((d) => said.has(d))).length;
    const used = this.stories.map((s) => [s, score(s)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const lpName = this.lps.find((l) => l.id === input.exchange.lpId)?.name ?? '';
    const missed = used ? used.numbers.filter((n) => !digits(n.value).some((d) => said.has(d))).slice(0, 3).map((n) => ({ notes: n.value, said: 'not said' })) : [];
    const spoken = extractSpokenVerdict(input.coachText);
    const fixes = [
      missed.length ? 'Say ' + missed[0].notes + ' — it is in your notes.' : '',
      i < we ? 'Say “I” for what you did; keep “we” for the team’s part.' : '',
      !used ? 'Anchor the answer in one of your prepared stories.' : '',
    ].filter(Boolean);
    return normalizeAnalysis({
      lp: lpName, storyUsed: used?.title ?? null, betterStory: null, numbersMissed: missed,
      star: { s: 25, t: 15, a: 40, r: 20 }, iWeRatio: i + we ? i / (i + we) : 0.5,
      delivery: { confidence: 0.5, notes: '' },
      verdict: spoken ?? (used && !missed.length ? 'inclined' : 'not_inclined'),
      strength: used ? 'You used a real story: ' + used.title + '.' : '',
      fixes,
    }, { measured: measureDelivery(input.transcript, input.durationSec), stories: this.stories, lpName, coachText: input.coachText });
  }
}
