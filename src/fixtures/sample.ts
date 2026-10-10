// Mock — sample content for development and tests. Realistic, invented; no Amazon text is
// quoted. The 16 LPs (names + one-line descriptions in our own words) are also the
// production seed; everything else here is dev-only (plan D3).

import type { Analysis, Exchange, Interviewer, Lp, PrepFile, Question, Session, Settings, Story, TranscriptEvent, Verdict } from '../domain/types.ts';
import { CODE_VERDICT } from '../domain/types.ts';

const T0 = Date.UTC(2026, 8, 27, 9, 0); // Sun 27 Sep 2026
const iso = (d: number, h = 9) => new Date(Date.UTC(2026, 8, 27) + d * 86400000 + h * 3600000).toISOString();
void T0;

export const LPS: Lp[] = [
  ['co', 'Customer Obsession', 'CO', 'Start from the customer and work backwards. Earn and keep their trust; watch competitors, but obsess over customers.'],
  ['own', 'Ownership', 'OW', 'Think long term and act for the whole company, not just your team. Never say “that’s not my job”.'],
  ['inv', 'Invent and Simplify', 'IS', 'Expect invention from your team and look for ways to simplify. Accept being misunderstood for a while.'],
  ['right', 'Are Right, A Lot', 'RL', 'Good judgement and strong instincts, with the humility to seek out different views and change your mind.'],
  ['learn', 'Learn and Be Curious', 'LC', 'Never stop learning; stay curious about new possibilities and act on them.'],
  ['hire', 'Hire and Develop the Best', 'HD', 'Raise the bar with every hire and promotion. Recognise exceptional talent and coach people seriously.'],
  ['std', 'Insist on the Highest Standards', 'HS', 'Relentlessly high standards that others may find unreasonable. Defects don’t get sent down the line.'],
  ['big', 'Think Big', 'TB', 'Thinking small is a self-fulfilling prophecy. Set a bold direction that inspires results.'],
  ['bias', 'Bias for Action', 'BA', 'Speed matters. Many decisions are reversible and don’t need extensive study; take calculated risks.'],
  ['frugal', 'Frugality', 'FR', 'Accomplish more with less. Constraints breed resourcefulness and invention.'],
  ['trust', 'Earn Trust', 'ET', 'Listen attentively, speak candidly, treat others respectfully. Be vocally self-critical.'],
  ['deep', 'Dive Deep', 'DD', 'Operate at all levels, stay connected to the details, audit often and be sceptical when metrics and anecdotes differ.'],
  ['back', 'Have Backbone; Disagree and Commit', 'HB', 'Challenge decisions you disagree with, respectfully and tenaciously. Once decided, commit wholly.'],
  ['deliver', 'Deliver Results', 'DR', 'Focus on the key inputs and deliver with the right quality and on time. Never settle, despite setbacks.'],
  ['employer', 'Strive to be Earth’s Best Employer', 'BE', 'Create a safer, more productive, more diverse and just work environment. Lead with empathy.'],
  ['scale', 'Success and Scale Bring Broad Responsibility', 'SS', 'Be humble and thoughtful about the secondary effects of your actions; leave things better than you found them.'],
].map(([id, name, short, description], i) => ({ id, name, short, description, order: i, isDefault: true }));

export const lpById = Object.fromEntries(LPS.map((l) => [l.id, l])) as Record<string, Lp>;
export const lpByName = (name: string): Lp | undefined => LPS.find((l) => l.name.toLowerCase() === name.toLowerCase());

const story = (id: string, title: string, summary: string, numbers: string[], primary: string[], secondary: string[], extra: Partial<Story> = {}): Story => ({
  id, title, summary, situation: '', task: '', action: '', result: '', learning: '',
  numbers: numbers.map((value) => ({ label: '', value })),
  links: [...primary.map((lpId) => ({ lpId, role: 'primary' as const })), ...secondary.map((lpId) => ({ lpId, role: 'secondary' as const }))],
  createdAt: iso(-30), updatedAt: iso(-2), ...extra,
});

