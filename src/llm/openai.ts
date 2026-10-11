// Mock — any OpenAI-compatible chat endpoint: OpenAI itself, Ollama (http://localhost:11434/v1),
// LM Studio, llama.cpp's server, vLLM, OpenRouter, Groq… `POST {baseUrl}/chat/completions` with
// `tools` for function calling, `max_tokens` for the reply, and `usage` read back for the spend
// ledger. History is trimmed to the configured context size before every call. From the
// browser, a local server must allow the app's origin (Ollama: OLLAMA_ORIGINS).

import type { OpenAiSettings } from '../domain/providers.ts';
import type { ToolCall } from '../live/transport.ts';
import { reportUsage } from '../gemini/usage.ts';
import { LlmError, fitTurns, parseJsonReply, timedFetch, toJsonSchema, type ChatModel, type ChatReply, type ChatRequest, type ChatTurn, type TextLlm, type TextRequest } from './chat.ts';

export interface OpenAiConfig extends OpenAiSettings {
  /** Optional: local servers need none. */
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** `http://host/v1` or `…/v1/chat/completions` → the completions URL. */
export function completionsUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : b + '/chat/completions';
}

type Msg = Record<string, unknown>;

export function toMessages(system: string, turns: ChatTurn[]): Msg[] {
  const out: Msg[] = system ? [{ role: 'system', content: system }] : [];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') {
      const m: Msg = { role: 'assistant', content: t.text || (t.calls.length ? null : '') };
      if (t.calls.length) m.tool_calls = t.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }));
      out.push(m);
    } else {
      for (const r of t.results) {
        const { scheduling: _s, ...rest } = r.response as { scheduling?: unknown };
        out.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(rest) });
      }
    }
  }
  return out;
}

let callSeq = 0;
function parseArgs(a: unknown): Record<string, unknown> {
  if (a && typeof a === 'object') return a as Record<string, unknown>;
  if (typeof a === 'string' && a.trim()) { try { const v = JSON.parse(a); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
  return {};
}

interface Completion {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

async function post(c: OpenAiConfig, body: Record<string, unknown>, signal?: AbortSignal): Promise<Completion> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (c.key) headers.authorization = 'Bearer ' + c.key;
  const res = await timedFetch(c.fetch ?? fetch, completionsUrl(c.baseUrl), { method: 'POST', headers, body: JSON.stringify(body) }, c.timeoutMs ?? 120_000, signal);
  const json = (await res.json().catch(() => null)) as Completion | null;
  if (!res.ok) {
    const msg = typeof json?.error === 'string' ? json.error : json?.error?.message;
    throw new LlmError((msg || 'The model returned ' + res.status) + (res.status === 404 ? ' — check the base URL and model name' : ''), res.status);
  }
  if (!json) throw new LlmError('The endpoint did not answer with JSON');
  return json;
}

const usageOf = (j: Completion): Record<string, number> | null =>
  j.usage ? { promptTokenCount: Number(j.usage.prompt_tokens) || 0, candidatesTokenCount: Number(j.usage.completion_tokens) || 0 } : null;

export class OpenAiChat implements ChatModel {
  readonly model: string;
  constructor(private c: OpenAiConfig) { this.model = c.model; }

  async complete(r: ChatRequest): Promise<ChatReply> {
    const turns = fitTurns(r.system, r.turns, this.c.contextTokens, this.c.maxOutputTokens);
    const body: Record<string, unknown> = { model: this.c.model, messages: toMessages(r.system, turns), max_tokens: this.c.maxOutputTokens };
    if (r.temperature != null) body.temperature = r.temperature;
    if (r.seed != null) body.seed = r.seed;
    if (r.tools.length) body.tools = r.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) } }));
    const j = await post(this.c, body, r.signal);
    const msg = j.choices?.[0]?.message;
    const calls: ToolCall[] = (msg?.tool_calls ?? []).filter((t) => t.function?.name).map((t) => ({ id: t.id || 'call_' + ++callSeq, name: String(t.function!.name), args: parseArgs(t.function!.arguments) }));
    return { text: (msg?.content ?? '').trim(), calls, usage: usageOf(j) };
  }
}

/** One-shot text (coach cards, reports): JSON mode when a schema is given, retried without it if the server refuses the flag. */
export function openAiText(c: OpenAiConfig): TextLlm {
  return async (r: TextRequest): Promise<string> => {
    const system = [r.system, r.schema ? 'Reply with one JSON object only, no prose, that matches this JSON Schema:\n' + JSON.stringify(toJsonSchema(r.schema)) : ''].filter(Boolean).join('\n\n');
    const body: Record<string, unknown> = { model: c.model, messages: toMessages(system, [{ role: 'user', text: r.text }]), max_tokens: Math.max(c.maxOutputTokens, r.schema ? 2048 : 0) };
    if (r.temperature != null) body.temperature = r.temperature;
    if (r.seed != null) body.seed = r.seed;
    let j: Completion;
    try { j = await post(c, r.schema ? { ...body, response_format: { type: 'json_object' } } : body, r.signal); }
    catch (err) { if (r.schema && err instanceof LlmError && err.status === 400) j = await post(c, body, r.signal); else throw err; }
    const u = usageOf(j);
    if (u) reportUsage(c.model, r.lpId ?? null, u);
    const text = (j.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new LlmError('Empty reply' + (j.choices?.[0]?.finish_reason ? ' (' + j.choices[0].finish_reason + ')' : ''));
    if (r.schema) parseJsonReply(text); // fail here, so the caller falls back
    return text;
  };
}
