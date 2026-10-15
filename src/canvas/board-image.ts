// Mock — the whiteboard as a picture: an SVG of the strokes and notes (light colours, so it
// reads anywhere), and a PNG drawn from it for "Save image".

import { BOARD_H, BOARD_W, type BoardNote, type Stroke } from '../domain/canvas.ts';

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

export function boardSvg(notes: BoardNote[], strokes: Stroke[]): string {
  const ink = strokes.map((s) => {
    let d = 'M' + s.points[0] + ' ' + s.points[1];
    for (let i = 2; i < s.points.length; i += 2) d += 'L' + s.points[i] + ' ' + s.points[i + 1];
    return `<path d="${d}" fill="none" stroke="${s.by === 'ai' ? '#2F6FD8' : '#1B1C1F'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const cards = notes.map((n) => {
    const lines = wrap(n.text).slice(0, 12);
    const h = 30 + lines.length * LINE + 8;
    const [fill, line] = n.by === 'ai' ? ['#E6EEFB', '#9DB8E8'] : ['#FBF1D9', '#E2C27A'];
    const text = lines.map((l, i) => `<text x="${n.x + 10}" y="${n.y + 42 + i * LINE}" font-size="14">${esc(l)}</text>`).join('');
    return `<rect x="${n.x}" y="${n.y}" width="${NOTE_W}" height="${h}" rx="10" fill="${fill}" stroke="${line}"/><text x="${n.x + 10}" y="${n.y + 20}" font-size="10" font-weight="700" fill="#6B6F76">${n.by === 'ai' ? 'AI' : 'YOU'}</text>${text}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_W}" height="${BOARD_H}" viewBox="0 0 ${BOARD_W} ${BOARD_H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#1B1C1F"><rect width="100%" height="100%" fill="#FFFFFF"/>${ink}${cards}</svg>`;
}

/** The board as a PNG (2× for sharpness). */
export async function boardPng(notes: BoardNote[], strokes: Stroke[]): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([boardSvg(notes, strokes)], { type: 'image/svg+xml' }));
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