export const STORIES: Story[] = [
  story('payments', 'Payments outage', 'Led a Sev-1 recovery on the card-payments path during Black Friday week.', ['41 min to mitigate', '$1.2M exposure avoided', '0 repeats in 6 months'], ['deep'], ['own', 'bias', 'trust'], {
    situation: 'Black Friday week, 07:40. Card authorisations started failing for ~18% of EU traffic. The on-call engineer suspected the payment provider; dashboards disagreed.',
    task: 'As the owning SDM I had to restore authorisations before the 09:00 traffic peak and keep leadership informed without pulling engineers off the fix.',
    action: 'I split the room: two engineers bisected the last three deploys while I traced the failing auth path myself and found a retry storm from a config change. Rolled it back, added a kill switch.',
    result: 'Mitigated in 41 minutes, roughly $1.2M of exposure avoided. Shipped a retry budget and a canary for config; zero repeats in six months.',
    learning: 'Audit the boring config path first. Say the number before the narrative.',
  }),
  story('migration', 'Legacy data migration', 'Moved 220 tables and 14 TB off a dying Oracle cluster with zero customer downtime.', ['14 TB · 220 tables', 'Nightly batch 6h → 40 min', '0 min downtime'], ['std'], ['deliver', 'deep']),
  story('rebuild', 'Platform rebuild', 'Rebuilt merchant onboarding as a self-serve platform with a team of 8.', ['Onboarding 3 weeks → 2 days', '8 engineers', '+31% activation'], ['inv'], ['deliver', 'hire']),
  story('vendor', 'Vendor contract pushback', 'Argued against renewing a $400k analytics contract my manager had championed.', ['$400k / yr', '3-week bake-off', '$290k saved'], ['back'], ['frugal']),
  story('hiring', 'Hiring bar reset', 'Rewrote the loop after two mis-hires; lifted offer-accept and first-year retention.', ['Offer-accept 45% → 70%', '12 hires in 2 quarters', '2 mis-hires → 0'], ['hire'], ['std']),
  story('nordics', 'Nordics escalation', 'Turned a churn-risk enterprise account by sitting in their ops room for a week.', ['€2.1M ARR retained', 'NPS −20 → +41', '6 weeks'], ['co'], ['trust']),
  story('logging', 'Observability cost cut', 'Cut logging and metrics spend without losing a single alert.', ['−38% spend', '$610k / yr', '0 alerts lost'], ['frugal'], ['deep']),
  story('oncall', 'On-call redesign', 'Redesigned a burning-out rotation; pages per week halved.', ['Pages 38 → 16 / wk', 'Attrition 3 → 0', 'Follow-the-sun, 2 sites'], ['employer'], ['own']),
  story('mvp', 'Launch under ambiguity', 'Shipped the fraud-rules MVP on a 30% data sample rather than wait a quarter.', ['30% sample', 'Shipped in 5 weeks', 'False positives −22%'], ['bias'], []),
  story('a11y', 'Accessibility audit', 'Drove a WCAG AA remediation across 4 product surfaces.', ['4 surfaces', '212 issues → 9', 'AA in 2 quarters'], ['scale'], ['co']),
];

export const INTERVIEWERS: Interviewer[] = [
  { n: 1, name: 'Priya Raman', role: 'Hiring manager', mono: 'PR' },
  { n: 2, name: 'Tomasz Nowak', role: 'Peer SDM', mono: 'TN' },
  { n: 3, name: 'Dana Whitfield', role: 'Bar Raiser', mono: 'DW' },
  { n: 4, name: 'Marcus Oyelaran', role: 'Skip-level', mono: 'MO' },
  { n: 5, name: 'Elena Castellanos', role: 'Partner team', mono: 'EC' },
];

const q = (id: string, text: string, lp: string, source: Question['source'], difficulty: 1 | 2 | 3, timesAsked: number, last: 0 | 1 | 2 | 3 | 4): Question => ({
  id, text, lpIds: [lp], source, difficulty, timesAsked, lastVerdict: last ? CODE_VERDICT[last] : null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: iso(-40),
});

export const QUESTIONS: Question[] = [
  q('q1', 'Tell me about a time you made a decision without all the data you wanted.', 'bias', 'previous', 2, 4, 2),
  q('q2', 'Tell me about a time you disagreed with your manager.', 'back', 'previous', 3, 3, 1),
  q('q3', 'Tell me about a time you found a problem that others had missed. How did you find it?', 'deep', 'common', 3, 5, 3),
  q('q4', 'Describe something you took on because it needed doing, not because it was your job.', 'own', 'common', 2, 2, 1),
  q('q5', 'Tell me about a time you had to deliver bad news to a stakeholder.', 'trust', 'previous', 2, 1, 2),
  q('q6', 'Tell me about a time you went against the team’s preference to do right by the customer.', 'co', 'common', 2, 3, 2),
  q('q7', 'Tell me about a time you missed a deadline. What happened?', 'deliver', 'common', 2, 2, 3),
  q('q8', 'Give me an example of a complex process you simplified.', 'inv', 'custom', 1, 1, 2),
  q('q9', 'Tell me about a time you proposed something people thought was too ambitious.', 'big', 'common', 3, 1, 3),
  q('q10', 'Tell me about a time you delivered a result with far fewer resources than planned.', 'frugal', 'previous', 2, 2, 2),
  q('q11', 'Tell me about a time you refused to ship something.', 'std', 'common', 2, 3, 1),
  q('q12', 'Tell me about someone you grew into a bigger role.', 'hire', 'custom', 1, 0, 0),
  q('q13', 'Tell me about a time you learned something outside your area to solve a problem.', 'learn', 'common', 1, 0, 0),
  q('q14', 'Tell me about a decision you got wrong. How did you find out?', 'right', 'previous', 3, 2, 3),
];

