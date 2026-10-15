// Mock — the canvas whiteboard, built like the whiteboards people use in Meet: sticky notes in
// colours, text, pen and highlighter in colours, an eraser, rectangles, ellipses, lines and
// arrows, templates, dot votes on notes, a timer everyone sees, zoom, and undo/redo. Board
// units are 1000 × 600 so every screen and every Meet participant sees the same picture; the
// data and the rules (and how two people's edits merge) live in domain/board.ts.

import React, { useEffect, useRef, useState } from 'react';
import {
  BOARD_H, BOARD_W, NOTE_W, TEMPLATES, addNote, addShape, addStroke, addTemplate, boardOf, clearBoard, colorNote, editNote, hitAt, isEmpty,
  moveNote, moveShape, remove, restore, setTimer, voteNote, type Board, type BoardNote, type Ink, type NoteColor, type Shape, type ShapeKind,
} from '../domain/board.ts';

export interface WhiteboardProps {
  board: Board;
  readOnly?: boolean;
  /** A change to the board (the caller keeps the state, and shares it in a Meet call). */
  onChange: (f: (b: Board) => Board) => void;
  /** Saves the board as a picture. */
  onSave?: () => void;
}

type Tool = 'select' | 'pen' | 'hi' | 'eraser' | 'sticky' | 'text' | ShapeKind;

const TOOLS: [Tool, string][] = [
  ['select', 'Select'], ['pen', 'Pen'], ['hi', 'Highlighter'], ['eraser', 'Eraser'], ['sticky', 'Sticky note'], ['text', 'Text'],
  ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['arrow', 'Arrow'],
];
const GLYPH: Record<Tool, React.ReactNode> = {
  select: <path d="M5 3l14 8-6 2-2 6z" />,
  pen: <path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3" />,
  hi: <path d="M9 15l-4 5h6l2-3M9 15l7-11 4 3-7 11z" />,
  eraser: <path d="M8 20h12M5 15l9-9 5 5-8 8H8z" />,
  sticky: <path d="M5 4h14v10l-6 6H5zM13 20v-6h6" />,
  text: <path d="M5 5h14M12 5v15M9 20h6" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  line: <path d="M5 19L19 5" />,
  arrow: <path d="M5 19L19 5M10 5h9v9" />,
};
const INKS: Ink[] = ['ink', 'blue', 'red', 'green', 'gold', 'purple'];
const NOTE_COLORS: NoteColor[] = ['yellow', 'green', 'pink', 'blue', 'purple', 'white'];
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const TIMES = [1, 2, 3, 5];
const UNDO_MAX = 60;

const path = (p: number[]): string => {
  let d = 'M' + p[0] + ' ' + p[1];
  for (let i = 2; i < p.length; i += 2) d += 'L' + p[i] + ' ' + p[i + 1];
  return d;
};
const clock = (ms: number): string => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function beep(): void {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new C(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.6); o.onended = () => void ctx.close();
  } catch { /* no audio */ }
}

function ShapeView({ s, selected }: { s: Shape; selected?: boolean }) {
  const cls = 'wb-shape c-' + s.color + (selected ? ' sel' : '');
  if (s.kind === 'rect') return <rect className={cls} x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)} rx={6} data-id={s.id} />;
  if (s.kind === 'ellipse') return <ellipse className={cls} cx={(s.x1 + s.x2) / 2} cy={(s.y1 + s.y2) / 2} rx={Math.abs(s.x2 - s.x1) / 2} ry={Math.abs(s.y2 - s.y1) / 2} data-id={s.id} />;
  return <line className={cls} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} markerEnd={s.kind === 'arrow' ? 'url(#wb-head-' + s.color + ')' : undefined} data-id={s.id} />;
}

