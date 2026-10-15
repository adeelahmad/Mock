// Mock — the prep canvas, as pure state. A round deals a question; the candidate picks the area
// it tests (the question's tags decide, as in the Areas game) and, once the pick is right,
// answers out loud. The answer is cut into phrases as it is heard and each phrase is marked:
// on track (it matches what a strong answer for this area says), drifting (off the point, too
// vague) or redo (wrong, empty or unusable). The canvas also holds a whiteboard (pen strokes and
// notes, written by the candidate or the AI) and the chat with the AI. Everything here is plain
// data so a Meet call's other participants can be sent the same canvas (see canvas/addon.ts).

import { roleOf, type AreaRole } from './game.ts';
import type { Lp, Question, Story } from './types.ts';

export type Mark = 'match' | 'drift' | 'redo';
export type Phase = 'pick' | 'answer' | 'done';
export type Who = 'me' | 'ai';

export interface Phrase { id: string; text: string; mark: Mark | 'pending'; note: string; by: 'ai' | 'local' | '' }
export interface BoardNote { id: string; x: number; y: number; text: string; by: Who }
/** A pen stroke: flat [x0, y0, x1, y1, …] in board units (0…1000 × 0…600). */
export interface Stroke { id: string; points: number[]; by: Who }
export interface ChatMsg { id: string; who: Who; text: string; voice?: boolean }

export interface CanvasState {
  questionId: string;
  questionText: string;
  phase: Phase;
  /** Areas picked wrongly for this question, in order. */
  misses: string[];
  /** The area picked rightly (null until then) and its role for the question. */
  areaId: string | null;
  role: AreaRole | null;
  phrases: Phrase[];
  /** Words heard but not yet cut into a phrase. */
  partial: string;
  notes: BoardNote[];
  strokes: Stroke[];
  chat: ChatMsg[];
  /** Questions done this sitting. */
  done: number;
}

export const BOARD_W = 1000;
export const BOARD_H = 600;

let seq = 0;
export const newId = (p: string): string => p + '_' + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);

export function emptyCanvas(): CanvasState {
  return { questionId: '', questionText: '', phase: 'pick', misses: [], areaId: null, role: null, phrases: [], partial: '', notes: [], strokes: [], chat: [], done: 0 };
}

/** Starts a question: keeps the board and the chat, clears the answer. */
export function withQuestion(s: CanvasState, q: Pick<Question, 'id' | 'text'>): CanvasState {
  return { ...s, questionId: q.id, questionText: q.text, phase: 'pick', misses: [], areaId: null, role: null, phrases: [], partial: '' };
}

/** A pick: right (the question is tagged with it) moves on to the answer; wrong is remembered. */
export function pickArea(s: CanvasState, q: Pick<Question, 'lpIds'>, areaId: string): { state: CanvasState; ok: boolean; role: AreaRole | null } {
  if (s.phase !== 'pick') return { state: s, ok: s.areaId === areaId, role: s.role };
  const role = roleOf(q, areaId);
  if (!role) return { state: { ...s, misses: s.misses.includes(areaId) ? s.misses : [...s.misses, areaId] }, ok: false, role: null };
  return { state: { ...s, phase: 'answer', areaId, role }, ok: true, role };
}

/** Questions the canvas can use: tagged with at least one area that exists. */
export const canvasQuestions = (qs: Question[], areaIds: Set<string>): Question[] => qs.filter((q) => q.lpIds.some((id) => areaIds.has(id)));

/** The next question: unseen first, then the least asked, random among equals. */
export function nextQuestion(qs: Question[], seen: Set<string>, rand: () => number = Math.random): Question | null {
  if (!qs.length) return null;
  const fresh = qs.filter((q) => !seen.has(q.id));
  const pool = fresh.length ? fresh : qs;
  const least = Math.min(...pool.map((q) => q.timesAsked));
  const ties = pool.filter((q) => q.timesAsked === least);
  return ties[Math.floor(rand() * ties.length)] ?? ties[0];
}

// ---------- Phrases ----------

/**
 * Cuts finished speech into phrases: sentences, and long sentences again at a comma or a
 * joining word, so feedback lands every few seconds rather than once per minute.
 */