export const FILES: PrepFile[] = [
  { id: 'f1', name: 'aws-sdm-jd.md', type: 'JD', size: 6144, updatedAt: iso(-15), included: true, summary: null, content: '# Senior Software Development Manager, AWS\n\n## What you will do\n- Own the roadmap and operations for a tier-1 service\n- Lead 2–3 teams (15–25 engineers) through managers\n- Raise the bar on operational excellence and hiring\n\n## Basic qualifications\n- 10+ years of software engineering, 5+ managing engineers\n- Experience owning a 24×7 service at scale\n' },
  { id: 'f2', name: 'background.md', type: 'Background', size: 4096, updatedAt: iso(-7), included: true, summary: null, content: '# Background\n\nSenior engineering manager, 11 years. Currently lead Payments Platform (3 teams, 24 engineers) at a fintech.\n\n## Scope\n- Card authorisation path, 40k TPS peak\n- Merchant onboarding platform\n- Observability and on-call for the group\n\n## What I want them to remember\n- Numbers first. 41 min. $1.2M. 3 weeks → 2 days.\n- I trace root causes myself before delegating.\n' },
  { id: 'f3', name: 'loop-2024-notes.md', type: 'Past interviews', size: 11264, updatedAt: iso(1), included: true, summary: null, content: '# AWS loop — March 2024\n\nFive rounds, SDM II. Outcome: no offer. Feedback themes below, verbatim where I could remember.\n\n## Round 3 · Bar raiser\n- “Tell me about a time you found a problem others had missed.” — went long on context, result thin.\n- Follow-up: “How did you know it was the config?” — couldn’t quote the number.\n- Asked for a second example; used the migration story.\n\n## Round 4 · Skip-level\n- “Decision without all the data.” — fraud MVP. Good.\n- “What would you do differently?” — rambled.\n' },
  { id: 'f4', name: 'phone-screen-feedback.md', type: 'Past interviews', size: 2048, updatedAt: iso(1), included: true, summary: null, content: '# Phone screen feedback\n\n- Strong on Ownership and Deliver Results.\n- Asked to quantify more.\n' },
  { id: 'f5', name: 'reading-list.md', type: 'Other', size: 1024, updatedAt: iso(5), included: false, summary: null, content: '- Working Backwards\n- The Amazon Way\n' },
];

// Sessions 7–14 (oldest → newest) and the LP × session verdict matrix (0 = not asked).
const SESSION_META: [number, number, Session['mode'], string | null, number][] = [
  [7, 0, 'loop', null, 55], [8, 2, 'lp', 'back', 18], [9, 4, 'question_set', 'previous', 27], [10, 6, 'loop', null, 52],
  [11, 8, 'bar_raiser', null, 31], [12, 10, 'story', 'payments', 19], [13, 11, 'lp', 'deep', 22], [14, 13, 'loop', null, 48],
];
const HEAT: Record<string, number[]> = {
  co: [2, 0, 2, 0, 2, 0, 0, 2], own: [0, 1, 0, 2, 0, 1, 0, 1], inv: [3, 0, 2, 0, 0, 0, 2, 2], right: [0, 0, 3, 0, 3, 0, 0, 0], learn: [0, 0, 0, 0, 0, 0, 0, 0], hire: [0, 0, 0, 2, 0, 0, 2, 2], std: [2, 0, 2, 0, 1, 0, 1, 1], big: [4, 0, 0, 3, 0, 0, 0, 0],
  bias: [0, 2, 0, 2, 0, 2, 2, 2], frugal: [0, 0, 3, 0, 2, 0, 0, 0], trust: [3, 0, 0, 2, 0, 0, 2, 0], deep: [3, 0, 3, 3, 0, 3, 3, 3], back: [2, 1, 0, 0, 2, 0, 1, 1], deliver: [0, 2, 2, 0, 2, 2, 0, 2], employer: [0, 0, 0, 0, 2, 0, 0, 0], scale: [0, 0, 0, 0, 0, 3, 0, 0],
};