export default function Whiteboard({ board, readOnly, onChange, onSave }: WhiteboardProps) {
  const { notes, strokes, shapes, timer } = board;
  const box = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [ink, setInk] = useState<Ink>('ink');
  const [noteColor, setNoteColor] = useState<NoteColor>('yellow');
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<'templates' | 'timer' | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [shapeDraft, setShapeDraft] = useState<Shape | null>(null);
  const erasing = useRef(false);
  const shapeDrag = useRef<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const [shapeOffset, setShapeOffset] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  // Undo/redo: snapshots of the board before each of your changes.
  const past = useRef<Board[]>([]);
  const future = useRef<Board[]>([]);
  const cur = useRef(board); cur.current = board;
  const [, bump] = useState(0);
  const change = (f: (b: Board) => Board) => {
    past.current = [...past.current.slice(-UNDO_MAX + 1), boardOf(cur.current)];
    future.current = [];
    onChange(f);
    bump((n) => n + 1);
  };
  const undo = () => { const snap = past.current.pop(); if (!snap) return; future.current.push(boardOf(cur.current)); onChange((b) => restore(b, snap)); bump((n) => n + 1); };
  const redo = () => { const snap = future.current.pop(); if (!snap) return; past.current.push(boardOf(cur.current)); onChange((b) => restore(b, snap)); bump((n) => n + 1); };

  // Keys: ⌘Z / ⇧⌘Z, Delete for the selected item, Escape. Never while typing.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    if (readOnly || typing(e.target)) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((k === 'delete' || k === 'backspace') && selected) { e.preventDefault(); change((b) => remove(b, [selected])); setSelected(null); return; }
    if (k === 'escape') { setSelected(null); setMenu(null); }
  };
  useEffect(() => { const on = (e: KeyboardEvent) => keys.current(e); window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on); }, []);

  // The shared timer: ticks while running, beeps once at zero.
  const [, tick] = useState(0);
  const beeped = useRef<number | null>(null);
  const left = timer.end ? timer.end - Date.now() : null;
  useEffect(() => {
    if (!timer.end) return;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (timer.end && Date.now() >= timer.end && beeped.current !== timer.end) { beeped.current = timer.end; beep(); }
    }, 500);
    return () => clearInterval(t);
  }, [timer.end]);

  const toBoard = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOARD_W, ((e.clientY - r.top) / r.height) * BOARD_H];
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || e.button > 0) return;
    const [x, y] = toBoard(e);
    setMenu(null);
    if (tool === 'sticky' || tool === 'text') {
      change((b) => addNote(b, tool === 'text' ? 'Text' : '', 'me', { x: x - (tool === 'text' ? 20 : NOTE_W / 2), y: y - 20 }, tool === 'text' ? { kind: 'text' } : { color: noteColor }));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen' || tool === 'hi') { setDraft([x, y]); return; }
    if (tool === 'eraser') { erasing.current = true; const id = hitAt(cur.current, x, y); if (id) change((b) => remove(b, [id])); return; }
    if (tool === 'select') {
      const id = hitAt(cur.current, x, y, 8);
      setSelected(id);
      if (id && shapes.some((s) => s.id === id)) shapeDrag.current = { id, x, y, dx: 0, dy: 0 };
      return;
    }
    setShapeDraft({ id: 'draft', kind: tool, x1: x, y1: y, x2: x, y2: y, color: ink, by: 'me' });
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const [x, y] = toBoard(e);
    if (draft) {
      const lx = draft[draft.length - 2], ly = draft[draft.length - 1];
      if (Math.hypot(x - lx, y - ly) >= 3) setDraft([...draft, x, y]);
    } else if (shapeDraft) setShapeDraft({ ...shapeDraft, x2: x, y2: y });
    else if (erasing.current) { const id = hitAt(cur.current, x, y); if (id) change((b) => remove(b, [id])); }
    else if (shapeDrag.current) { const d = shapeDrag.current; d.dx = x - d.x; d.dy = y - d.y; setShapeOffset({ id: d.id, dx: d.dx, dy: d.dy }); }
  };
  const up = () => {
    if (draft) { const pts = draft; const hi = tool === 'hi'; change((b) => addStroke(b, pts, 'me', { color: hi && ink === 'ink' ? 'gold' : ink, hi })); }
    if (shapeDraft) { const s = shapeDraft; change((b) => addShape(b, s.kind, s.x1, s.y1, s.x2, s.y2, s.color, 'me')); }
    const d = shapeDrag.current;
    if (d && Math.hypot(d.dx, d.dy) > 1) change((b) => moveShape(b, d.id, Math.round(d.dx), Math.round(d.dy)));
    shapeDrag.current = null; setShapeOffset(null);
    erasing.current = false; setDraft(null); setShapeDraft(null);
  };

  const grab = (n: BoardNote) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    setSelected(n.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toBoard(e);
    drag.current = { id: n.id, dx: x - n.x, dy: y - n.y };
  };
  const dragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const [x, y] = toBoard(e);
    setDragPos({ id: d.id, x: x - d.dx, y: y - d.dy });
  };
  const drop = () => {
    const d = drag.current; drag.current = null;
    if (d && dragPos?.id === d.id) { const p = dragPos; change((b) => moveNote(b, d.id, p.x, p.y)); }
    setDragPos(null);
  };

  const sel = notes.find((n) => n.id === selected) ?? null;
  const pickColor = (c: NoteColor) => { setNoteColor(c); if (sel && sel.kind !== 'text') change((b) => colorNote(b, sel.id, c)); };
  const zoomBy = (dir: 1 | -1) => setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + dir))] ?? 1);
  const empty = isEmpty(board);
  const showsNotes = tool === 'sticky' || (tool === 'select' && sel && sel.kind !== 'text');

  return (
    <div className="wb" data-tool={tool}>
      {!readOnly && (
        <div className="wb-bar">
          <div className="wb-tools" role="toolbar" aria-label="Whiteboard tools">
            {TOOLS.map(([t, name]) => (
              <button key={t} type="button" className={'wb-tool' + (tool === t ? ' on' : '')} aria-pressed={tool === t} aria-label={name} title={name} onClick={() => { setTool(t); setMenu(null); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{GLYPH[t]}</svg>
              </button>
            ))}
            <span className="wb-sep" />
            <button type="button" className="wb-tool" aria-label="Undo board change" title="Undo (⌘Z)" disabled={!past.current.length} onClick={undo}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></svg></button>
            <button type="button" className="wb-tool" aria-label="Redo board change" title="Redo (⇧⌘Z)" disabled={!future.current.length} onClick={redo}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></svg></button>
          </div>
          <div className="wb-tools" role="toolbar" aria-label="Board">
            <div className="wb-pop">
              <button type="button" className={'cv-tool' + (menu === 'templates' ? ' on' : '')} aria-expanded={menu === 'templates'} onClick={() => setMenu(menu === 'templates' ? null : 'templates')}>Templates</button>
              {menu === 'templates' && (
                <div className="wb-menu" role="menu">
                  {TEMPLATES.map((t) => <button key={t.id} type="button" role="menuitem" onClick={() => { change((b) => addTemplate(b, t.id)); setMenu(null); setTool('select'); }}>{t.name}</button>)}
                </div>
              )}
            </div>
            <div className="wb-pop">
              <button type="button" className={'cv-tool' + (left != null ? ' on' : '')} aria-expanded={menu === 'timer'} onClick={() => setMenu(menu === 'timer' ? null : 'timer')}>
                {left == null ? 'Timer' : left > 0 ? <span className="mono" role="timer">{clock(left)}</span> : 'Time’s up'}
              </button>
              {menu === 'timer' && (
                <div className="wb-menu" role="menu">
                  {TIMES.map((m) => <button key={m} type="button" role="menuitem" onClick={() => { change((b) => setTimer(b, m * 60_000)); setMenu(null); }}>{m} min for everyone</button>)}
                  {timer.end && <button type="button" role="menuitem" onClick={() => { change((b) => setTimer(b, null)); setMenu(null); }}>Stop the timer</button>}
                </div>
              )}
            </div>
            <span className="wb-zoom" role="group" aria-label="Zoom">
              <button type="button" className="wb-tool" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => zoomBy(-1)}>−</button>
              <button type="button" className="wb-z mono" aria-label="Fit the board" title="Fit" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" className="wb-tool" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => zoomBy(1)}>+</button>
            </span>
            {onSave && <button type="button" className="text-btn" onClick={onSave} disabled={empty}>Save image</button>}
            <button type="button" className="text-btn" onClick={() => change(clearBoard)} disabled={empty}>Clear</button>
          </div>
          {/* Always there, so picking a tool never moves the board. */}
          <div className="wb-tools wb-colors" role="group" aria-label="Colour">
            {showsNotes
              ? NOTE_COLORS.map((c) => <button key={c} type="button" className={'wb-swatch n-' + c + ((sel?.color ?? noteColor) === c ? ' on' : '')} aria-label={c} aria-pressed={(sel?.color ?? noteColor) === c} onClick={() => pickColor(c)} />)
              : INKS.map((c) => <button key={c} type="button" className={'wb-swatch k-' + c + (ink === c ? ' on' : '')} aria-label={c === 'ink' ? 'black' : c} aria-pressed={ink === c} onClick={() => setInk(c)} />)}
          </div>
        </div>
      )}
      <div className="wb-viewport">
        <div className="wb-board" ref={box} style={{ aspectRatio: BOARD_W + ' / ' + BOARD_H, width: zoom * 100 + '%', ['--wb-z' as string]: String(zoom) }}>
          <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} aria-label="Whiteboard drawing" role="img" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <defs>
              {INKS.map((c) => <marker key={c} id={'wb-head-' + c} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className={'wb-head c-' + c} /></marker>)}
            </defs>
            {shapes.map((s) => {
              const o = shapeOffset?.id === s.id ? shapeOffset : null;
              return <ShapeView key={s.id} s={o ? { ...s, x1: s.x1 + o.dx, y1: s.y1 + o.dy, x2: s.x2 + o.dx, y2: s.y2 + o.dy } : s} selected={selected === s.id} />;
            })}
            {strokes.map((s) => <path key={s.id} d={path(s.points)} className={'wb-ink ' + s.by + (s.color ? ' c-' + s.color : '') + (s.hi ? ' hi' : '') + (selected === s.id ? ' sel' : '')} />)}
            {draft && draft.length >= 4 && <path d={path(draft)} className={'wb-ink me' + (ink !== 'ink' || tool === 'hi' ? ' c-' + (tool === 'hi' && ink === 'ink' ? 'gold' : ink) : '') + (tool === 'hi' ? ' hi' : '')} />}
            {shapeDraft && <ShapeView s={shapeDraft} />}
          </svg>
          {notes.map((n) => {
            const p = dragPos?.id === n.id ? dragPos : n;
            const text = n.kind === 'text';
            return (
              <div key={n.id} className={'wb-note ' + n.by + (text ? ' text' : ' n-' + (n.color ?? (n.by === 'ai' ? 'blue' : 'yellow'))) + (selected === n.id ? ' sel' : '')} style={{ left: (p.x / BOARD_W) * 100 + '%', top: (p.y / BOARD_H) * 100 + '%' }} data-testid="wb-note">
                <div className="wb-note-bar" onPointerDown={grab(n)} onPointerMove={dragMove} onPointerUp={drop} onPointerCancel={drop}>
                  <span>{n.by === 'ai' ? 'AI' : text ? '' : 'You'}</span>
                  <span className="hstack">
                    {!text && <button type="button" className={'wb-vote' + (n.votes ? ' on' : '')} aria-label={'Vote · ' + (n.votes ?? 0)} title="Vote" disabled={readOnly} onPointerDown={(e) => e.stopPropagation()} onClick={() => change((b) => voteNote(b, n.id))}>+{n.votes ? ' ' + n.votes : ''}</button>}
                    {!readOnly && <button type="button" className="wb-x" aria-label="Remove note" onPointerDown={(e) => e.stopPropagation()} onClick={() => change((b) => remove(b, [n.id]))}>×</button>}
                  </span>
                </div>
                {!readOnly
                  ? <textarea key={n.id + ':' + (n.t ?? 0)} className="wb-note-text" aria-label={text ? 'Text' : 'Note'} placeholder={text ? 'Text' : 'Type…'} defaultValue={n.text} autoFocus={!n.text} onFocus={() => setSelected(n.id)} onBlur={(e) => { if (e.target.value !== n.text) { const v = e.target.value; change((b) => editNote(b, n.id, v)); } }} />
                  : <div className="wb-note-text">{n.text}</div>}
              </div>
            );
          })}
          {empty && <span className="wb-empty sub">Draw, add sticky notes and shapes, pick a template, or ask the AI to outline your answer.</span>}
        </div>
      </div>
    </div>
  );
}