export function splitPhrases(text: string, maxWords = 24): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g) ?? [];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const words = s.split(' ');
    if (words.length <= maxWords) { out.push(s); continue; }
    let cur: string[] = [];
    for (const w of words) {
      cur.push(w);
      const breakHere = cur.length >= 8 && (/,$/.test(w) || cur.length >= maxWords);
      if (breakHere) { out.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) {
      // A short tail joins the phrase before it.
      if (cur.length < 4 && out.length) out[out.length - 1] += ' ' + cur.join(' ');
      else out.push(cur.join(' '));
    }
  }
  return out;
}

/** Adds heard phrases to the answer, marked pending until judged. */
export function addPhrases(s: CanvasState, texts: string[]): { state: CanvasState; added: Phrase[] } {
  const added = texts.map((text): Phrase => ({ id: newId('p'), text, mark: 'pending', note: '', by: '' }));
  return { state: { ...s, phrases: [...s.phrases, ...added], partial: '' }, added };
}

export function markPhrase(s: CanvasState, id: string, mark: Mark, note: string, by: 'ai' | 'local'): CanvasState {
  return { ...s, phrases: s.phrases.map((p) => (p.id === id ? { ...p, mark, note, by } : p)) };
}

// ---------- The offline judge ----------

const STOP = new Set('a an and are as at be but by for from had has have he her his i in is it its me my of on or our so that the their them then there they this to was we were what when which who will with you your about into out up just also very really did do does not no yes than too can could would should one time tell me give us'.split(' '));
const HEDGE = /\b(i don'?t know|no idea|not sure|i can'?t remember|i forget|skip( this)?|pass|nothing comes to mind|i guess|i have no)\b/i;
const FILLER = /\b(um+|uh+|er+|like|you know|kind of|sort of|basically|whatever)\b/gi;
const ACTION = /\b(i (led|built|owned|decided|drove|wrote|fixed|found|traced|cut|shipped|designed|proposed|measured|escalated|pushed|convinced|hired|coached|launched|reduced|raised|changed|rolled|migrated|automated|negotiated|delivered|asked|took|made|set|chose|started|stopped|learned|realised|realized|noticed|dug|analysed|analyzed|tested))\b/i;
const NUMBER = /\d|percent|%|\b(twice|double|half|million|thousand|hundred)\b/i;
const VAGUE = /\b(we (usually|always|generally|tend to)|in general|typically|normally|people should|it depends|best practice)\b/i;

export const contentWords = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));

/** What a strong answer for this area should touch: the area, the question and the best story. */
export function referenceFor(areaId: string | null, lps: Lp[], stories: Story[], question: string): { area: Lp | null; story: Story | null; words: Set<string> } {
  const area = lps.find((l) => l.id === areaId) ?? null;
  const linked = stories.filter((s) => s.links.some((l) => l.lpId === areaId));
  const story = linked.find((s) => s.links.some((l) => l.lpId === areaId && l.role === 'primary')) ?? linked[0] ?? null;
  const text = [area?.name, area?.description, question, story && [story.title, story.situation, story.task, story.action, story.result].join(' ')].filter(Boolean).join(' ');
  return { area, story, words: new Set(contentWords(text)) };
}

/**
 * A quick mark without a model: hedges and empty phrases are redo; first-person action, numbers or
 * words the reference shares are on track; general talk ("we usually…") and the rest drift.
 */
export function localMark(text: string, ref: Set<string>): { mark: Mark; note: string } {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  const fillers = (t.match(FILLER) ?? []).length;
  if (!words.length || HEDGE.test(t)) return { mark: 'redo', note: 'No answer here yet: pick a story and start with the situation.' };
  if (words.length >= 4 && fillers / words.length > 0.3) return { mark: 'redo', note: 'Mostly filler: pause, then say it plainly.' };
  const shared = contentWords(t).filter((w) => ref.has(w)).length;
  const action = ACTION.test(t), number = NUMBER.test(t);
  if (VAGUE.test(t) && !action && !number) return { mark: 'drift', note: 'General talk: say what you did, once, in one situation.' };
  if (action && number) return { mark: 'match', note: 'Your action and a number.' };
  if (action || number || shared >= 2) return { mark: 'match', note: action ? 'Clear first-person action.' : number ? 'A concrete number.' : 'On the point of the question.' };
  return { mark: 'drift', note: /\bwe\b/i.test(t) ? 'Say I, not we: what was your part?' : 'Drifting from the question.' };
}

