// Mock — the Gemini REST client (generateContent with a JSON schema). The key goes in the
// `x-goog-api-key` header, never in a URL or a log line. M4 adds analysis and reports on top.

import { reportUsage } from './usage.ts';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface GenerateJsonOptions {
  key: string;
  model: string;
  prompt: string;
  schema: object;
  system?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** The Leadership Principle the tokens are spent on, for the budget breakdown. */
  lpId?: string | null;
}

/** One structured call: prompt in, parsed JSON out (throws GeminiError on HTTP or shape errors). */
export async function generateJson<T>(o: GenerateJsonOptions): Promise<T> {
  const f = o.fetchImpl ?? fetch;
  const res = await f(`${GEMINI_BASE}/models/${encodeURIComponent(o.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': o.key },
    signal: o.signal,
    body: JSON.stringify({
      ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: o.prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: o.schema, temperature: 0 },
    }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not json */ }
    throw new GeminiError(res.status, msg);
  }
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: unknown };
  if (body.usageMetadata) reportUsage(o.model, o.lpId ?? null, body.usageMetadata);
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try { return JSON.parse(text) as T; } catch { throw new GeminiError(0, 'Gemini returned no JSON'); }
}
