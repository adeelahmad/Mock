// Mock — the whiteboard as plain data that a whole Meet call can edit at once. Items are
// sticky notes and text, pen and highlighter strokes, and shapes (rectangle, ellipse, line,
// arrow). Every item carries `t`, when it last changed, and a removed item's id goes into
// `gone`; two boards merge item by item (newest `t` wins, removed stays removed), so everyone's
// edits survive even when two people change the board at the same moment. Units: 1000 × 600.

export type Who = 'me' | 'ai';
export type Ink = 'ink' | 'blue' | 'red' | 'green' | 'gold' | 'purple';
export type NoteColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple' | 'white';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

export interface BoardNote {
  id: string; x: number; y: number; text: string; by: Who;
  /** Sticky colour; text items have none. */
  color?: NoteColor;
  kind?: 'sticky' | 'text';
  /** Dot votes. */
  votes?: number;
  t?: number;
}
/** A pen stroke: flat [x0, y0, x1, y1, …]. */
export interface Stroke { id: string; points: number[]; by: Who; color?: Ink; /** Highlighter: wide and see-through. */ hi?: boolean; t?: number }
export interface Shape { id: string; kind: ShapeKind; x1: number; y1: number; x2: number; y2: number; color: Ink; by: Who; t?: number }
/** A countdown everyone sees: ends at `end` (ms since epoch), set at `t`. */
export interface Timer { end: number | null; t: number }
/**
 * Who everyone follows ("Bring everyone here"): their view of the board, zoom and scroll as a
 * fraction of the scrollable range. `who` is empty when nobody leads.
 */
export interface Lead { who: string; name: string; zoom: number; x: number; y: number; t: number }

export interface Board {
  notes: BoardNote[];
  strokes: Stroke[];
  shapes: Shape[];
  /** Ids of removed items, newest last. */
  gone: string[];
  timer: Timer;
  lead: Lead;
}

export const BOARD_W = 1000;
export const BOARD_H = 600;
export const NOTE_W = 200;
export const NOTE_H = 120;
const GONE_MAX = 600;

let seq = 0;
export const newId = (p: string): string => p + '_' + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const now = (): number => Date.now();

export const NO_LEAD: Lead = { who: '', name: '', zoom: 1, x: 0, y: 0, t: 0 };
export const emptyBoard = (): Board => ({ notes: [], strokes: [], shapes: [], gone: [], timer: { end: null, t: 0 }, lead: NO_LEAD });
export const boardOf = <B extends Board>(s: B): Board => ({ notes: s.notes, strokes: s.strokes, shapes: s.shapes, gone: s.gone, timer: s.timer, lead: s.lead ?? NO_LEAD });
export const isEmpty = (b: Board): boolean => !b.notes.length && !b.strokes.length && !b.shapes.length;

const goneWith = (gone: string[], ids: string[]): string[] => { const g = [...gone, ...ids.filter((id) => !gone.includes(id))]; return g.length > GONE_MAX ? g.slice(g.length - GONE_MAX) : g; };

// ---------- Notes ----------

export function addNote<B extends Board>(b: B, text: string, by: Who, at?: { x: number; y: number }, style: { color?: NoteColor; kind?: 'sticky' | 'text' } = {}): B {
  const n = b.notes.length;
  const x = at?.x ?? 40 + (n % 4) * 230;
  const y = at?.y ?? 40 + (Math.floor(n / 4) % 3) * 180;
  const kind = style.kind ?? 'sticky';
  const note: BoardNote = { id: newId('n'), x: clamp(x, 0, BOARD_W - NOTE_W), y: clamp(y, 0, BOARD_H - NOTE_H), text: text.trim(), by, t: now() };
  if (kind === 'text') note.kind = 'text'; else note.color = style.color ?? (by === 'ai' ? 'blue' : 'yellow');
  return { ...b, notes: [...b.notes, note] };
}
const patchNote = <B extends Board>(b: B, id: string, f: (n: BoardNote) => BoardNote): B => ({ ...b, notes: b.notes.map((n) => (n.id === id ? { ...f(n), t: now() } : n)) });
export const moveNote = <B extends Board>(b: B, id: string, x: number, y: number): B => patchNote(b, id, (n) => ({ ...n, x: clamp(x, 0, BOARD_W - NOTE_W), y: clamp(y, 0, BOARD_H - NOTE_H) }));
export const editNote = <B extends Board>(b: B, id: string, text: string): B => patchNote(b, id, (n) => ({ ...n, text }));
export const colorNote = <B extends Board>(b: B, id: string, color: NoteColor): B => patchNote(b, id, (n) => (n.kind === 'text' ? n : { ...n, color }));
export const voteNote = <B extends Board>(b: B, id: string, delta = 1): B => patchNote(b, id, (n) => ({ ...n, votes: Math.max(0, (n.votes ?? 0) + delta) }));

// ---------- Strokes and shapes ----------

