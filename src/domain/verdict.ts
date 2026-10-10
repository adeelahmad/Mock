// The verdict scale as the design draws it: four colours, each with a shape; gray ○ = not yet.
import type { Verdict, VerdictCode } from './types.ts';
import { verdictCode } from './types.ts';

export interface VerdictStyle {
  code: VerdictCode;
  label: string;
  glyph: string;
  /** chip background / text / border */
  bg: string; fg: string; line: string; dash: boolean;
  /** solid fill for heat cells and the text on it */
  fill: string; onFill: string;
}

export const VERDICTS: Record<VerdictCode, VerdictStyle> = {
  0: { code: 0, label: 'Not yet', glyph: '○', bg: 'transparent', fg: 'var(--m-fg3)', line: 'var(--m-line2)', dash: true, fill: 'var(--m-elev)', onFill: 'var(--m-fg3)' },
  1: { code: 1, label: 'Strong hire', glyph: '✓', bg: 'var(--m-green-tint)', fg: 'var(--m-green)', line: 'var(--m-green-line)', dash: false, fill: 'var(--m-green-fill)', onFill: '#FFFFFF' },
  2: { code: 2, label: 'Inclined', glyph: '◆', bg: 'var(--m-blue-tint)', fg: 'var(--m-blue)', line: 'var(--m-blue-line)', dash: false, fill: 'var(--m-blue-fill)', onFill: '#FFFFFF' },
  3: { code: 3, label: 'Not inclined', glyph: '●', bg: 'var(--m-gold-tint)', fg: 'var(--m-gold)', line: 'var(--m-gold-line)', dash: false, fill: 'var(--m-gold-fill)', onFill: '#202124' },
  4: { code: 4, label: 'Strong no hire', glyph: '✕', bg: 'var(--m-red-tint)', fg: 'var(--m-red)', line: 'var(--m-red-line)', dash: false, fill: 'var(--m-red-fill)', onFill: '#FFFFFF' },
};

export const verdictStyle = (v: Verdict | VerdictCode | null | undefined): VerdictStyle =>
  VERDICTS[typeof v === 'number' ? v : verdictCode(v)];

export const verdictBorder = (s: VerdictStyle): string => (s.dash ? '1px dashed ' : '1px solid ') + s.line;

/** Points for averaging: strong hire 4 … strong no hire 1. */
export const verdictPoints = (v: Verdict): number => ({ strong_hire: 4, inclined: 3, not_inclined: 2, strong_no_hire: 1 })[v];
export const VERDICT_LABEL: Record<Verdict, string> = { strong_hire: 'Strong hire', inclined: 'Inclined', not_inclined: 'Not inclined', strong_no_hire: 'Strong no hire' };
