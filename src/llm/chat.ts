// Mock — the language model behind the turn-by-turn pipeline, provider-neutral: a conversation
// of user, assistant and tool turns goes in, text and tool calls come out. Gemini
// (gemini-chat.ts) and any OpenAI-compatible endpoint (openai.ts) implement it. Also: the
// history trim that keeps a conversation inside a small context window, and the conversion of
// the Gemini-style tool schemas ("OBJECT", "STRING") to standard JSON Schema.

import type { ToolCall, ToolDeclaration, ToolResponse } from '../live/transport.ts';

export type ChatTurn =
  | { role: 'user'; text: string }
  /** `raw`: the provider's own reply parts, sent back verbatim (Gemini's thought signatures). */
  | { role: 'assistant'; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResponse[] };

export interface ChatReply {
  text: string;
  calls: ToolCall[];
  /** Gemini-shaped usage (`promptTokenCount`, `candidatesTokenCount`), for the spend ledger. */
  usage: Record<string, number> | null;
  raw?: unknown;
}

export interface ChatRequest {
  system: string;
  turns: ChatTurn[];
  tools: ToolDeclaration[];
  temperature?: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface ChatModel {
  /** The model id, as the spend ledger records it. */
  readonly model: string;
  complete(r: ChatRequest): Promise<ChatReply>;
}

/** One-shot text for the coach cards, reports and tests: optional JSON reply. */
export interface TextRequest {
  system?: string;
  text: string;
  /** JSON schema the reply must follow; omitted → plain text. */
  schema?: Record<string, unknown>;
  temperature?: number;
  seed?: number;
  signal?: AbortSignal;
  lpId?: string | null;
}
export type TextLlm = (r: TextRequest) => Promise<string>;

export class LlmError extends Error {
  constructor(message: string, public status = 0) { super(message); this.name = 'LlmError'; }
}

/** About four characters per token: close enough to stay inside a window. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

const turnTokens = (t: ChatTurn): number =>
  t.role === 'user' ? estimateTokens(t.text) + 4
    : t.role === 'assistant' ? estimateTokens(t.text) + estimateTokens(JSON.stringify(t.calls)) + 4
      : estimateTokens(JSON.stringify(t.results)) + 4;

/**
 * The newest turns that fit: system + history + the reply must stay within `contextTokens`.
 * Oldest turns go first; the kept history never starts with a tool result (its call is gone)
 * or an assistant turn, since both APIs want a user turn first.
 */
export function fitTurns(system: string, turns: ChatTurn[], contextTokens: number, replyTokens: number): ChatTurn[] {
  let room = contextTokens - estimateTokens(system) - replyTokens;
  let start = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    room -= turnTokens(turns[i]);
    if (room < 0) break;
    start = i;
  }
  while (start < turns.length && turns[start].role !== 'user') start++;
  // Always keep the latest user turn, even when the window is too small for it.
  if (start >= turns.length) { const last = turns.map((t) => t.role).lastIndexOf('user'); return last >= 0 ? turns.slice(last) : []; }
  return turns.slice(start);
}

/** Gemini's OpenAPI subset (`type: "OBJECT"`) → JSON Schema (`type: "object"`). */
export function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === 'type' && typeof v === 'string') out[k] = v.toLowerCase();
    else if (k === 'properties' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, d]) => [p, toJsonSchema(d)]));
    else if (k === 'items' || k === 'anyOf' || k === 'oneOf') out[k] = toJsonSchema(v);
    else out[k] = v;
  }
  return out;
}

/** A reply that should be JSON: tolerates a ```json fence and text around the object. */
export function parseJsonReply<T = unknown>(text: string): T {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(clean) as T; } catch { /* try the outermost object */ }
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)) as T; } catch { /* fall through */ } }
  throw new LlmError('Reply was not JSON');
}

/** Fetch with a timeout and an outer abort signal. */
export async function timedFetch(f: typeof fetch, url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try { return await f(url, { ...init, signal: ctl.signal }); }
  catch (err) { throw new LlmError(ctl.signal.aborted ? (signal?.aborted ? 'Cancelled' : 'Timed out') : 'Network error: ' + ((err as Error).message || 'offline')); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