export const addStroke = <B extends Board>(b: B, points: number[], by: Who, style: { color?: Ink; hi?: boolean } = {}): B =>
  (points.length >= 4 ? { ...b, strokes: [...b.strokes, { id: newId('s'), points: points.map((v) => Math.round(v)), by, ...(style.color && style.color !== 'ink' ? { color: style.color } : {}), ...(style.hi ? { hi: true } : {}), t: now() }] } : b);

export function addShape<B extends Board>(b: B, kind: ShapeKind, x1: number, y1: number, x2: number, y2: number, color: Ink, by: Who): B {
  if (Math.hypot(x2 - x1, y2 - y1) < 6) return b;
  const c = (v: number, hi: number) => Math.round(clamp(v, 0, hi));
  return { ...b, shapes: [...b.shapes, { id: newId('h'), kind, x1: c(x1, BOARD_W), y1: c(y1, BOARD_H), x2: c(x2, BOARD_W), y2: c(y2, BOARD_H), color, by, t: now() }] };
}
export const moveShape = <B extends Board>(b: B, id: string, dx: number, dy: number): B =>
  ({ ...b, shapes: b.shapes.map((s) => (s.id === id ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, t: now() } : s)) });

/** Removes any items by id (note, stroke or shape). */
export function remove<B extends Board>(b: B, ids: string[]): B {
  if (!ids.length) return b;
  const del = new Set(ids);
  return { ...b, notes: b.notes.filter((n) => !del.has(n.id)), strokes: b.strokes.filter((s) => !del.has(s.id)), shapes: b.shapes.filter((s) => !del.has(s.id)), gone: goneWith(b.gone, ids) };
}
export const removeNote = <B extends Board>(b: B, id: string): B => remove(b, [id]);
export const clearBoard = <B extends Board>(b: B): B => remove(b, [...b.notes, ...b.strokes, ...b.shapes].map((x) => x.id));

/** The stroke or shape under a point (the eraser), within `r` board units; topmost first. */
export function hitAt(b: Board, x: number, y: number, r = 10): string | null {
  for (let i = b.shapes.length - 1; i >= 0; i--) {
    const s = b.shapes[i];
    const lx = Math.min(s.x1, s.x2), hx = Math.max(s.x1, s.x2), ly = Math.min(s.y1, s.y2), hy = Math.max(s.y1, s.y2);
    if (s.kind === 'line' || s.kind === 'arrow') { if (segDist(x, y, s.x1, s.y1, s.x2, s.y2) <= r) return s.id; }
    else if (x >= lx - r && x <= hx + r && y >= ly - r && y <= hy + r && !(x > lx + r && x < hx - r && y > ly + r && y < hy - r)) return s.id;
  }
  for (let i = b.strokes.length - 1; i >= 0; i--) {
    const p = b.strokes[i].points;
    for (let j = 0; j + 3 < p.length; j += 2) if (segDist(x, y, p[j], p[j + 1], p[j + 2], p[j + 3]) <= r + (b.strokes[i].hi ? 8 : 0)) return b.strokes[i].id;
  }
  return null;
}
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Your last stroke or shape, taken back. */
export function undoStroke<B extends Board>(b: B): B {
  const mine = [...b.strokes, ...b.shapes].filter((x) => x.by === 'me').sort((p, q) => (p.t ?? 0) - (q.t ?? 0));
  const last = mine[mine.length - 1];
  return last ? remove(b, [last.id]) : b;
}

// ---------- Timer ----------

export const setTimer = <B extends Board>(b: B, ms: number | null, at = now()): B => ({ ...b, timer: { end: ms == null ? null : at + ms, t: at } });

// ---------- Following ----------

/** Starts leading, or moves the leader's view (zoom, scroll fractions 0…1). */
export const lead = <B extends Board>(b: B, who: string, name: string, view: { zoom: number; x: number; y: number }, at = now()): B =>
  ({ ...b, lead: { who, name, zoom: view.zoom, x: Math.max(0, Math.min(1, view.x)), y: Math.max(0, Math.min(1, view.y)), t: at } });
/** Stops leading (only the leader's own stop counts). */
export const stopLead = <B extends Board>(b: B, who: string, at = now()): B => ((b.lead ?? NO_LEAD).who === who ? { ...b, lead: { ...NO_LEAD, t: at } } : b);

// ---------- Undo history ----------

/**
 * Goes back (or forward) to `snap` as a new change, so it shares like any other edit: items
 * added since are removed, and items removed since come back under new ids (their old ids stay
 * removed for everyone who saw them go).
 */
export function restore<B extends Board>(cur: B, snap: Board): B {
  const keep = new Set([...snap.notes, ...snap.strokes, ...snap.shapes].map((x) => x.id));
  const here = new Set([...cur.notes, ...cur.strokes, ...cur.shapes].map((x) => x.id));
  const drop = [...here].filter((id) => !keep.has(id));
  const t = now();
  const back = remove(cur, drop);
  const revive = <T extends { id: string; t?: number }>(x: T, p: string): T => ({ ...x, id: here.has(x.id) ? x.id : newId(p), t });
  return { ...back, notes: snap.notes.map((n) => revive(n, 'n')), strokes: snap.strokes.map((x) => revive(x, 's')), shapes: snap.shapes.map((x) => revive(x, 'h')) };
}

