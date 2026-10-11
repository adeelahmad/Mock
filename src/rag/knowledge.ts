// Mock — the knowledge index over the prep files (resume, notes, past loops, PDFs). Each included
// file is chunked (`chunk.ts`) and, with a Gemini key, embedded (`embed.ts`); the index lives in
// the blob store under `rag:index` (derived data: never in backups, rebuilt when a file changes).
// Search ranks by cosine similarity when the chunks have vectors and falls back to keyword
// overlap when they don't (no key, the demo, an embedding call that failed), so a hint is always
// there. Small by design: a few hundred chunks × 768 floats is a millisecond scan.

import type { Repo } from '../db/repo.ts';
import type { PrepFile } from '../domain/types.ts';
import { chunkText } from './chunk.ts';
import type { Embedder } from './embed.ts';

export const INDEX_KEY = 'rag:index';
const INDEX_VERSION = 1;

export interface Chunk { id: string; fileId: string; fileName: string; heading: string; text: string; vec: number[] | null }
export interface IndexedFile { id: string; name: string; updatedAt: string; size: number; chunks: number; embedded: boolean }
export interface Hit { fileId: string; fileName: string; heading: string; text: string; score: number }
export interface IndexStatus { files: number; chunks: number; embedded: number }

interface Stored { v: number; files: IndexedFile[]; chunks: (Omit<Chunk, 'vec'> & { vec: string | null })[] }

// Vectors are stored as base64 Float32 to keep the blob small.
const encodeVec = (v: number[]): string => {
  const b = new Uint8Array(new Float32Array(v).buffer);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const decodeVec = (s: string): number[] => {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(b.buffer));
};

const STOP = new Set('a an and are as at be been but by did do for from had has have how i if in into is it its me my of on or our so that the their them then there they this to was we were what when where which who why will with you your about tell time describe give example'.split(' '));
export const terms = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'+-]*/gu) ?? []).map((w) => w.replace(/'s$/, '')).filter((w) => w.length > 1 && !STOP.has(w));

const dot = (a: number[], b: number[]): number => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };

/** What the embedding sees: the heading gives a chunk its context. */
export const embedText = (c: Pick<Chunk, 'fileName' | 'heading' | 'text'>): string => (c.heading ? c.fileName + ' › ' + c.heading + '\n' : c.fileName + '\n') + c.text;

export class KnowledgeIndex {
  private files: IndexedFile[] = [];
  private chunks: Chunk[] = [];
  private queryCache = new Map<string, number[]>();

  constructor(private repo: Repo) {}

  static async load(repo: Repo): Promise<KnowledgeIndex> {
    const k = new KnowledgeIndex(repo);
    try {
      const blob = await repo.getBlob(INDEX_KEY);
      if (blob) {
        const s = JSON.parse(await blob.text()) as Stored;
        if (s.v === INDEX_VERSION) {
          k.files = s.files;
          k.chunks = s.chunks.map((c) => ({ ...c, vec: c.vec ? decodeVec(c.vec) : null }));
        }
      }
    } catch { /* a corrupt index is rebuilt by the next sync */ }
    return k;
  }

  status(): IndexStatus { return { files: this.files.length, chunks: this.chunks.length, embedded: this.chunks.filter((c) => c.vec).length }; }
  list(): IndexedFile[] { return this.files.slice(); }

  /** True when `files` differ from what is indexed (or chunks are waiting for vectors and an embedder is available). */
  stale(files: PrepFile[], canEmbed: boolean): boolean {
    const inc = files.filter((f) => f.included && f.content.trim());
    if (inc.length !== this.files.length) return true;
    return inc.some((f) => { const x = this.files.find((i) => i.id === f.id); return !x || x.updatedAt !== f.updatedAt || x.size !== f.size || x.name !== f.name || (canEmbed && !x.embedded && x.chunks > 0); });
  }

