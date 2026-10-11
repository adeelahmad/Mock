// Mock — pure parsers for the import flows: questions out of markdown / plain text / CSV /
// an Exponent export, stories out of markdown, the story × LP grid out of a markdown table,
// the keyword LP tagger (ported from the design's mock-import.js) and the dedup helpers.
// No DOM, no repo: everything here is unit-tested in parsers.test.ts.

import type { FileType, KeyNumber, Lp, LpRole, QuestionSource } from './types.ts';
import { LPS } from '../fixtures/sample.ts';

export type LpRef = Pick<Lp, 'id' | 'name' | 'short'>;
/** The 16 default LPs (the production seed) — parsers resolve names against these unless told otherwise. */
export const DEFAULT_LPS: LpRef[] = LPS;

export type Confidence = 'high' | 'low';
export interface LpGuess { lpId: string; confidence: Confidence; alternatives: string[] }

export interface ParsedQuestion {
  text: string;
  /** Guessed or given LP id, '' when untagged. */
  lpId: string;
  confidence: Confidence;
  alternatives: string[];
  source: QuestionSource | null;
  difficulty: 1 | 2 | 3 | null;
  tags: string;
  votes: number;
  sample: string;
}

export interface ParsedStory {
  title: string; summary: string; situation: string; task: string; action: string; result: string; learning: string;
  numbers: KeyNumber[];
  /** LPs named in the text (an "LPs:" line or a full name anywhere). */
  lpIds: string[];
  /** The LPs to offer: the named ones, else a keyword guess. */
  suggestedLpIds: string[];
}

export interface ParsedGrid { lpIds: (string | null)[]; rows: { title: string; links: { lpId: string; role: LpRole }[] }[] }

// ---------- normalise + near-duplicates ----------

export const normaliseQuestion = (text: string): string =>
  text.toLowerCase().replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

const wordSet = (s: string): Set<string> => new Set(normaliseQuestion(s).split(' ').filter(Boolean));

