import { describe, it, expect } from 'vitest';
import { zstdCompressSync } from 'node:zlib';
import { tagWithGemini } from './tagging.ts';
import { GEMINI_BASE } from './rest.ts';
import { LPS } from '../fixtures/sample.ts';
import { fileText } from '../domain/prep-import.ts';
import type { ParsedQuestion } from '../domain/parsers.ts';

const row = (text: string, lpId = '', confidence: 'high' | 'low' = 'low'): ParsedQuestion => ({ text, lpId, confidence, alternatives: [], source: null, difficulty: null, tags: '', votes: 0, sample: '' });

function fakeFetch(reply: unknown, seen: { url: string; init: RequestInit }[] = [], status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const body = status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] } : { error: { message: 'API key not valid' } };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('Gemini batch tagging', () => {
  it('re-tags only the unsure rows, keeps real LP ids, sends the key in a header', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const rows = [row('Sure one', 'own', 'high'), row('Unsure one', 'big'), row('Unknown one')];
    const r = await tagWithGemini(rows, LPS, { key: 'k123', model: 'gemini-3.8-flash', fetchImpl: fakeFetch({ tags: [{ i: 1, lp: 'deep', confidence: 'high', alternatives: ['own', 'nope'] }, { i: 2, lp: 'not-an-lp', confidence: 'high' }] }, seen) });
    expect(r.error).toBeNull();
    expect(r.byGemini).toBe(1);
    expect(r.rows[0]).toMatchObject({ lpId: 'own', confidence: 'high' });
    expect(r.rows[1]).toMatchObject({ lpId: 'deep', confidence: 'high', alternatives: ['own'] });
    expect(r.rows[2]).toMatchObject({ lpId: '', confidence: 'low' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(GEMINI_BASE + '/models/gemini-3.8-flash:generateContent');
    expect(seen[0].url).not.toContain('k123');
    expect((seen[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k123');
    const body = JSON.parse(String(seen[0].init.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toContain('1. Unsure one');
    expect(body.contents[0].parts[0].text).not.toContain('Sure one\n');
  });

  it('falls back to the keyword tags on an API error, and does nothing without a key', async () => {
    const rows = [row('Unsure one', 'big')];
    const bad = await tagWithGemini(rows, LPS, { key: 'k', model: 'm', fetchImpl: fakeFetch(null, [], 400) });
    expect(bad.error).toMatch(/API key not valid/);
    expect(bad.rows).toEqual(rows);
    const none = await tagWithGemini(rows, LPS, { key: '', model: 'm', fetchImpl: () => { throw new Error('should not call'); } });
    expect(none).toEqual({ rows, byGemini: 0, error: null });
  });
});

describe('fileText', () => {
  it('decodes a zstd-compressed Exponent export', async () => {
    const json = JSON.stringify([{ text: 'Tell me about a time you disagreed.', lp_id: 'back' }]);
    const zst = new Blob([zstdCompressSync(Buffer.from(json))]);
    expect(await fileText(Object.assign(zst, { name: 'export.zst' }))).toBe(json);
    expect(await fileText(Object.assign(new Blob(['plain']), { name: 'a.md' }))).toBe('plain');
  });
});