const analysisFor = (lp: string, verdict: Verdict, at: string): Analysis => ({
  lp, storyUsed: null, betterStory: null, numbersMissed: [], star: { s: 25, t: 20, a: 35, r: 20 }, iWeRatio: 0.5,
  delivery: { paceWpm: 150, paceNote: 'good', durationSec: 160, lengthNote: 'good', fillers: 5, confidence: 0.6, notes: '' },
  verdict, spokenVerdict: verdict, strength: 'Clear structure and a stated result.', fixes: ['Lead with the number.'], createdAt: at,
});

const FULL_ANALYSES: Record<string, Analysis> = {
  'deep@14': {
    lp: 'Dive Deep', storyUsed: 'Payments outage', betterStory: { storyId: 'migration', title: 'Legacy data migration', reason: 'It shows you tracing the root cause yourself, not delegating the trace.' },
    numbersMissed: [{ notes: '41 min to mitigate', said: '“under an hour”' }, { notes: '$1.2M exposure avoided', said: '“significant”' }, { notes: '0 repeats in 6 months', said: 'not mentioned' }],
    star: { s: 35, t: 10, a: 40, r: 15 }, iWeRatio: 0.38, delivery: { paceWpm: 168, paceNote: 'fast', durationSec: 252, lengthNote: 'long', fillers: 11, confidence: 0.55, notes: 'Buried the result.' },
    verdict: 'not_inclined', spokenVerdict: 'not_inclined', strength: 'You named the exact failing component and the metric you watched while fixing it.',
    fixes: ['Open with the numbers: 41 minutes, $1.2M.', 'Cut the setup to two sentences — the room knows what Black Friday is.', 'Say what you personally did in the first ten minutes.'], createdAt: iso(13, 10),
  },
  'bias@14': {
    lp: 'Bias for Action', storyUsed: 'Launch under ambiguity', betterStory: null, numbersMissed: [{ notes: 'False positives −22%', said: '“fewer false positives”' }],
    star: { s: 20, t: 15, a: 45, r: 20 }, iWeRatio: 0.61, delivery: { paceWpm: 142, paceNote: 'good', durationSec: 168, lengthNote: 'good', fillers: 4, confidence: 0.75, notes: '' },
    verdict: 'inclined', spokenVerdict: 'inclined', strength: 'Clear framing of what was reversible and what wasn’t.', fixes: ['Quantify the result: −22% false positives.', 'Name the risk you accepted and the trip-wire you set.'], createdAt: iso(13, 10),
  },
  'back@14': {
    lp: 'Have Backbone; Disagree and Commit', storyUsed: 'Vendor contract pushback', betterStory: null, numbersMissed: [],
    star: { s: 15, t: 15, a: 50, r: 20 }, iWeRatio: 0.72, delivery: { paceWpm: 138, paceNote: 'good', durationSec: 151, lengthNote: 'good', fillers: 2, confidence: 0.8, notes: '' },
    verdict: 'strong_hire', spokenVerdict: 'strong_hire', strength: 'You showed the commit half: you ran the renewal plan you had argued against until the bake-off finished.', fixes: ['Add the one-line business impact: $290k saved.'], createdAt: iso(13, 10),
  },
};

