import { describe, it, expect } from 'vitest';
import { countTokens } from './gemini-rest.ts';

describe('countTokens', () => {
  it('posts the text with the key in a header and returns totalTokens', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ totalTokens: 1234 })); }) as unknown as typeof fetch;
    expect(await countTokens('K', 'gemini-3.8-flash', 'hello', f)).toBe(1234);
    expect(seen!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens');
    expect((seen!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('K');
    expect(JSON.parse(seen!.init.body as string).contents[0].parts[0].text).toBe('hello');
  });
  it('throws on an HTTP error', async () => {
    const f = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    await expect(countTokens('K', 'm', 'x', f)).rejects.toThrow('403');
  });
});