export interface AnswerSummary { match: number; drift: number; redo: number; pending: number; overall: Mark | null; line: string }

/** How the answer is going: the overall mark and one line for the canvas. */
export function summarize(phrases: Phrase[]): AnswerSummary {
  const n = { match: 0, drift: 0, redo: 0, pending: 0 };
  for (const p of phrases) n[p.mark]++;
  const judged = n.match + n.drift + n.redo;
  if (!judged) return { ...n, overall: null, line: phrases.length ? 'Listening…' : 'Answer out loud; each phrase is marked as you go.' };
  const overall: Mark = n.redo / judged >= 0.4 ? 'redo' : n.match / judged >= 0.6 ? 'match' : 'drift';
  const line = overall === 'match' ? 'On track: keep going, land the result with a number.'
    : overall === 'drift' ? 'Drifting: come back to what you did and why it mattered.'
      : 'Start this one again: pick one story and tell it in order.';
  return { ...n, overall, line };
}

// ---------- Board ----------

export function addNote(s: CanvasState, text: string, by: Who, at?: { x: number; y: number }): CanvasState {
  const n = s.notes.length;
  const x = at?.x ?? 40 + (n % 4) * 230;
  const y = at?.y ?? 40 + (Math.floor(n / 4) % 3) * 180;
  return { ...s, notes: [...s.notes, { id: newId('n'), x: clamp(x, 0, BOARD_W - 200), y: clamp(y, 0, BOARD_H - 120), text: text.trim(), by }] };
}
export const moveNote = (s: CanvasState, id: string, x: number, y: number): CanvasState =>
  ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, x: clamp(x, 0, BOARD_W - 200), y: clamp(y, 0, BOARD_H - 120) } : n)) });
export const removeNote = (s: CanvasState, id: string): CanvasState => ({ ...s, notes: s.notes.filter((n) => n.id !== id) });
export const addStroke = (s: CanvasState, points: number[], by: Who): CanvasState =>
  (points.length >= 4 ? { ...s, strokes: [...s.strokes, { id: newId('s'), points: points.map((v) => Math.round(v)), by }] } : s);
export const clearBoard = (s: CanvasState): CanvasState => ({ ...s, notes: [], strokes: [] });

export const addChat = (s: CanvasState, who: Who, text: string, voice = false): CanvasState =>
  ({ ...s, chat: [...s.chat, { id: newId('c'), who, text: text.trim(), ...(voice ? { voice } : {}) }] });

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------- Sharing (Meet co-doing) ----------

/** Co-doing state has to stay small: older strokes and chat go first. */
export const SHARE_LIMIT_BYTES = 60_000;

export function encodeCanvas(s: CanvasState, limit = SHARE_LIMIT_BYTES): Uint8Array {
  const enc = new TextEncoder();
  let cur = s;
  let bytes = enc.encode(JSON.stringify({ v: 1, s: cur }));
  while (bytes.length > limit && (cur.strokes.length || cur.chat.length > 4 || cur.phrases.length > 4)) {
    cur = cur.strokes.length ? { ...cur, strokes: cur.strokes.slice(Math.ceil(cur.strokes.length / 4)) }
      : cur.chat.length > 4 ? { ...cur, chat: cur.chat.slice(Math.ceil(cur.chat.length / 4)) }
        : { ...cur, phrases: cur.phrases.slice(Math.ceil(cur.phrases.length / 4)) };
    bytes = enc.encode(JSON.stringify({ v: 1, s: cur }));
  }
  return bytes;
}

export function decodeCanvas(bytes: Uint8Array): CanvasState | null {
  try {
    const m = JSON.parse(new TextDecoder().decode(bytes)) as { v?: number; s?: CanvasState };
    if (m.v !== 1 || !m.s || typeof m.s.phase !== 'string' || !Array.isArray(m.s.phrases)) return null;
    return { ...emptyCanvas(), ...m.s };
  } catch { return null; }
}
export const editNote = (s: CanvasState, id: string, text: string): CanvasState => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, text } : n)) });