/** Normalised equality, or a Jaccard overlap of the word sets ≥ `threshold` (0.85). */
export function isNearDuplicate(a: string, b: string, threshold = 0.85): boolean {
  const na = normaliseQuestion(a), nb = normaliseQuestion(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = wordSet(a), wb = wordSet(b);
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 && inter / union >= threshold;
}

// ---------- LP resolution ----------

const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** An LP id from an id, a full name (punctuation-insensitive), a short label or a unique name prefix; '' when unknown. */
export function resolveLp(label: string, lps: LpRef[] = DEFAULT_LPS): string {
  const raw = label.trim();
  if (!raw) return '';
  const byId = lps.find((l) => l.id === raw.toLowerCase());
  if (byId) return byId.id;
  const byShort = lps.find((l) => l.short.toLowerCase() === raw.toLowerCase());
  if (byShort) return byShort.id;
  const key = loose(raw);
  if (!key) return '';
  const byName = lps.find((l) => loose(l.name) === key);
  if (byName) return byName.id;
  const prefix = lps.filter((l) => loose(l.name).startsWith(key) || key.startsWith(loose(l.name)));
  return prefix.length === 1 ? prefix[0].id : '';
}

// ---------- keyword tagger (mock-import.js guessLp, scored instead of first-hit) ----------

/** The design's keyword table, verbatim, plus the phrases the prototype's screens relied on. */
const KW: [string, string][] = [
  ['disagree', 'back'], ['pushed back', 'back'], ['push back', 'back'], ['conflict', 'back'], ['convince', 'back'], ['persua', 'back'], ['manager', 'back'],
  ['customer', 'co'], ['client', 'co'], ['user', 'co'],
  ['ownership', 'own'], ['went above', 'own'], ['outside your', 'own'], ['beyond your', 'own'], ['not your job', 'own'],
  ['simplif', 'inv'], ['innovat', 'inv'], ['invent', 'inv'], ['creative', 'inv'],
  ['wrong', 'right'], ['mistake', 'right'], ['judgment', 'right'], ['judgement', 'right'], ['bad decision', 'right'],
  ['curious', 'learn'], ['new skill', 'learn'], ['learn', 'learn'],
  ['hire', 'hire'], ['hiring', 'hire'], ['intern', 'hire'], ['mentor', 'hire'], ['coach', 'hire'], ['develop', 'hire'], ['underperform', 'hire'],
  ['quality', 'std'], ['standard', 'std'], ['refused', 'std'], ['refused to ship', 'std'],
  ['ambitious', 'big'], ['vision', 'big'], ['big', 'big'], ['long-term', 'big'], ['think big', 'big'], ['bold', 'big'],
  ['without all', 'bias'], ['incomplete', 'bias'], ['quick decision', 'bias'], ['fast', 'bias'], ['risk', 'bias'], ['without all the data', 'bias'],
  ['limited resource', 'frugal'], ['budget', 'frugal'], ['frugal', 'frugal'], ['cost', 'frugal'], ['fewer resources', 'frugal'],
  ['trust', 'trust'], ['bad news', 'trust'], ['feedback', 'trust'], ['difficult conversation', 'trust'], ['candid', 'trust'],
  ['dive', 'deep'], ['root cause', 'deep'], ['detail', 'deep'], ['debug', 'deep'], ['data', 'deep'], ['dive deep', 'deep'], ['others had missed', 'deep'], ['metric', 'deep'], ['distrust', 'deep'],
  ['deadline', 'deliver'], ['deliver', 'deliver'], ['missed', 'deliver'], ['fail', 'deliver'], ['prioriti', 'deliver'], ['tight', 'deliver'], ['goal', 'deliver'],
  ['burnout', 'employer'], ['team morale', 'employer'], ['inclusi', 'employer'], ['well-being', 'employer'], ['wellbeing', 'employer'],
  ['ethic', 'scale'], ['responsib', 'scale'], ['impact on', 'scale'], ['community', 'scale'],
];
/** Weak hints (weight 1) for the follow-up style questions the design flags as "need you". */
const KW_WEAK: [string, string][] = [
  ['differently', 'learn'], ['not to build', 'frugal'], ['build', 'inv'], ['scope', 'frugal'], ['decision', 'bias'], ['problem', 'deep'],
];

const BEHAVIOURAL = /tell me about a time|describe a (time|situation)|give me an example|when have you|how do you handle|how would you handle/i;

/**
 * Keyword tagger: every table hit scores (phrases and long keywords 2, short ones 1); the top LP
 * wins. 'high' when it scores at least 2 and beats the runner-up; 'low' otherwise (the review
 * screen then asks). Alternatives are the other LPs that scored, best first.
 */
/** A keyword hits at the start of a word (stems like "persua" still match "persuade"; "big" no longer matches "ambiguity"). */
const hits = (low: string, k: string): boolean => { const at = low.indexOf(k); return at >= 0 && (at === 0 || !/[a-z]/.test(low[at - 1]) || low.includes(' ' + k)); };

export function guessLp(text: string, lps: LpRef[] = DEFAULT_LPS): LpGuess {
  const low = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const score = new Map<string, number>();
  const order: string[] = [];
  const bump = (lp: string, w: number) => { if (!score.has(lp)) order.push(lp); score.set(lp, (score.get(lp) ?? 0) + w); };
  for (const [k, lp] of KW) if (hits(low, k)) bump(lp, k.includes(' ') || k.length >= 7 ? 2 : 1);
  for (const [k, lp] of KW_WEAK) if (hits(low, k)) bump(lp, 1);
  const known = new Set(lps.map((l) => l.id));
  const ranked = order.filter((lp) => known.has(lp)).sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
  if (!ranked.length) return { lpId: '', confidence: 'low', alternatives: [] };
  const best = score.get(ranked[0]) ?? 0, second = ranked[1] ? score.get(ranked[1]) ?? 0 : 0;
  const words = normaliseQuestion(text).split(' ').filter(Boolean).length;
  const confidence: Confidence = best >= 2 && best > second && words >= 4 ? 'high' : 'low';
  return { lpId: ranked[0], confidence, alternatives: ranked.slice(1, 4) };
}

// ---------- questions from markdown / plain text ----------

const MARKERS = /^(?:\s*(?:[-*+•▪]|\d+[.)]|[a-zA-Z][.)]|>|#{1,6}|\[[ xX]\])\s*)+/;
const PREFIX = /^(?:follow[- ]?ups?|probe|q\d*|question\s*\d*|interviewer|they asked)\s*[:.\-–—]\s*/i;
const OPENER = /^(tell me|tell us|describe|give me|give an example|walk me|share|when (have|did|was|were)|how (do|did|would|have|was)|what (would|did|do|was|is|are|were|about)|why|have you|can you|could you|think of)/i;
const QUOTED = /[“"]([^“”"]{12,240}?)[”"]/g;

const cleanLine = (raw: string): string => raw.replace(MARKERS, '').replace(PREFIX, '').replace(/\*\*|__|`/g, '').trim();

/** Question lines out of markdown or plain text: quoted questions and lines ending in "?"; list markers stripped; deduped. */
export function parseQuestionsFromText(text: string): string[] {
  const out: string[] = [];
  const add = (q: string) => { const t = q.trim(); if (t.length < 12 || t.length > 240) return; if (!out.some((o) => isNearDuplicate(o, t))) out.push(t); };
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;
    let quoted = 0;
    for (const m of line.matchAll(QUOTED)) {
      const q = m[1].trim();
      if (q.endsWith('?') || OPENER.test(q)) { quoted++; add(q); }
    }
    if (quoted) continue;
    const m = /^(.{24,240}\?)(?:\s*[—–-]\s.*)?$/.exec(line);
    if (m) add(m[1].trim());
  }
  return out;
}

/** The same lines, each with an LP guess and the source the caller decided. */
export function parsedQuestionsFromText(text: string, source: QuestionSource | null = null, lps: LpRef[] = DEFAULT_LPS): ParsedQuestion[] {
  return parseQuestionsFromText(text).map((t) => ({ text: t, ...guessLp(t, lps), source, difficulty: null, tags: '', votes: 0, sample: '' }));
}

// ---------- CSV ----------

/** RFC-4180-ish split: quoted fields may hold commas, quotes ("") and newlines. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

const toSource = (s: string): QuestionSource | null => {
  const k = s.toLowerCase().trim();
  if (!k) return null;
  if (k.startsWith('prev') || k.includes('interview')) return 'previous';
  if (k === 'common' || k === 'exponent' || k === 'bank') return 'common';
  if (k === 'ai' || k.includes('generated')) return 'ai';
  if (k === 'custom' || k === 'mine') return 'custom';
  return null;
};
const toDifficulty = (s: string | number | undefined): 1 | 2 | 3 | null => {
  if (s == null) return null;
  const k = String(s).toLowerCase().trim();
  if (k === '1' || k === 'easy') return 1;
  if (k === '2' || k === 'medium') return 2;
  if (k === '3' || k === 'hard') return 3;
  return null;
};

/** Header-aware CSV: text/question, lp, source, difficulty (+ tags, votes, sample); without a header, one question per line. */
export function parseQuestionsFromCsv(text: string, lps: LpRef[] = DEFAULT_LPS): ParsedQuestion[] {
  const rows = splitCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((c) => c.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iText = col('text', 'question', 'prompt', 'title');
  const hasHeader = iText >= 0;
  const iLp = hasHeader ? col('area', 'area_id', 'areas', 'lp', 'lp_id', 'lpid', 'principle', 'leadership principle', 'competency') : 1;
  const iSource = hasHeader ? col('source') : 2;
  const iDiff = hasHeader ? col('difficulty', 'level') : 3;
  const iTags = hasHeader ? col('tags', 'companies', 'company') : -1;
  const iVotes = hasHeader ? col('votes') : -1;
  const iSample = hasHeader ? col('sample', 'answer', 'model answer') : -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const out: ParsedQuestion[] = [];
  const at = (r: string[], i: number): string => (i >= 0 && i < r.length ? r[i] : '');
  for (const r of body) {
    const t = at(r, hasHeader ? iText : 0).trim();
    if (t.length < 8) continue;
    if (out.some((o) => isNearDuplicate(o.text, t))) continue;
    const given = resolveLp(at(r, iLp), lps);
    const guess = guessLp(t, lps);
    out.push({
      text: t, lpId: given || guess.lpId, confidence: given ? 'high' : guess.confidence, alternatives: guess.alternatives.filter((a) => a !== given),
      source: toSource(at(r, iSource)), difficulty: toDifficulty(at(r, iDiff)), tags: at(r, iTags), votes: parseInt(at(r, iVotes), 10) || 0, sample: at(r, iSample),
    });
  }
  return out;
}

// ---------- stories and areas from CSV (the downloadable templates in csv-templates.ts) ----------

const splitCells = (s: string): string[] => s.split(/\s*[;|·•]\s*/).map((x) => x.trim()).filter(Boolean);

/**
 * Header row required: title plus any of summary, situation, task, action, result, learning,
 * areas ("Primary; Secondary", first is primary), numbers ("Label: value; Label: value").
 * Rows without a title are skipped. Areas are resolved by id, short or name; unnamed ones are guessed.
 */
export function parseStoriesFromCsv(text: string, lps: LpRef[] = DEFAULT_LPS): ParsedStory[] {
  const rows = splitCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((c) => c.toLowerCase().trim());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iTitle = col('title', 'story', 'name');
  if (iTitle < 0) return [];
  const idx = { summary: col('summary'), situation: col('situation'), task: col('task'), action: col('action', 'actions'), result: col('result', 'results'), learning: col('learning', 'learnings', 'lesson') };
  const iAreas = col('areas', 'area', 'lps', 'lp', 'principles');
  const iNumbers = col('numbers', 'key numbers', 'metrics');
  const at = (r: string[], i: number): string => (i >= 0 && i < r.length ? r[i] : '');
  const out: ParsedStory[] = [];
  for (const r of rows.slice(1)) {
    const title = at(r, iTitle);
    if (!title) continue;
    const f = { summary: at(r, idx.summary), situation: at(r, idx.situation), task: at(r, idx.task), action: at(r, idx.action), result: at(r, idx.result), learning: at(r, idx.learning) };
    const lpIds = Array.from(new Set(splitCells(at(r, iAreas)).map((n) => resolveLp(n, lps)).filter(Boolean)));
    const numbers = splitCells(at(r, iNumbers)).map(keyNumber).filter((n) => n.value);
    const summary = (f.summary || f.situation.split(/(?<=[.!?])\s/)[0] || '').slice(0, 240);
    let suggestedLpIds = lpIds.slice();
    if (!suggestedLpIds.length) { const g = guessLp([title, summary, f.situation, f.task, f.action, f.result].join(' '), lps); suggestedLpIds = [g.lpId, ...g.alternatives].filter(Boolean).slice(0, 2); }
    out.push({ title, ...f, summary, numbers, lpIds, suggestedLpIds });
  }
  return out;
}

export interface ParsedArea { id: string; name: string; short: string; description: string }

/** Header row: name plus optional short and description (and id). Rows without a name are skipped. */
export function parseAreasFromCsv(text: string): ParsedArea[] {
  const rows = splitCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((c) => c.toLowerCase().trim());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iName = col('name', 'area', 'title');
  if (iName < 0) return [];
  const iShort = col('short', 'code', 'abbreviation'), iDesc = col('description', 'details', 'what it means'), iId = col('id');
  const at = (r: string[], i: number): string => (i >= 0 && i < r.length ? r[i] : '');
  const out: ParsedArea[] = [];
  for (const r of rows.slice(1)) {
    const name = at(r, iName);
    if (!name || out.some((a) => loose(a.name) === loose(name))) continue;
    const short = (at(r, iShort) || name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('')).toUpperCase().slice(0, 3);
    const id = (at(r, iId) || loose(name).replace(/\s+/g, '_')).slice(0, 40);
    out.push({ id, name, short, description: at(r, iDesc) });
  }
  return out;
}

/** Story rows from a file: CSV by extension, else the markdown parser (older story files still load). */
export const parseStoriesFile = (name: string, text: string, lps: LpRef[] = DEFAULT_LPS): ParsedStory[] =>
  /\.csv$/i.test(name) ? parseStoriesFromCsv(text, lps) : parseStoriesFromMarkdown(text, lps);

/** What a CSV holds, from its header: stories (STAR columns), areas (name + description) or questions. */
export function csvKind(text: string): 'stories' | 'areas' | 'questions' {
  const head = (splitCsv(text.split(/\r?\n/, 1)[0] ?? '')[0] ?? []).map((c) => c.toLowerCase().trim());
  if (head.some((h) => ['situation', 'action', 'result'].includes(h))) return 'stories';
  if (head.includes('name') && !head.some((h) => ['question', 'text', 'prompt'].includes(h))) return 'areas';
  return 'questions';
}

// ---------- stories from markdown ----------

type Section = 'situation' | 'task' | 'action' | 'result' | 'learning' | 'numbers' | 'summary' | 'lps' | 'other';
const SECTIONS: [RegExp, Section][] = [
  [/^situation/i, 'situation'], [/^task/i, 'task'], [/^actions?$/i, 'action'], [/^action/i, 'action'], [/^results?/i, 'result'], [/^outcome/i, 'result'],
  [/^(learnings?|lessons?( learned)?|what i (learned|took)|takeaways?|reflections?)/i, 'learning'],
  [/^(key )?(numbers|metrics|figures|stats)/i, 'numbers'], [/^(summary|tl;?dr|one-?liner|in one line)/i, 'summary'],
  [/^(lps?|leadership principles?|principles?)$/i, 'lps'],
];
const sectionOf = (label: string): Section | null => { const k = label.trim().replace(/[:*_\s]+$/, ''); for (const [re, s] of SECTIONS) if (re.test(k)) return s; return null; };
const BULLET = /^\s*(?:[-*+•▪]|\d+[.)])\s+/;
const splitList = (s: string): string[] => s.split(/\s*[·•;|]\s*|,\s+(?=[^0-9])/).map((x) => x.trim()).filter(Boolean);

const keyNumber = (line: string): KeyNumber => {
  const m = /^([^:]{1,30}):\s*(.+)$/.exec(line);
  return m && /\d/.test(m[2]) ? { label: m[1].trim(), value: m[2].trim() } : { label: '', value: line.trim() };
};

/** LP names mentioned anywhere in the text, in order of first appearance. */
export function mentionedLps(text: string, lps: LpRef[] = DEFAULT_LPS): string[] {
  const t = ' ' + loose(text) + ' ';
  return lps.map((l) => ({ id: l.id, at: t.indexOf(' ' + loose(l.name) + ' ') })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.id);
}

/**
 * `## heading` → story (a lone `# heading` counts when there are no `##`); `### Situation …` or
 * `**Situation:** …` / `Situation: …` sections; bullets with digits and "Key numbers:" lines →
 * key numbers; LP names in the text → links, else a keyword suggestion.
 */
export function parseStoriesFromMarkdown(text: string, lps: LpRef[] = DEFAULT_LPS): ParsedStory[] {
  const lines = text.split(/\r?\n/);
  const level = lines.some((l) => /^##\s+\S/.test(l)) ? 2 : lines.some((l) => /^#\s+\S/.test(l)) ? 1 : 0;
  if (!level) return [];
  const headRe = new RegExp('^#{' + level + '}\\s+(.+?)\\s*#*\\s*$');
  const subRe = new RegExp('^#{' + (level + 1) + ',6}\\s+(.+?)\\s*#*\\s*$');
  const out: ParsedStory[] = [];
  let cur: (ParsedStory & { paras: string[]; lpLine: string[] }) | null = null;
  let section: Section = 'other';
  const push = () => {
    if (!cur) return;
    const { paras, lpLine, ...story } = cur;
    story.summary = (story.summary || paras.find((p) => p.length > 0) || story.situation.split(/(?<=[.!?])\s/)[0] || '').trim().slice(0, 240);
    const seen = new Set<string>();
    story.numbers = story.numbers.filter((n) => { const k = n.value.toLowerCase(); if (seen.has(k) || !/\d/.test(n.value)) return false; seen.add(k); return true; });
    const named = [...lpLine, ...mentionedLps([story.title, story.summary, story.situation, story.task, story.action, story.result, story.learning].join('\n'), lps)];
    story.lpIds = Array.from(new Set(named.filter(Boolean)));
    if (story.lpIds.length) story.suggestedLpIds = story.lpIds.slice();
    else { const g = guessLp([story.title, story.summary, ...paras, story.situation, story.task, story.action, story.result, story.learning].join(' '), lps); story.suggestedLpIds = [g.lpId, ...g.alternatives].filter(Boolean).slice(0, 2); }
    out.push(story);
  };
  const append = (s: Section, textLine: string) => {
    if (!cur) return;
    const t = textLine.trim();
    if (!t) return;
    if (s === 'numbers') { for (const n of splitList(t.replace(BULLET, ''))) cur.numbers.push(keyNumber(n)); return; }
    if (s === 'lps') { for (const n of splitList(t.replace(BULLET, ''))) { const id = resolveLp(n, lps); if (id) cur.lpLine.push(id); } return; }
    if (s === 'summary') { cur.summary = (cur.summary ? cur.summary + ' ' : '') + t; return; }
    const isBullet = BULLET.test(t);
    const body = t.replace(BULLET, '').replace(/\*\*|__/g, '').trim();
    if (isBullet && /\d/.test(body) && body.length <= 80) cur.numbers.push(keyNumber(body));
    if (s === 'other') { if (!isBullet) cur.paras.push(body); return; }
    cur[s] = (cur[s] ? cur[s] + (isBullet ? '\n' : ' ') : '') + (isBullet ? '- ' + body : body);
  };
  for (const raw of lines) {
    const h = headRe.exec(raw);
    if (h) { push(); cur = { title: h[1].replace(/\*\*|__/g, '').trim(), summary: '', situation: '', task: '', action: '', result: '', learning: '', numbers: [], lpIds: [], suggestedLpIds: [], paras: [], lpLine: [] }; section = 'other'; continue; }
    if (!cur) continue;
    const sub = subRe.exec(raw);
    if (sub) { section = sectionOf(sub[1]) ?? 'other'; continue; }
    // "**Situation:** text", "Situation: text", "Situation —", "LPs: a, b"
    const lab = /^\s*(?:\*\*|__)?([A-Za-z][A-Za-z ;']{1,28}?)(?:\*\*|__)?\s*[:—–-]\s*(?:\*\*|__)?\s*(.*)$/.exec(raw);
    if (lab) {
      const s = sectionOf(lab[1]);
      if (s) { if (s !== 'numbers' && s !== 'lps' && s !== 'summary') section = s; append(s, lab[2]); continue; }
    }
    append(section, raw);
  }
  push();
  return out;
}

// ---------- story × LP grid ----------

const cellRole = (c: string): LpRole | null => {
  const k = c.trim().toLowerCase();
  if (/^(p|primary|●|■|x|✓|✔|yes|y)$/.test(k)) return 'primary';
  if (/^(s|secondary|◆|◇|○)$/.test(k)) return 'secondary';
  return null;
};

/** A markdown table: stories as rows, LPs as columns (name, short or id), cells P / S / x (x counts as primary). */
export function parseStoryGrid(text: string, lps: LpRef[] = DEFAULT_LPS): ParsedGrid {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('|')).map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  if (rows.length < 2) return { lpIds: [], rows: [] };
  const lpIds = rows[0].slice(1).map((h) => resolveLp(h, lps) || null);
  const body = rows.slice(1).filter((r) => !r.every((c) => c === '' || /^:?-{2,}:?$/.test(c)));
  return {
    lpIds,
    rows: body.filter((r) => r[0]).map((r) => ({
      title: r[0].replace(/\*\*|__/g, '').trim(),
      links: r.slice(1).flatMap((c, i) => { const role = cellRole(c); const lpId = lpIds[i]; return role && lpId ? [{ lpId, role }] : []; }),
    })),
  };
}

// ---------- files ----------

/** The prototype's content rules: JD · Past interviews · Background · Other. */
export function detectFileType(text: string): FileType {
  if (/responsibilit|qualification|job description|what you.?ll do|what you will do/i.test(text)) return 'JD';
  if (/interview|\bround\b|\bloop\b|bar raiser|phone screen|feedback/i.test(text)) return 'Past interviews';
  if (/background|experience|resume|\bcv\b/i.test(text)) return 'Background';
  return 'Other';
}

export type FileKind = 'csv' | 'json' | 'zst' | 'text';
export const fileKind = (name: string): FileKind => {
  const n = name.toLowerCase();
  return n.endsWith('.zst') ? 'zst' : n.endsWith('.json') ? 'json' : n.endsWith('.csv') ? 'csv' : 'text';
};

// ---------- Exponent export (.json, or the zstd-compressed .zst — decoded by prep-import's fileText) ----------

interface RawRow { id?: string | number; category?: string[]; data?: { title?: string }; companies?: { name?: string }[]; votes?: number; difficulty?: string; topComment?: { comment?: string } }
interface DistilledRow { id?: string; text?: string; lp_id?: string; difficulty?: number; tags?: string; votes?: number; amazon?: boolean; sample?: string }

/** The raw `{results:[…]}` export or the distilled bank array; null when the text is neither. */
export function parseExponentRows(text: string, lps: LpRef[] = DEFAULT_LPS): ParsedQuestion[] | null {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const list: unknown[] | null = Array.isArray(json) ? json : json && typeof json === 'object' && Array.isArray((json as { results?: unknown }).results) ? (json as { results: unknown[] }).results : null;
  if (!list) return null;
  const out: (ParsedQuestion & { amazon: boolean })[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as RawRow, dist = item as DistilledRow;
    let text = '', lpId = '', difficulty: 1 | 2 | 3 | null = null, tags = '', votes = 0, sample = '', amazon = false;
    if (typeof dist.text === 'string') {
      text = dist.text.trim(); lpId = resolveLp(dist.lp_id ?? '', lps); difficulty = toDifficulty(dist.difficulty); tags = dist.tags ?? ''; votes = dist.votes ?? 0; sample = dist.sample ?? ''; amazon = !!dist.amazon || /amazon|aws/i.test(tags);
    } else if (raw.data && typeof raw.data.title === 'string') {
      const cat = raw.category ?? [];
      text = raw.data.title.trim();
      const behavioural = cat.includes('behavioral') || cat.includes('leadership') || cat.includes('people-management') || BEHAVIOURAL.test(text);
      if (!behavioural) continue;
      const companies = (raw.companies ?? []).map((c) => c.name ?? '').filter(Boolean);
      tags = companies.slice(0, 4).join(', '); votes = raw.votes ?? 0; amazon = companies.some((c) => /amazon|aws/i.test(c));
      difficulty = toDifficulty(raw.difficulty) ?? 2;
      sample = (raw.topComment?.comment ?? '').replace(/\s+/g, ' ').trim().slice(0, 700);
    } else continue;
    if (text.length < 8) continue;
    const key = normaliseQuestion(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const guess = guessLp(text, lps);
    out.push({ text, lpId: lpId || guess.lpId, confidence: lpId ? 'high' : guess.confidence, alternatives: guess.alternatives.filter((a) => a !== lpId), source: 'common', difficulty, tags, votes, sample, amazon });
  }
  out.sort((a, b) => Number(b.amazon) - Number(a.amazon) || b.votes - a.votes);
  return out.map(({ amazon: _a, ...q }) => q);
}
