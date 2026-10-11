// Mock — domain types. One source of truth for the data the screens show and the
// storage layer persists (schema v1, see docs/plan.md §3).

export type Verdict = 'strong_hire' | 'inclined' | 'not_inclined' | 'strong_no_hire';
/** Verdict as the design codes it: 0 = not yet, 1 = strong hire … 4 = strong no hire. */
export type VerdictCode = 0 | 1 | 2 | 3 | 4;

export type Mode = 'loop' | 'lp' | 'story' | 'question_set' | 'replay' | 'deep_dive' | 'bar_raiser';
export type Coaching = 'after_each' | 'recap_only';
export type QuestionSource = 'previous' | 'common' | 'custom' | 'ai';
export type QuestionSourceSetting = 'bank' | 'previous' | 'ai' | 'mix';
export type FileType = 'JD' | 'Background' | 'Past interviews' | 'Other';
export type LpRole = 'primary' | 'secondary';

export interface Lp {
  id: string;
  name: string;
  /** Two-letter short label used in strips and grids. */
  short: string;
  description: string;
  order: number;
  isDefault: boolean;
}

export interface KeyNumber { label: string; value: string }

export interface Story {
  id: string;
  title: string;
  summary: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  learning: string;
  numbers: KeyNumber[];
  /** LP links, each primary or secondary. */
  links: { lpId: string; role: LpRole }[];
  createdAt: string;
  updatedAt: string;
}

export interface Question {
  id: string;
  text: string;
  lpIds: string[];
  source: QuestionSource;
  difficulty: 1 | 2 | 3;
  timesAsked: number;
  lastVerdict: Verdict | null;
  /** Exchange id of the best attempt, if one was saved. */
  bestExchangeId: string | null;
  /** Free-text metadata from imports (company tags, votes, community answer). */
  tags: string;
  votes: number;
  sample: string;
  createdAt: string;
}

export interface PrepFile {
  id: string;
  name: string;
  type: FileType;
  content: string;
  included: boolean;
  size: number;
  updatedAt: string;
  /** Flash summary, cached for the context builder. */
  summary: string | null;
}

export interface Interviewer { n: number; name: string; role: string; mono: string }

export interface Session {
  id: string;
  number: number;
  mode: Mode;
  focus: string | null;
  coaching: Coaching;
  questionSource: QuestionSourceSetting;
  storyNotes: boolean;
  seed: number;
  startedAt: string;
  endedAt: string | null;
  /** Blob key of the mixed recording, when one exists. */
  recordingKey: string | null;
  recordingMime: string | null;
  report: Report | null;
}

export interface Exchange {
  id: string;
  sessionId: string;
  index: number;
  questionId: string | null;
  questionText: string;
  interviewer: Interviewer;
  lpId: string | null;
  storyId: string | null;
  storyTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Offsets into the session recording, ms. */
  startMs: number;
  endMs: number | null;
  clipKey: string | null;
  analysis: Analysis | null;
  verdict: Verdict | null;
  isBest: boolean;
}

export interface TranscriptEvent {
  id: string;
  sessionId: string;
  exchangeId: string | null;
  /** Offset into the session, ms. */
  tMs: number;
  speaker: 'interviewer' | 'coach' | 'me';
  text: string;
}

export interface MissedNumber { notes: string; said: string }
export interface StarSplit { s: number; t: number; a: number; r: number }

export interface Analysis {
  lp: string;
  storyUsed: string | null;
  betterStory: { storyId: string; title: string; reason: string } | null;
  numbersMissed: MissedNumber[];
  star: StarSplit;
  iWeRatio: number;
  delivery: {
    paceWpm: number;
    paceNote: 'slow' | 'good' | 'fast';
    durationSec: number;
    lengthNote: 'short' | 'good' | 'long';
    fillers: number;
    confidence: number;
    notes: string;
  };
  verdict: Verdict;
  spokenVerdict: Verdict | null;
  strength: string;
  fixes: string[];
  createdAt: string;
}

export interface Report {
  verdicts: { lpId: string; lpName: string; verdict: Verdict }[];
  votes: { interviewer: Interviewer; lpName: string; verdict: Verdict; reason: string }[];
  improvement: string;
  fixes: string[];
  storySwaps: { lpName: string; useStory: string; insteadOf: string | null }[];
  nextFocus: string;
  /** The LP the next focus names, so Practice can pull it to the top of the queue. */
  nextFocusLpId?: string | null;
  summary: string;
  createdAt: string;
}

export interface Settings {
  interviewDate: string;
  liveModel: string;
  textModel: string;
  voice: string;
  pauseMs: number;
  systemInstruction: string;
  loopSize: number;
  coaching: Coaching;
  questionSource: QuestionSourceSetting;
  storyNotes: boolean;
  seed: number;
  lastBackupAt: string | null;
  onboarded: boolean;
  /** USD per 1M tokens, per model; editable in Settings. */
  pricing: ModelPrice[];
  /** Tokens spent so far, per model and Leadership Principle. */
  usage: UsageBucket[];
}

/** Billable tokens of one or more Gemini calls. */
export interface TokenUsage { input: number; output: number; audioInput: number; audioOutput: number }
export interface ModelPrice { model: string; input: number; output: number; audioInput: number; audioOutput: number }
export interface UsageBucket extends TokenUsage { model: string; lpId: string | null; calls: number }

export interface UiPrefs {
  theme: 'light' | 'dark' | 'system';
  voiceVisual: 'orb' | 'wave' | 'ring';
  liveLayout: 'stage' | 'transcript' | 'split';
  lastTab: 'practice' | 'library' | 'history' | 'progress';
}

export const VERDICT_CODE: Record<Verdict, VerdictCode> = { strong_hire: 1, inclined: 2, not_inclined: 3, strong_no_hire: 4 };
export const CODE_VERDICT: Record<Exclude<VerdictCode, 0>, Verdict> = { 1: 'strong_hire', 2: 'inclined', 3: 'not_inclined', 4: 'strong_no_hire' };
export const verdictCode = (v: Verdict | null | undefined): VerdictCode => (v ? VERDICT_CODE[v] : 0);
export const MODE_LABEL: Record<Mode, string> = { loop: 'Full loop', lp: 'One LP', story: 'One story', question_set: 'Question set', replay: 'Replay', deep_dive: 'Deep dive', bar_raiser: 'Bar raiser' };
