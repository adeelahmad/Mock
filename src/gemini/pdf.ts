// Mock — PDF → markdown through Gemini (the PDF goes inline; ≤ 20 MB). Used when a PDF is dropped
// on Library → Files so a resume or a past-loop write-up joins the prep files and the knowledge
// index like any markdown file.

import { GEMINI_BASE, GeminiError } from './rest.ts';
import { reportUsage } from './usage.ts';

export const PDF_MAX_BYTES = 20 * 1024 * 1024;

const PROMPT = 'Transcribe this document to clean markdown. Keep every fact, number, date, name and heading; use # headings for sections and - for bullets. No commentary, no code fences.';

const b64 = (buf: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};

export const isPdf = (f: { name: string; type?: string }): boolean => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

export async function pdfToMarkdown(o: { key: string; model: string; file: Blob; fetchImpl?: typeof fetch }): Promise<string> {
  if (o.file.size > PDF_MAX_BYTES) throw new GeminiError(0, 'PDF is over 20 MB');
  const data = b64(new Uint8Array(await o.file.arrayBuffer()));
  const f = o.fetchImpl ?? fetch;
  const res = await f(`${GEMINI_BASE}/models/${encodeURIComponent(o.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': o.key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data } }, { text: PROMPT }] }], generationConfig: { temperature: 0 } }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not json */ }
    throw new GeminiError(res.status, msg);
  }
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: unknown };
  if (body.usageMetadata) reportUsage(o.model, null, body.usageMetadata);
  const text = (body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').replace(/^```(?:markdown)?\s*|\s*```$/g, '').trim();
  if (!text) throw new GeminiError(0, 'Gemini returned no text for the PDF');
  return text;
}
