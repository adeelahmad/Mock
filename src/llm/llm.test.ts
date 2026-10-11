import { describe, it, expect } from 'vitest';
import { fitTurns, parseJsonReply, toJsonSchema, type ChatTurn } from './chat.ts';
import { OpenAiChat, completionsUrl, openAiText, toMessages } from './openai.ts';
import { GeminiChat, toContents } from './gemini-chat.ts';
import { NEW_QUESTION_TOOL } from '../live/transport.ts';
import { DEFAULT_PROVIDERS } from '../domain/providers.ts';

const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('provider-neutral chat helpers', () => {
  it('converts Gemini tool schemas to JSON Schema', () => {
    const s = toJsonSchema(NEW_QUESTION_TOOL.parameters) as any;
    expect(s.type).toBe('object');
    expect(s.properties.question.type).toBe('string');
    expect(s.required).toEqual(['interviewer', 'question', 'lp']);
    expect((toJsonSchema({ type: 'ARRAY', items: { type: 'STRING' } }) as any).items.type).toBe('string');
  });

  it('keeps the newest turns that fit and never starts on a tool result', () => {
    const turns: ChatTurn[] = [
      { role: 'user', text: 'a'.repeat(400) },
      { role: 'assistant', text: '', calls: [{ id: '1', name: 'x', args: {} }] },
      { role: 'tool', results: [{ id: '1', name: 'x', response: { ok: true } }] },
      { role: 'assistant', text: 'b'.repeat(40), calls: [] },
      { role: 'user', text: 'latest' },
    ];
    expect(fitTurns('', turns, 100_000, 100)).toHaveLength(5);
    const kept = fitTurns('', turns, 90, 10);
    expect(kept[0].role).toBe('user');
    expect(kept[kept.length - 1]).toEqual({ role: 'user', text: 'latest' });
    // Too small for anything: the latest user turn still goes.
    expect(fitTurns('s'.repeat(1000), turns, 50, 10)).toEqual([{ role: 'user', text: 'latest' }]);
  });

  it('parses fenced or wrapped JSON replies', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseJsonReply('nope')).toThrow(/not JSON/);
  });
});

describe('OpenAI-compatible endpoint', () => {
  it('builds the URL from a base URL', () => {
    expect(completionsUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions');
    expect(completionsUrl('https://x/v1/chat/completions')).toBe('https://x/v1/chat/completions');
  });

  it('maps tool calls and results to messages', () => {
    const m = toMessages('SYS', [
      { role: 'user', text: '[START]' },
      { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'new_question', args: { q: 1 } }] },
      { role: 'tool', results: [{ id: 'c1', name: 'new_question', response: { ok: true, scheduling: 'SILENT' } }] },
    ]);
    expect(m[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(m[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'new_question', arguments: '{"q":1}' } }] });
    expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
  });

  it('sends model, tools, max_tokens and the bearer key; reads text, tool calls and usage', async () => {
    let sent: any = null, headers: any = null, url = '';
    const fetch = (async (u: string, init: RequestInit) => {
      url = u; sent = JSON.parse(init.body as string); headers = init.headers;
      return reply({ choices: [{ message: { content: 'Tell me about a time.', tool_calls: [{ id: 'k', function: { name: 'new_question', arguments: '{"question":"Q","lp":"Ownership","interviewer":"Dana"}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 5 } })();
    }) as typeof globalThis.fetch;
    const chat = new OpenAiChat({ ...DEFAULT_PROVIDERS.openai, key: 'sk-1', fetch });
    const r = await chat.complete({ system: 'SYS', turns: [{ role: 'user', text: 'hi' }], tools: [NEW_QUESTION_TOOL], seed: 3 });
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer sk-1');
    expect(sent).toMatchObject({ model: 'llama3.2', max_tokens: 1024, seed: 3 });
    expect(sent.tools[0].function.parameters.type).toBe('object');
    expect(sent.tools[0].function.behavior).toBeUndefined();
    expect(r.text).toBe('Tell me about a time.');
    expect(r.calls).toEqual([{ id: 'k', name: 'new_question', args: { question: 'Q', lp: 'Ownership', interviewer: 'Dana' } }]);
    expect(r.usage).toEqual({ promptTokenCount: 12, candidatesTokenCount: 5 });
  });

  it('sends no key header for a local server and reports HTTP errors', async () => {
    let headers: any = null;
    const fetch = (async (_u: string, init: RequestInit) => { headers = init.headers; return reply({ error: { message: 'model "x" not found' } }, 404)(); }) as typeof globalThis.fetch;
    const chat = new OpenAiChat({ ...DEFAULT_PROVIDERS.openai, key: '', fetch });
    await expect(chat.complete({ system: '', turns: [{ role: 'user', text: 'hi' }], tools: [] })).rejects.toThrow(/not found — check the base URL/);
    expect(headers.authorization).toBeUndefined();
  });

  it('asks for JSON when a schema is given and retries without the flag on a 400', async () => {
    const bodies: any[] = [];
    const fetch = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string); bodies.push(b);
      return b.response_format ? reply({ error: 'response_format not supported' }, 400)() : reply({ choices: [{ message: { content: '{"ok":true}' } }] })();
    }) as typeof globalThis.fetch;
    const text = await openAiText({ ...DEFAULT_PROVIDERS.openai, key: '', fetch })({ text: 'go', schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } } });
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].messages[0].content).toMatch(/JSON Schema/);
  });
});

describe('Gemini as the pipeline model', () => {
  it('maps turns to contents and reads function calls', async () => {
    const c = toContents([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'Q?', calls: [{ id: 'gcall_1', name: 'new_question', args: { a: 1 } }] },
      { role: 'tool', results: [{ id: 'gcall_1', name: 'new_question', response: { ok: true, scheduling: 'SILENT' } }] },
    ]);
    expect(c[1]).toEqual({ role: 'model', parts: [{ text: 'Q?' }, { functionCall: { name: 'new_question', args: { a: 1 } } }] });
    expect(c[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'new_question', response: { ok: true } } }] });

    let sent: any = null;
    const fetch = (async (_u: string, init: RequestInit) => { sent = JSON.parse(init.body as string); return reply({ candidates: [{ content: { parts: [{ text: 'Hello.' }, { functionCall: { name: 'new_question', args: { question: 'Q' } }, thoughtSignature: 'sig' }] } }], usageMetadata: { promptTokenCount: 9 } })(); }) as typeof globalThis.fetch;
    const r = await new GeminiChat({ key: 'K', model: 'gemini-3.8-flash', fetch }).complete({ system: 'SYS', turns: [{ role: 'user', text: 'hi' }], tools: [NEW_QUESTION_TOOL] });
    expect(sent.tools[0].functionDeclarations[0].behavior).toBeUndefined();
    expect(r.text).toBe('Hello.');
    expect(r.calls[0].name).toBe('new_question');
    // The raw parts (with the thought signature) go back verbatim next time.
    expect(toContents([{ role: 'assistant', text: r.text, calls: r.calls, raw: r.raw }])[0].parts[1]).toHaveProperty('thoughtSignature', 'sig');
  });
});
