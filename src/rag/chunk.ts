// Mock — splits a prep file into retrieval chunks. Paragraph-aware: headings and blank lines are
// the cut points, a paragraph longer than the target is cut at sentence ends, and each chunk
// carries the nearest heading so a hint reads on its own ("Resume › Payments, 2023: …").

export interface TextChunk { idx: number; heading: string; text: string }

export interface ChunkOptions { target?: number; max?: number }

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

function sentences(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const out: string[] = [];
  let cur = '';
  for (const s of p.split(/(?<=[.!?])\s+/)) {
    if (cur && cur.length + s.length + 1 > max) { out.push(cur); cur = ''; }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue; }
    cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Text → chunks of about `target` characters (never more than `max`), in reading order. */
export function chunkText(text: string, o: ChunkOptions = {}): TextChunk[] {
  const target = o.target ?? 900, max = o.max ?? 1500;
  const out: TextChunk[] = [];
  let heading = '', buf: string[] = [], len = 0;
  const flush = () => {
    const body = buf.join('\n\n').trim();
    if (body) out.push({ idx: out.length, heading, text: body });
    buf = []; len = 0;
  };
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const raw of blocks) {
    const lines = raw.split('\n');
    const rest: string[] = [];
    for (const l of lines) {
      const h = HEADING.exec(l.trim());
      if (h) { if (rest.length) { addPara(rest.join('\n')); rest.length = 0; } flush(); heading = h[1].replace(/\*\*|__/g, '').trim(); }
      else rest.push(l);
    }
    if (rest.length) addPara(rest.join('\n'));
  }
  flush();
  return out;

  function addPara(p: string): void {
    const t = p.trim();
    if (!t) return;
    for (const piece of sentences(t, max)) {
      if (len && len + piece.length > target) flush();
      buf.push(piece); len += piece.length + 2;
    }
  }
}
