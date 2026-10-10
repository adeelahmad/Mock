// A script for the simulated transport: what the model says, when the candidate talks, and
// which analysis the coach lands on. Timings are in ms; the engine stretches nothing.

import type { Analysis, Interviewer } from '../domain/types.ts';

export interface ScriptedQuestion {
  id: string | null;
  interviewer: Interviewer;
  lp: string;
  text: string;
  /** Follow-ups the interviewer asks after the candidate's first stretch of speech. */
  followUps: { ask: string; answer: string }[];
  /** What the candidate says first (becomes the input transcript). */
  answer: string;
  /** How long the candidate talks before the first pause, ms. */
  answerMs: number;
  /** The coach's spoken feedback, chunked as it would be transcribed. */
  coaching: string[];
  analysis: Analysis;
  hint: string;
  /** Story notes for the peek. */
  notes: { t: string; n: string }[];
}

export interface LiveScript {
  sessionNumber: number;
  mode: 'loop' | 'lp' | 'story' | 'question_set' | 'replay' | 'deep_dive' | 'bar_raiser';
  opening: string;
  questions: ScriptedQuestion[];
  recap: string;
  focus: string;
  /** Speed multiplier for tests: 0.01 makes a demo finish in a few hundred ms. */
  speed?: number;
  /** When set, the transport emits a disconnect/reconnect during this question index. */
  reconnectDuring?: number;
}

/** Words per second the "voice" speaks at; drives aiSpeaking durations and transcript pacing. */
export const SPOKEN_WPS = 2.8;
export const msToSpeak = (text: string, speed = 1): number => Math.max(300, Math.round((text.split(/\s+/).length / SPOKEN_WPS) * 1000 * speed));
