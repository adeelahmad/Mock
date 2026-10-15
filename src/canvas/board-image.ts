// Mock — the whiteboard as a picture: an SVG of the strokes and notes (light colours, so it
// reads anywhere), and a PNG drawn from it for "Save image".

import { BOARD_H, BOARD_W, type BoardNote, type Ink, type NoteColor, type Shape, type Stroke } from '../domain/board.ts';

const NOTE_W = 200;
const LINE = 18;
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Wraps text to lines of at most `max` characters (long words are cut). */
export function wrap(text: string, max = 26): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (let w of para.split(/\s+/).filter(Boolean)) {
      while (w.length > max) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
      if (!line) line = w; else if ((line + ' ' + w).length <= max) line += ' ' + w; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

const INK: Record<Ink, string> = { ink: '#1B1C1F', blue: '#1A73E8', red: '#D93025', green: '#1E8E3E', gold: '#F9AB00', purple: '#8430CE' };
const NOTE: Record<NoteColor, string> = { yellow: '#FFF2A8', green: '#C9F2C7', pink: '#FFD1DC', blue: '#CFE3FF', purple: '#E4D4FF', white: '#FFFFFF' };

export function boardSvg(notes: BoardNote[], strokes: Stroke[], shapes: Shape[] = []): string {
  const figs = shapes.map((s) => {
    const c = INK[s.color] ?? INK.ink;
    const st = `fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"`;
    if (s.kind === 'rect') return `<rect x="${Math.min(s.x1, s.x2)}" y="${Math.min(s.y1, s.y2)}" width="${Math.abs(s.x2 - s.x1)}" height="${Math.abs(s.y2 - s.y1)}" rx="6" ${st}/>`;
    if (s.kind === 'ellipse') return `<ellipse cx="${(s.x1 + s.x2) / 2}" cy="${(s.y1 + s.y2) / 2}" rx="${Math.abs(s.x2 - s.x1) / 2}" ry="${Math.abs(s.y2 - s.y1) / 2}" ${st}/>`;
    let head = '';
    if (s.kind === 'arrow') {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), l = 14;
      const p = (d: number) => (s.x2 - l * Math.cos(a + d)).toFixed(1) + ',' + (s.y2 - l * Math.sin(a + d)).toFixed(1);
      head = `<polygon points="${s.x2},${s.y2} ${p(0.45)} ${p(-0.45)}" fill="${c}"/>`;
    }
    return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${st}/>${head}`;
  }).join('');
  const ink = strokes.map((s) => {
    let d = 'M' + s.points[0] + ' ' + s.points[1];
    for (let i = 2; i < s.points.length; i += 2) d += 'L' + s.points[i] + ' ' + s.points[i + 1];
    const c = s.color ? INK[s.color] : s.by === 'ai' ? INK.blue : INK.ink;
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${s.hi ? 18 : 3}"${s.hi ? ' opacity="0.38"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const cards = notes.map((n) => {
    const lines = wrap(n.text).slice(0, 12);
    const text = lines.map((l, i) => `<text x="${n.x + 10}" y="${n.y + 42 + i * LINE}" font-size="${n.kind === 'text' ? 16 : 14}"${n.kind === 'text' ? ' font-weight="700"' : ''}>${esc(l)}</text>`).join('');
    if (n.kind === 'text') return text;
    const h = 30 + lines.length * LINE + 8;
    const fill = NOTE[n.color ?? (n.by === 'ai' ? 'blue' : 'yellow')];
    const votes = n.votes ? `<text x="${n.x + NOTE_W - 10}" y="${n.y + 20}" font-size="11" font-weight="700" text-anchor="end">+${n.votes}</text>` : '';
    return `<rect x="${n.x}" y="${n.y}" width="${NOTE_W}" height="${h}" rx="6" fill="${fill}" stroke="#00000022"/><text x="${n.x + 10}" y="${n.y + 20}" font-size="10" font-weight="700" fill="#6B6F76">${n.by === 'ai' ? 'AI' : 'YOU'}</text>${votes}${text}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_W}" height="${BOARD_H}" viewBox="0 0 ${BOARD_W} ${BOARD_H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#1B1C1F"><rect width="100%" height="100%" fill="#FFFFFF"/>${figs}${ink}${cards}</svg>`;
}

/** The board as a PNG (2× for sharpness). */
export async function boardPng(notes: BoardNote[], strokes: Stroke[], shapes: Shape[] = []): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([boardSvg(notes, strokes, shapes)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not draw the board')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = BOARD_W * 2; c.height = BOARD_H * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2); g.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the image'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
