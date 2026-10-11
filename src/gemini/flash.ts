// Mock — the Flash REST call: one `generateContent` request with an optional JSON schema.
// Shape verified against the Gemini API reference at the start of M4 (Oct 2026):
// `POST v1beta/models/{model}:generateContent`, key in `x-goog-api-key`, structured output via
// `generationConfig.responseMimeType = "application/json"` + `responseJsonSchema`, audio as
// `inlineData` (≤ 20 MB per request). The docs also present the newer Interactions API
// (`response_format`); if generateContent is retired, only this module changes.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Inline request ceiling; clips above it are sent as transcript only. */
export const INLINE_LIMIT_BYTES = 20 * 1024 * 1024;

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface FlashRequest {
  key: string;
  model: string;
  system?: string;
  parts: Part[];
  /** JSON schema for the reply; omitted → plain text. */
  schema?: Record<string, unknown>;
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export class FlashError extends Error {
  constructor(message: string, public status = 0) { super(message); this.name = 'FlashError'; }
}

function body(r: FlashRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {};
  if (r.schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = r.schema; }
  if (r.temperature != null) generationConfig.temperature = r.temperature;
  if (r.seed != null) generationConfig.seed = r.seed;
  return {
    ...(r.system ? { systemInstruction: { parts: [{ text: r.system }] } } : {}),
    contents: [{ role: 'user', parts: r.parts }],
    generationConfig,
  };
}

/** The reply's text, joined across parts. Throws FlashError on HTTP errors, blocks and empty replies. */
export async function generateText(r: FlashRequest): Promise<string> {
  const f = r.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), r.timeoutMs ?? 60000);
  const onAbort = () => ctl.abort();
  r.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await f(GEMINI_BASE + '/models/' + encodeURIComponent(r.model) + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': r.key },
      body: JSON.stringify(body(r)),
      signal: ctl.signal,
    });
  } catch (err) {
    throw new FlashError(ctl.signal.aborted ? 'Flash timed out' : 'Network error: ' + ((err as Error).message || 'offline'));
  } finally {
    clearTimeout(timer);
    r.signal?.removeEventListener('abort', onAbort);
  }
  const json = (await res.json().catch(() => null)) as { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } } | null;
  if (!res.ok) throw new FlashError(json?.error?.message || 'Flash returned ' + res.status, res.status);
  if (json?.promptFeedback?.blockReason) throw new FlashError('Blocked: ' + json.promptFeedback.blockReason, res.status);
  const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new FlashError('Empty reply' + (json?.candidates?.[0]?.finishReason ? ' (' + json.candidates[0].finishReason + ')' : ''), res.status);
  return text;
}

/** generateText with a schema, parsed. Tolerates a fenced ```json reply. */
export async function generateJson<T = unknown>(r: FlashRequest & { schema: Record<string, unknown> }): Promise<T> {
  const text = await generateText(r);
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(clean) as T; } catch { throw new FlashError('Reply was not JSON'); }
}

/** A Blob as base64, for `inlineData`. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The clip as an inline part, or null when there is none or it is over the inline limit. */
export async function audioPart(clip: Blob | null): Promise<Part | null> {
  if (!clip || !clip.size || clip.size > INLINE_LIMIT_BYTES) return null;
  return { inlineData: { mimeType: (clip.type || 'audio/webm').split(';')[0], data: await blobToBase64(clip) } };
}