  /**
   * Brings the index in line with the included files: new or changed files are chunked and
   * embedded, removed or excluded ones dropped. An embedding failure keeps the chunks (keyword
   * search still works) and is rethrown after saving.
   */
  async sync(files: PrepFile[], embed: Embedder | null, onProgress?: (done: number, total: number) => void): Promise<IndexStatus> {
    const inc = files.filter((f) => f.included && f.content.trim());
    const keep = new Set<string>();
    const todo: PrepFile[] = [];
    for (const f of inc) {
      const x = this.files.find((i) => i.id === f.id);
      if (x && x.updatedAt === f.updatedAt && x.size === f.size && x.name === f.name && (x.embedded || !embed || x.chunks === 0)) keep.add(f.id);
      else todo.push(f);
    }
    this.files = this.files.filter((f) => keep.has(f.id));
    this.chunks = this.chunks.filter((c) => keep.has(c.fileId));
    let failure: unknown = null;
    for (const [n, f] of todo.entries()) {
      onProgress?.(n, todo.length);
      const parts = chunkText(f.content).map<Chunk>((c) => ({ id: f.id + ':' + c.idx, fileId: f.id, fileName: f.name, heading: c.heading, text: c.text, vec: null }));
      let embedded = false;
      if (embed && parts.length && !failure) {
        try {
          const vecs = await embed(parts.map(embedText), 'RETRIEVAL_DOCUMENT');
          parts.forEach((c, i) => { c.vec = vecs[i] ?? null; });
          embedded = true;
        } catch (e) { failure = e; }
      }
      this.files.push({ id: f.id, name: f.name, updatedAt: f.updatedAt, size: f.size, chunks: parts.length, embedded });
      this.chunks.push(...parts);
    }
    onProgress?.(todo.length, todo.length);
    if (todo.length || this.files.length !== inc.length) await this.save();
    if (failure) throw failure;
    return this.status();
  }

  private async save(): Promise<void> {
    const s: Stored = { v: INDEX_VERSION, files: this.files, chunks: this.chunks.map((c) => ({ ...c, vec: c.vec ? encodeVec(c.vec) : null })) };
    await this.repo.putBlob(INDEX_KEY, new Blob([JSON.stringify(s)], { type: 'application/json' }));
  }

  /** The `k` best chunks for `query`: cosine when vectors exist, keyword overlap otherwise. */
  async search(query: string, k = 3, embed: Embedder | null = null): Promise<Hit[]> {
    const q = query.trim();
    if (!q || !this.chunks.length) return [];
    let qv: number[] | null = null;
    if (embed && this.chunks.some((c) => c.vec)) {
      qv = this.queryCache.get(q) ?? null;
      if (!qv) { try { qv = (await embed([q], 'RETRIEVAL_QUERY'))[0] ?? null; if (qv) this.queryCache.set(q, qv); } catch { qv = null; } }
    }
    const kw = keywordScores(q, this.chunks);
    const scored = this.chunks.map((c, i) => ({ c, score: qv && c.vec ? dot(qv, c.vec) + 0.05 * kw[i] : kw[i] * (qv ? 0.5 : 1) }));
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k)
      .map(({ c, score }) => ({ fileId: c.fileId, fileName: c.fileName, heading: c.heading, text: c.text, score: Math.round(score * 1000) / 1000 }));
  }
}

/** BM25-flavoured keyword scores in 0..1, one per chunk. */
export function keywordScores(query: string, chunks: Pick<Chunk, 'heading' | 'text'>[]): number[] {
  const qt = Array.from(new Set(terms(query)));
  if (!qt.length) return chunks.map(() => 0);
  const docs = chunks.map((c) => terms(c.heading + ' ' + c.text));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, N);
  const raw = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of qt) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / Math.max(1, avg)));
    }
    return s;
  });
  const max = Math.max(...raw, 0);
  return raw.map((s) => (max ? s / max : 0));
}
