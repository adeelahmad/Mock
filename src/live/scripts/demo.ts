// The design's self-playing demo: two questions, Dana then Marcus, start to recap.
import type { LiveScript } from '../script.ts';

const now = '2026-10-10T09:41:00.000Z';

export const DEMO_SCRIPT: LiveScript = {
  sessionNumber: 14,
  mode: 'loop',
  opening: 'Session fourteen. Last time the gap was the numbers on Dive Deep, so we start there.',
  focus: 'Dive Deep — quantify the blast radius before you describe the fix.',
  recap: 'Pausing the interview. Dive Deep: not inclined. Bias for Action: inclined. Biggest improvement: you own the decisions now. Top fixes: open with the numbers, cut the setup, name the trip-wire. Next session: Dive Deep again, numbers first. Back to the interview.',
  questions: [
    {
      id: 'q3',
      interviewer: { n: 3, name: 'Dana Whitfield', role: 'Bar Raiser', mono: 'DW' },
      lp: 'Dive Deep',
      text: 'Tell me about a time you found a problem that others had missed. How did you find it?',
      answer: 'Sure. Black Friday week, 7:40 in the morning — card authorisations started failing for about 18% of EU traffic. On-call assumed the provider.',
      answerMs: 7000,
      followUps: [
        { ask: 'What made you look at the config path rather than the provider?', answer: 'Two things. Their status page was green, and the error rate stepped up exactly on a deploy boundary.' },
        { ask: 'How long until it was mitigated?', answer: 'Under an hour. Forty-something minutes.' },
      ],
      coaching: [
        'Pausing the interview. ',
        'One strength: you named the exact failing component and the metric you watched while fixing it. ',
        'Fix one: open with the numbers — forty-one minutes, one point two million. ',
        'Fix two: cut the setup to two sentences; the room knows what Black Friday is. ',
        'Fix three: say what you personally did in the first ten minutes. ',
        'Verdict on Dive Deep: not inclined. Redo it with the numbers first? Back to the interview.',
      ],
      analysis: {
        lp: 'Dive Deep', storyUsed: 'Payments outage',
        betterStory: { storyId: 'migration', title: 'Legacy data migration', reason: 'It shows you tracing the root cause yourself, not delegating the trace.' },
        numbersMissed: [{ notes: '41 min to mitigate', said: '“under an hour”' }, { notes: '$1.2M exposure avoided', said: '“significant”' }, { notes: '0 repeats in 6 months', said: 'not mentioned' }],
        star: { s: 35, t: 10, a: 40, r: 15 }, iWeRatio: 0.38,
        delivery: { paceWpm: 168, paceNote: 'fast', durationSec: 252, lengthNote: 'long', fillers: 11, confidence: 0.55, notes: 'Buried the result; two long hesitations before the number.' },
        verdict: 'not_inclined', spokenVerdict: 'not_inclined',
        strength: 'You named the exact failing component and the metric you watched while fixing it.',
        fixes: ['Open with the numbers: 41 minutes, $1.2M.', 'Cut the setup to two sentences — the room knows what Black Friday is.', 'Say what you personally did in the first ten minutes.'],
        createdAt: now,
      },
      hint: 'Try the Payments outage story — 41 min, $1.2M.',
      notes: [{ t: 'Payments outage', n: '41 min · $1.2M · 0 repeats' }, { t: 'Legacy data migration', n: '14 TB · 6h → 40 min' }, { t: 'Observability cost cut', n: '−38% · $610k/yr' }],
    },
    {
      id: 'q1',
      interviewer: { n: 4, name: 'Marcus Oyelaran', role: 'Skip-level', mono: 'MO' },
      lp: 'Bias for Action',
      text: 'Tell me about a time you made a decision without all the data you wanted.',
      answer: 'The fraud-rules MVP. We had a 30% data sample and a quarter-long wait for the rest.',
      answerMs: 6000,
      followUps: [{ ask: 'What would have changed your mind?', answer: 'A false-positive rate above five percent in the first week. We set that as the trip-wire.' }],
      coaching: [
        'Pausing the interview. ',
        'Strength: clear framing of what was reversible and what wasn’t. ',
        'Fix one: quantify the result — minus twenty-two percent false positives. ',
        'Fix two: name the risk you accepted and the trip-wire you set. ',
        'Verdict on Bias for Action: inclined. Back to the interview.',
      ],
      analysis: {
        lp: 'Bias for Action', storyUsed: 'Launch under ambiguity', betterStory: null,
        numbersMissed: [{ notes: 'False positives −22%', said: '“fewer false positives”' }],
        star: { s: 20, t: 15, a: 45, r: 20 }, iWeRatio: 0.61,
        delivery: { paceWpm: 142, paceNote: 'good', durationSec: 168, lengthNote: 'good', fillers: 4, confidence: 0.75, notes: '' },
        verdict: 'inclined', spokenVerdict: 'inclined',
        strength: 'Clear framing of what was reversible and what wasn’t.',
        fixes: ['Quantify the result: −22% false positives.', 'Name the risk you accepted and the trip-wire you set.'],
        createdAt: now,
      },
      hint: 'Launch under ambiguity — lead with the 30% sample.',
      notes: [{ t: 'Launch under ambiguity', n: '30% sample · 5 wks · −22% FP' }, { t: 'Payments outage', n: '41 min · $1.2M · 0 repeats' }],
    },
  ],
  reconnectDuring: 1,
};