function build(): { sessions: Session[]; exchanges: Exchange[]; transcript: TranscriptEvent[] } {
  const sessions: Session[] = [];
  const exchanges: Exchange[] = [];
  const transcript: TranscriptEvent[] = [];
  const storyFor = (lp: string) => STORIES.find((s) => s.links.some((l) => l.lpId === lp && l.role === 'primary')) ?? STORIES.find((s) => s.links.some((l) => l.lpId === lp));
  const questionFor = (lp: string) => QUESTIONS.find((x) => x.lpIds.includes(lp));
  SESSION_META.forEach(([n, day, mode, focus, mins], col) => {
    const startedAt = iso(day, 18);
    const endedAt = new Date(Date.parse(startedAt) + mins * 60000).toISOString();
    const id = 's' + n;
    const lpsAsked = LPS.filter((l) => HEAT[l.id][col] > 0);
    let index = 0;
    for (const lp of lpsAsked) {
      const code = HEAT[lp.id][col] as 1 | 2 | 3 | 4;
      const verdict = CODE_VERDICT[code];
      const st = storyFor(lp.id);
      const qq = questionFor(lp.id);
      const iv = INTERVIEWERS[index % INTERVIEWERS.length];
      const startMs = Math.round(mins * 60000 * (index + 0.1) / lpsAsked.length);
      const exId = id + '-e' + index;
      const full = FULL_ANALYSES[lp.id + '@' + n];
      exchanges.push({
        id: exId, sessionId: id, index, questionId: qq?.id ?? null, questionText: qq?.text ?? 'Tell me about a time that tested ' + lp.name + '.',
        interviewer: iv, lpId: lp.id, storyId: st?.id ?? null, storyTitle: st?.title ?? null,
        startedAt: new Date(Date.parse(startedAt) + startMs).toISOString(), endedAt: new Date(Date.parse(startedAt) + Math.round(mins * 60000 * (index + 0.95) / lpsAsked.length)).toISOString(),
        startMs, endMs: Math.round(mins * 60000 * (index + 0.95) / lpsAsked.length), clipKey: null,
        analysis: full ?? analysisFor(lp.name, verdict, endedAt), verdict, isBest: n === 12 && lp.id === 'deep',
      });
      index++;
    }
    const report = n === 14 ? {
      verdicts: lpsAsked.map((lp) => ({ lpId: lp.id, lpName: lp.name, verdict: CODE_VERDICT[HEAT[lp.id][col] as 1 | 2 | 3 | 4] })),
      votes: lpsAsked.map((lp, i) => ({ interviewer: INTERVIEWERS[i % 5], lpName: lp.name, verdict: CODE_VERDICT[HEAT[lp.id][col] as 1 | 2 | 3 | 4], reason: 'Clear actions, result could be sharper.' })),
      improvement: 'You own the decisions now: “I” in most sentences, with the reasoning.',
      fixes: ['Open with the numbers: 41 minutes, $1.2M.', 'Cut the setup to two sentences.', 'Name the trip-wire you set.'],
      storySwaps: [{ lpName: 'Dive Deep', useStory: 'Legacy data migration', insteadOf: 'Payments outage' }],
      nextFocus: 'Dive Deep — quantify the blast radius before the fix', summary: 'Five answers, two inclined, one strong hire, one not inclined.', createdAt: endedAt,
    } : null;
    sessions.push({ id, number: n, mode, focus, coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 1000 + n * 37, startedAt, endedAt, recordingKey: null, recordingMime: null, report });
  });
  // A short transcript for session 14's third exchange (the design's sample).
  const ex = exchanges.find((e) => e.sessionId === 's14' && e.lpId === 'deep');
  if (ex) {
    const lines: [TranscriptEvent['speaker'], string][] = [
      ['interviewer', 'Tell me about a time you found a problem that others had missed. How did you find it?'],
      ['me', 'Black Friday week, 7:40 — card authorisations started failing for about 18% of EU traffic. On-call assumed the provider.'],
      ['interviewer', 'What made you look at the config path rather than the provider?'],
      ['me', 'Their status page was green, and the error rate stepped up exactly on a deploy boundary.'],
      ['interviewer', 'How long until it was mitigated?'],
      ['me', 'Under an hour. Forty-something minutes.'],
      ['coach', 'Pausing the interview. Strength: you named the exact failing component and the metric you watched. Fix one: open with the numbers — 41 minutes, $1.2M. Back to the interview.'],
    ];
    lines.forEach(([speaker, text], i) => transcript.push({ id: ex.id + '-t' + i, sessionId: 's14', exchangeId: ex.id, tMs: ex.startMs + i * 28000, speaker, text }));
  }
  return { sessions, exchanges, transcript };
}

const built = build();
export const SESSIONS: Session[] = built.sessions;
export const EXCHANGES: Exchange[] = built.exchanges;
export const TRANSCRIPT: TranscriptEvent[] = built.transcript;

export const DEFAULT_SYSTEM_INSTRUCTION = 'You are interviewing me for a Senior SDM role at AWS. Ask one Leadership Principle question at a time, then probe with at most two follow-ups that push for specifics: numbers, my personal actions, what I would do differently.\n\nAs coach, judge me only against my own files and story notes. Name the better story if there is one. Quote the number I missed. Give one strength, up to three fixes, and a verdict on the four-step scale. Be direct; no praise padding.';

export const SETTINGS: Settings = {
  interviewDate: '2026-10-30', liveModel: 'gemini-3.8-live', textModel: 'gemini-3.8-flash', voice: 'Aoede', pauseMs: 2500,
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION, loopSize: 5, coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 12345, lastBackupAt: null, onboarded: true,
};

/** What a brand-new install starts with: the LPs and settings only (plan D3). */
export const EMPTY_SETTINGS: Settings = { ...SETTINGS, onboarded: false };