// ---------- Merging two people's boards ----------

function mergeItems<T extends { id: string; t?: number }>(a: T[], b: T[], gone: Set<string>): T[] {
  const m = new Map<string, T>();
  for (const x of a) if (!gone.has(x.id)) m.set(x.id, x);
  for (const x of b) {
    if (gone.has(x.id)) continue;
    const have = m.get(x.id);
    if (!have || (x.t ?? 0) >= (have.t ?? 0)) m.set(x.id, x);
  }
  // Keep a stable order: by first change.
  return [...m.values()];
}

/** Both boards' edits: newest change of each item wins, removed items stay removed. */
export function mergeBoards<B extends Board>(mine: B, theirs: Board): B {
  const gone = goneWith(mine.gone ?? [], theirs.gone ?? []);
  const g = new Set(gone);
  return {
    ...mine,
    notes: mergeItems(mine.notes, theirs.notes ?? [], g),
    strokes: mergeItems(mine.strokes, theirs.strokes ?? [], g),
    shapes: mergeItems(mine.shapes ?? [], theirs.shapes ?? [], g),
    gone,
    timer: (theirs.timer?.t ?? 0) > (mine.timer?.t ?? 0) ? theirs.timer : mine.timer,
    lead: (theirs.lead?.t ?? 0) > (mine.lead?.t ?? 0) ? theirs.lead : (mine.lead ?? NO_LEAD),
  };
}

/** True when `a` has something `b` lacks (so `a`'s owner should send it again). */
export function hasMore(a: Board, b: Board): boolean {
  const key = (x: { id: string; t?: number }) => x.id + '@' + (x.t ?? 0);
  const have = new Set([...b.notes, ...b.strokes, ...b.shapes].map(key));
  if ([...a.notes, ...a.strokes, ...a.shapes].some((x) => !have.has(key(x)))) return true;
  const g = new Set(b.gone);
  return a.gone.some((id) => !g.has(id)) || a.timer.t > b.timer.t || (a.lead?.t ?? 0) > (b.lead?.t ?? 0);
}

// ---------- Templates ----------

export type TemplateId = 'star' | 'pros' | 'timeline' | 'map';
export const TEMPLATES: { id: TemplateId; name: string }[] = [
  { id: 'star', name: 'STAR answer' },
  { id: 'pros', name: 'Pros and cons' },
  { id: 'timeline', name: 'Timeline' },
  { id: 'map', name: 'Story map' },
];

/** Lays a template on the board: frames (rectangles), titles (text) and starter notes. */
export function addTemplate<B extends Board>(b: B, id: TemplateId, by: Who = 'me'): B {
  let x: B = b;
  const frame = (x1: number, y1: number, x2: number, y2: number, color: Ink) => { x = addShape(x, 'rect', x1, y1, x2, y2, color, by); };
  const title = (t: string, px: number, py: number) => { x = addNote(x, t, by, { x: px, y: py }, { kind: 'text' }); };
  const sticky = (t: string, px: number, py: number, color: NoteColor) => { x = addNote(x, t, by, { x: px, y: py }, { color }); };
  if (id === 'star') {
    const cols: [string, NoteColor, string][] = [['Situation', 'blue', 'Where, when, what was at stake'], ['Task', 'purple', 'What you owned'], ['Action', 'yellow', 'What you did, step by step (I, not we)'], ['Result', 'green', 'The number, and what you learned']];
    cols.forEach(([t, c, hint], i) => { const x1 = 10 + i * 247; frame(x1, 10, x1 + 237, 590, 'ink'); title(t, x1 + 12, 18); sticky(hint, x1 + 18, 80, c); });
  } else if (id === 'pros') {
    frame(10, 10, 495, 590, 'green'); frame(505, 10, 990, 590, 'red');
    title('Pros', 24, 18); title('Cons', 519, 18);
    sticky('What went well', 30, 80, 'green'); sticky('What you would change', 525, 80, 'pink');
  } else if (id === 'timeline') {
    x = addShape(x, 'arrow', 30, 300, 970, 300, 'ink', by);
    ['Before', 'Trigger', 'What you did', 'Outcome', 'After'].forEach((t, i) => { const px = 30 + i * 190; title(t, px, 320); sticky('…', px, 130, i === 3 ? 'green' : 'yellow'); });
  } else {
    frame(10, 10, 990, 140, 'blue'); title('Story: one line', 24, 18);
    frame(10, 150, 495, 590, 'ink'); title('Areas it proves', 24, 158);
    frame(505, 150, 990, 590, 'ink'); title('Numbers to say', 519, 158);
    sticky('Area 1', 30, 220, 'purple'); sticky('e.g. cut p99 by 40%', 525, 220, 'green');
  }
  return x;
}
