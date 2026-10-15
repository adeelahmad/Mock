// Mock — the canvas whiteboard: pen strokes on an SVG (board units 1000 × 600, so every screen
// and every Meet participant sees the same picture) and notes on top, written by the candidate
// (gold) or the AI (blue). Notes drag by their top bar; the candidate's own notes are edited
// in place. Read-only for a Meet participant watching someone else's canvas.

import React, { useRef, useState } from 'react';
import { BOARD_H, BOARD_W, type BoardNote, type Stroke } from '../domain/canvas.ts';

export interface WhiteboardProps {
  notes: BoardNote[];
  strokes: Stroke[];
  readOnly?: boolean;
  onStroke: (points: number[]) => void;
  onAddNote: (text: string) => void;
  onMoveNote: (id: string, x: number, y: number) => void;
  onEditNote: (id: string, text: string) => void;
  onRemoveNote: (id: string) => void;
  onClear: () => void;
  /** Takes back your last stroke. */
  onUndo?: () => void;
  /** Saves the board as a picture. */
  onSave?: () => void;
}

type Tool = 'pen' | 'move';

const path = (p: number[]): string => {
  let d = 'M' + p[0] + ' ' + p[1];
  for (let i = 2; i < p.length; i += 2) d += 'L' + p[i] + ' ' + p[i + 1];
  return d;
};

export default function Whiteboard({ notes, strokes, readOnly, onStroke, onAddNote, onMoveNote, onEditNote, onRemoveNote, onClear, onUndo, onSave }: WhiteboardProps) {
  const box = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [draft, setDraft] = useState<number[] | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  const toBoard = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOARD_W, ((e.clientY - r.top) / r.height) * BOARD_H];
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || tool !== 'pen' || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft(toBoard(e));
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const [x, y] = toBoard(e);
    const lx = draft[draft.length - 2], ly = draft[draft.length - 1];
    if (Math.hypot(x - lx, y - ly) >= 3) setDraft([...draft, x, y]);
  };
  const up = () => { if (draft) onStroke(draft); setDraft(null); };

  const grab = (n: BoardNote) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
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
    if (d && dragPos?.id === d.id) onMoveNote(d.id, dragPos.x, dragPos.y);
    setDragPos(null);
  };

  return (
    <div className="wb" data-tool={tool}>
      {!readOnly && (
        <div className="wb-tools" role="toolbar" aria-label="Whiteboard">
          <button type="button" className={'cv-tool' + (tool === 'pen' ? ' on' : '')} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button>
          <button type="button" className={'cv-tool' + (tool === 'move' ? ' on' : '')} aria-pressed={tool === 'move'} onClick={() => setTool('move')}>Select</button>
          <button type="button" className="cv-tool" onClick={() => onAddNote('New note')}>+ Note</button>
          {onUndo && <button type="button" className="cv-tool" onClick={onUndo} disabled={!strokes.some((s) => s.by === 'me')}>Undo</button>}
          <span className="grow" />
          {onSave && <button type="button" className="text-btn" onClick={onSave} disabled={!notes.length && !strokes.length}>Save image</button>}
          <button type="button" className="text-btn" onClick={onClear} disabled={!notes.length && !strokes.length}>Clear</button>
        </div>
      )}
      <div className="wb-board" ref={box} style={{ aspectRatio: BOARD_W + ' / ' + BOARD_H }}>
        <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} aria-label="Whiteboard drawing" role="img" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {strokes.map((s) => <path key={s.id} d={path(s.points)} className={'wb-ink ' + s.by} />)}
          {draft && draft.length >= 4 && <path d={path(draft)} className="wb-ink me" />}
        </svg>
        {notes.map((n) => {
          const p = dragPos?.id === n.id ? dragPos : n;
          return (
            <div key={n.id} className={'wb-note ' + n.by} style={{ left: (p.x / BOARD_W) * 100 + '%', top: (p.y / BOARD_H) * 100 + '%' }} data-testid="wb-note">
              <div className="wb-note-bar" onPointerDown={grab(n)} onPointerMove={dragMove} onPointerUp={drop} onPointerCancel={drop}>
                <span>{n.by === 'ai' ? 'AI' : 'You'}</span>
                {!readOnly && <button type="button" className="wb-x" aria-label="Remove note" onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemoveNote(n.id)}>×</button>}
              </div>
              {n.by === 'me' && !readOnly
                ? <textarea className="wb-note-text" aria-label="Note" defaultValue={n.text} onBlur={(e) => { if (e.target.value !== n.text) onEditNote(n.id, e.target.value); }} />
                : <div className="wb-note-text">{n.text}</div>}
            </div>
          );
        })}
        {!notes.length && !strokes.length && <span className="wb-empty sub">Draw here, add a note, or ask the AI to outline your answer.</span>}
      </div>
    </div>
  );
}
