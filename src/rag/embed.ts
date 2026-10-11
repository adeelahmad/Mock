// Mock — Gemini embeddings (batchEmbedContents). Documents and queries use their own task types;
// vectors are cut to 768 dimensions and L2-normalised here (the API only normalises at 3072), so
// cosine similarity is a dot product. Tokens go to the budget ledger (spend tracker).

import { GEMINI_BASE, GeminiError } from '../gemini/rest.ts';
import { reportUsage } from '../gemini/usage.ts';

export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIMS = 768;
/** The API takes at most 100 requests per batch. */
const BATCH = 100;

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
export type Embedder = (texts: string[], task: EmbedTask) => Promise<number[][]>;

export const normalise = (v: number[]): number[] => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
};

/** Rough token count the embedding call is billed on (chars / 4). */
export const embedTokens = (texts: string[]): number => texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);

export function geminiEmbedder(o: { key: string; model?: string; fetchImpl?: typeof fetch }): Embedder {
  const model = o.model ?? EMBED_MODEL;
  return async (texts, task) => {
    const f = o.fetchImpl ?? fetch;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const part = texts.slice(i, i + BATCH);
      const res = await f(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': o.key },
        body: JSON.stringify({ requests: part.map((text) => ({ model: 'models/' + model, content: { parts: [{ text }] }, taskType: task, outputDimensionality: EMBED_DIMS })) }),
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not json */ }
        throw new GeminiError(res.status, msg);
      }
      const body = (await res.json()) as { embeddings?: { values?: number[] }[]; usageMetadata?: unknown };
      // The budget ledger: the API's count when it sends one, else the chars/4 estimate.
      reportUsage(model, null, body.usageMetadata ?? { promptTokenCount: embedTokens(part) });
      const vecs = body.embeddings ?? [];
      if (vecs.length !== part.length) throw new GeminiError(0, 'Gemini returned ' + vecs.length + ' embeddings for ' + part.length + ' texts');
      for (const e of vecs) out.push(normalise(e.values ?? []));
    }
    return out;
  };
}
