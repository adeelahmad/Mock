// Mock — the Gemini REST calls the live layer needs: countTokens to confirm the context
// estimate. Live models do not serve countTokens, so the text model counts (same tokenizer
// family; the debug panel labels it a confirmation, not an exact live count).

const API = 'https://generativelanguage.googleapis.com/v1beta';

export async function countTokens(key: string, model: string, text: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const id = model.startsWith('models/') ? model : 'models/' + model;
  const res = await fetchImpl(`${API}/${id}:countTokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
  });
  if (!res.ok) throw new Error('countTokens ' + res.status);
  const json = (await res.json()) as { totalTokens?: number };
  if (typeof json.totalTokens !== 'number') throw new Error('countTokens: no totalTokens');
  return json.totalTokens;
}
